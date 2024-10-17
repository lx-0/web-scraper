{ pkgs }: {
  deps = [
    pkgs.nodejs-18_x
    pkgs.chromium
    pkgs.replitPackages.jest
    pkgs.yarn
  ];
}
