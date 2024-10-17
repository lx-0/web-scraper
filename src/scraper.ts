import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Page } from 'puppeteer-core';
import * as puppeteer from 'puppeteer-core';

export async function extractReadableContent(page: puppeteer.Page): Promise<string> {
  const content = await page.content();
  const dom = new JSDOM(content);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return article ? article.textContent : '';
}

export async function extractEnhancedArticle(page: puppeteer.Page): Promise<string> {
  const content = await page.content();
  const dom = new JSDOM(content);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    return '';
  }

  // Extract title, byline, and content
  let enhancedContent = `Title: ${article.title}\n\n`;
  if (article.byline) {
    enhancedContent += `Author: ${article.byline}\n\n`;
  }
  enhancedContent += `Content:\n${await extractReadableContent(page)}`;

  // Extract metadata
  const metadata = await page.evaluate(() => {
    const metaTags = document.getElementsByTagName('meta');
    const data: { [key: string]: string } = {};
    for (let i = 0; i < metaTags.length; i++) {
      const name = metaTags[i].getAttribute('name') || metaTags[i].getAttribute('property');
      const content = metaTags[i].getAttribute('content');
      if (name && content) {
        data[name] = content;
      }
    }
    return data;
  });

  // Add relevant metadata to the enhanced content
  const relevantMetaTags = ['description', 'keywords', 'author', 'publication_date'];
  enhancedContent += '\n\nMetadata:';
  for (const tag of relevantMetaTags) {
    if (metadata[tag]) {
      enhancedContent += `\n${tag}: ${metadata[tag]}`;
    }
  }

  return enhancedContent;
}

/** @deprecated */
export async function scrapeWebsite(page: Page, mode: 'text' | 'article'): Promise<string> {
  console.log(`Scraping in ${mode} mode`);
  if (mode === 'text') {
    return await page.evaluate(() => {
      console.log('Evaluating page content');
      return document.body.innerText;
    });
  } else if (mode === 'article') {
    return await page.evaluate(() => {
      console.log('Searching for article content');
      const article = document.querySelector('article') || document.querySelector('main');
      return article ? article.innerText : document.body.innerText;
    });
  }
  throw new Error('Invalid mode');
}

export async function takeScreenshot(page: Page): Promise<string> {
  console.log('Taking screenshot');
  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  console.log('Screenshot taken');
  return screenshot.toString('base64');
}

export async function getPageSource(page: Page): Promise<string> {
  console.log('Getting page source');
  const content = await page.content();
  console.log('Page source retrieved');
  return content;
}

export async function getPrintVersion(page: puppeteer.Page): Promise<string> {
  console.log('Starting print version extraction...');

  try {
    // Add print stylesheet
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        @media print {
          @page { size: auto; margin: 20mm; }
          body { -webkit-print-color-adjust: exact; }
        }
      `;
      document.head.appendChild(style);
    });

    // Emulate print media type
    await page.emulateMediaType('print');

    // Get the content in print layout
    const content = await page.evaluate(() => {
      return document.documentElement.outerHTML;
    });

    // Reset media type
    await page.emulateMediaType('screen');

    console.log('Print version extraction completed. Content length:', content.length);
    return content;
  } catch (error) {
    console.error('Error in getPrintVersion:', error);
    throw error;
  }
}
