// Copy dictionary and any other assets to dist/assets so they are present at runtime
const fs = require('fs');
const path = require('path');

const SRC_ASSETS = path.resolve(__dirname, '..', 'src', 'assets');
const DIST_ASSETS = path.resolve(__dirname, '..', 'dist', 'assets');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(SRC_ASSETS, DIST_ASSETS);
console.log(`[build] Copied assets to ${DIST_ASSETS}`);

