#!/usr/bin/env node
/**
 * Gridset font-size adjuster (user-wide)
 *
 * Bumps the font size of every style in a Grid 3 .gridset by a delta,
 * keeping whatever font family/colours are already set.
 *
 * Covers both places Grid 3 stores styles:
 *   - Settings0/Styles/styles.xml   (named styles, referenced via BasedOnStyle)
 *   - Grids/.../grid.xml             (inline <Style> overrides on cells)
 *
 * Usage:
 *   node examples/gridset-bump-font-size.mjs input.gridset -o output.gridset
 *   node examples/gridset-bump-font-size.mjs input.gridset -d 4 -o output.gridset
 *   node examples/gridset-bump-font-size.mjs input.gridset -d 10 --base 20 --skip-missing -o output.gridset
 *
 * Options:
 *   -d, --delta <n>      Amount to add to each font size (negative to shrink). Default: 10
 *   -b, --base <n>       Assumed size for styles with no explicit FontSize (default: 16).
 *                        The injected value is base + delta.
 *   --skip-missing       Only bump styles that already set FontSize; don't inject one.
 *   -o, --output <path>  Output file (default: <input>-adjusted.gridset next to the input)
 */

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { program } from 'commander';

program
  .argument('<input>', 'Path to the source .gridset')
  .option('-d, --delta <n>', 'font size delta', '10')
  .option('-b, --base <n>', 'assumed size for styles without an explicit FontSize', '16')
  .option('--skip-missing', 'only bump styles that already set FontSize', false)
  .option('-o, --output <path>', 'output .gridset path')
  .parse();

const opts = program.opts();
const inputPath = program.args[0];
const delta = parseInt(opts.delta, 10);
const base = parseInt(opts.base, 10);
const outputPath =
  opts.output ||
  inputPath.replace(/\.gridset$/i, '') + '-adjusted.gridset';

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const STYLE_BLOCK = /<Style(\s[^>]*)?>([\s\S]*?)<\/Style>/g;
const FONT_SIZE = /<FontSize>([^<]+)<\/FontSize>/;

function adjustStyleBlock(match, attrs, body, report) {
  const existing = body.match(FONT_SIZE);
  if (existing) {
    const current = parseInt(existing[1], 10);
    if (Number.isNaN(current)) return match;
    const next = Math.max(1, current + delta);
    report.bumped += 1;
    return `<Style${attrs || ''}>${body.replace(FONT_SIZE, `<FontSize>${next}</FontSize>`)}</Style>`;
  }
  if (opts.skipMissing) {
    report.skipped += 1;
    return match;
  }
  report.injected += 1;
  return `<Style${attrs || ''}><FontSize>${base + delta}</FontSize>${body}</Style>`;
}

function adjustXml(xml, label) {
  const report = { bumped: 0, injected: 0, skipped: 0 };
  const adjusted = xml.replace(STYLE_BLOCK, (m, a, b) => adjustStyleBlock(m, a, b, report));
  if (report.bumped || report.injected) {
    console.log(
      `  ${label}: ${report.bumped} bumped, ${report.injected} injected${
        report.skipped ? `, ${report.skipped} left as-is` : ''
      }`
    );
  }
  return { adjusted, report };
}

const zip = await JSZip.loadAsync(fs.readFileSync(inputPath));
let anyChange = false;

for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  if (name === 'Settings0/Styles/styles.xml' || /^Grids\/.*\/grid\.xml$/i.test(name)) {
    const xml = await entry.async('string');
    const { adjusted, report } = adjustXml(xml, name);
    if (report.bumped || report.injected) {
      zip.file(name, adjusted);
      anyChange = true;
    }
  }
}

if (!anyChange) {
  console.log('No styles found to adjust (try a different --base, or remove --skip-missing).');
}

const out = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});
fs.writeFileSync(outputPath, out);
console.log(`\nWrote ${outputPath} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);

const verifyZip = await JSZip.loadAsync(fs.readFileSync(outputPath));
const styleFile = verifyZip.file('Settings0/Styles/styles.xml');
if (styleFile) {
  const sizes = [...(await styleFile.async('string')).matchAll(/<FontSize>([^<]+)<\/FontSize>/g)]
    .map((m) => m[1])
    .sort((a, b) => a - b);
  console.log(`Named styles now carry FontSize values: ${sizes.join(', ') || '(none)'}`);
}
