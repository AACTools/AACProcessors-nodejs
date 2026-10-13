'use strict';

/**
 * React Native (Metro/Hermes) bundler probe.
 *
 * Asks the actual React Native bundler to bundle the built browser
 * distribution. Because it runs the real resolver, it also catches Node core
 * modules pulled in transitively by dependencies (for example `xml2js`
 * requiring `events`/`timers`), which a scan of our own compiled files cannot
 * see.
 *
 * Metro is installed in the isolated fixture at test/rn-metro-check so it does
 * not become a runtime dependency of the library. Run:
 *
 *   npm run verify:rn-bundle            # build + probe
 *   node scripts/verify-rn-bundle.js    # probe an existing dist/browser
 *
 * The fixture is intentionally self-contained: `dist/browser` is copied to
 * `test/rn-metro-check/lib` and only the library's browser-safe runtime
 * dependencies are installed there, so Metro fails on a stray Node core module
 * exactly as it would in a stock React Native / Expo app.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(projectRoot, 'test', 'rn-metro-check');
const browserDist = path.join(projectRoot, 'dist', 'browser');
const browserEntry = path.join(browserDist, 'index.browser.js');
const fixtureLib = path.join(fixtureDir, 'lib');
const outputFile = path.join(fixtureDir, 'rn-bundle-output.js');

function fail(message) {
  console.error(`\nReact Native bundle verification failed.\n\n${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(browserEntry)) {
  fail('Browser build not found. Run "npm run build:browser" first.');
}

const metroBin = path.join(
  fixtureDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'metro.cmd' : 'metro'
);

if (!fs.existsSync(metroBin)) {
  fail(
    'Metro fixture dependencies are not installed.\n' +
      `Run: npm --prefix ${path.relative(projectRoot, fixtureDir)} install`
  );
}

function cleanup() {
  fs.rmSync(fixtureLib, { recursive: true, force: true });
  fs.rmSync(outputFile, { force: true });
}

try {
  cleanup();
  fs.cpSync(browserDist, fixtureLib, { recursive: true });

  execFileSync(
    metroBin,
    ['build', 'index.js', '--platform', 'ios', '--dev', 'true', '--out', outputFile],
    { cwd: fixtureDir, stdio: 'inherit' }
  );
} catch (error) {
  cleanup();
  fail(
    'Metro could not bundle dist/browser. The browser distribution is not ' +
      'React Native / Expo compatible (see the Metro error above). This is ' +
      'typically a Node core module such as `fs`, `path`, `events`, `stream`, ' +
      '`timers` or `util` reached statically or through a dependency.'
  );
} finally {
  cleanup();
}

console.log(
  '\nMetro successfully bundled the browser distribution — React Native / Expo compatible.'
);
