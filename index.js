// Wrapper to run the TypeScript game server using ts-node when launched with:
//   nodemon index.js
// It will compile on-the-fly and watch TS sources if nodemon is configured.

try {
  require('ts-node/register/transpile-only');
} catch (e) {
  console.error('[server] Missing dev dependency ts-node. Install it with:\n  npm --prefix server i -D ts-node');
  process.exit(1);
}

require('./src/index.ts');
