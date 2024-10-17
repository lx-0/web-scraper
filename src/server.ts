import dotenv from 'dotenv';
import Fastify from 'fastify';
import fs from 'fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'path';
import * as puppeteer from 'puppeteer-core';

import {
  extractEnhancedArticle,
  extractReadableContent,
  getPageSource,
  getPrintVersion,
  takeScreenshot,
} from './scraper';

dotenv.config(); // Load environment variables from .env

const server = Fastify({
  logger: true,
});

interface ScrapeRequest {
  url: string;
  mode: 'text' | 'article' | 'screenshot' | 'source' | 'print';
}

interface ScrapeStats {
  [month: string]: {
    [url: string]: {
      [mode: string]: number;
    };
  };
}

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'scrape_stats.json');

let browserPromise: Promise<puppeteer.Browser> | null = null;
let scrapeStats: ScrapeStats = {};

async function getBrowser() {
  if (!browserPromise) {
    console.log('Launching browser...');
    // find path to chromium
    const { stdout: chromiumPath } = await promisify(exec)('which chromium');
    browserPromise = puppeteer
      .launch({
        executablePath: chromiumPath.trim(),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--headless',
        ],
        headless: true,
        ignoreHTTPSErrors: true,
      })
      .catch((error) => {
        console.error('Error launching browser:', error);
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

async function loadStats() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(STATS_FILE, 'utf-8');
    scrapeStats = JSON.parse(data);
  } catch (error) {
    console.log('No existing stats file found. Starting with empty stats.');
    scrapeStats = {};
  }
}

async function saveStats() {
  await ensureDataDir();
  await fs.writeFile(STATS_FILE, JSON.stringify(scrapeStats, null, 2));
}

function getCurrentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function logScrape(url: string, mode: string) {
  const currentMonth = getCurrentMonth();
  if (!scrapeStats[currentMonth]) {
    scrapeStats[currentMonth] = {};
  }
  if (!scrapeStats[currentMonth][url]) {
    scrapeStats[currentMonth][url] = {};
  }
  if (!scrapeStats[currentMonth][url][mode]) {
    scrapeStats[currentMonth][url][mode] = 0;
  }
  scrapeStats[currentMonth][url][mode]++;
  await saveStats();
}

// Middleware to check API key
server.addHook('preHandler', (request, reply, done) => {
  if (request.url === '/') {
    // Skip API key check for root path
    done();
    return;
  }
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    reply.code(401).send({ error: 'Unauthorized: Invalid API key' });
  } else {
    done();
  }
});

server.post<{ Body: ScrapeRequest }>('/scrape', async (request, reply) => {
  const { url, mode } = request.body;

  if (!url) {
    reply.code(400).send({ error: 'URL is required' });
    return;
  }

  let browser: puppeteer.Browser | null = null;
  let page: puppeteer.Page | null = null;

  try {
    console.log(`Starting scrape for URL: ${url}, Mode: ${mode}`);
    browser = await getBrowser();
    console.log('Browser launched successfully');

    page = await browser.newPage();
    console.log('New page created');

    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    console.log('Page loaded successfully');

    let result;
    switch (mode) {
      case 'screenshot':
        result = await takeScreenshot(page);
        break;
      case 'source':
        result = await getPageSource(page);
        break;
      case 'print':
        result = await getPrintVersion(page);
        break;
      case 'article':
        result = await extractEnhancedArticle(page);
        break;
      case 'text':
      default:
        result = await extractReadableContent(page);
        break;
    }

    console.log(`Scrape completed successfully for mode: ${mode}`);
    await logScrape(url, mode);
    reply.send({ content: result });
  } catch (error) {
    console.error('Error during scraping:', error);
    server.log.error(error);
    reply.code(500).send({ error: 'An error occurred while scraping the website' });
  } finally {
    if (page) {
      console.log('Closing page...');
      await page.close().catch(console.error);
    }
    // Don't close the browser, we're reusing it
  }
});

// New endpoint to get scrape statistics
server.get('/stats', (request, reply) => {
  reply.send(scrapeStats);
});

server.get('/', (request, reply) => {
  // reply.redirect('https://www.0fo.de', 301);
  reply.send('Web scraper service is running');
});

const start = async () => {
  try {
    await loadStats();
    await server.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server started successfully');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
