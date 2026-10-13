# AAC Processors - Utility Scripts

This directory contains utility scripts and tools for working with AAC files. These are organized by category for easier navigation.

> **Note:** For code examples and demos showing how to use the library programmatically, see the **examples/** directory.

## 📁 Directory Structure

```
scripts/
├── analysis/          # Pageset analysis and vocabulary extraction
├── asterics/          # Asterics Grid format conversion
├── audio/             # Audio enhancement and integration
├── conversion/        # File format conversion utilities
├── translation/       # Translation workflows and tools
├── keyboard/          # Keyboard layout utilities
└── utilities/         # General utility scripts
```

## 📂 Categories

### 📊 analysis/
Analysis and reporting tools for AAC pagesets.

- **analyze_pageset.js** - General pageset analysis
- **analyze_audio_pageset.js** - Audio integration analysis
- **extract_vocabulary.js** - Extract vocabulary from pagesets
- **generate_csv.js** - Generate CSV reports from vocabulary
- **validate_complete_workflow.js** - Validate end-to-end workflows
- **scanning_benchmark.ts** - Benchmark scanning efficiency and vocabulary coverage across multiple files

Example:
```bash
npm run build
node scripts/analysis/extract_vocabulary.js ../examples/example.sps vocabulary.json
```

### 🔧 asterics/
Tools for working with Asterics Grid format.

- **convert-asterics-grid.js** - Convert Asterics grids to other formats
- **convert-gridset.sh** - Shell script for gridset conversion
- **extract-gridset.sh** - Extract gridset contents

### 🎵 audio/
Audio enhancement and integration scripts.

- **create_audio_enhanced_pageset.js** - Add audio to pagesets
- **generate_audio_with_resume.js** - Generate audio with resume capability
- **demo_enhanced_snapprocessor.js** - Demo of audio-enhanced Snap files
- **test_audio_integration.js** - Test audio integration features

### 🔄 conversion/
Format conversion utilities.

- **txt-to-gridset.ts** - Convert TSV (tab-separated) files to Gridset format
- **convert-gtbz-to-obz.js** - Convert a GoTalk NOW `.gtbz` board to an OBF `.obz` archive (embeds bundled images as data URLs, preserves colours/text/navigation)

Example:
```bash
npm run build
node scripts/conversion/convert-gtbz-to-obz.js input.gtbz output.obz
```

### 🌐 translation/
Translation and localization tools.

- **translate.js** - General translation utility
- **punjabi/** - Punjabi language translation scripts
  - `translate_to_punjabi.js` - Translate pagesets to Punjabi

### ⌨️ keyboard/
Keyboard layout utilities.

- **replace-keyboard-layout.js** - Replace single-key buttons using a target keyboard layout

### 🛠️ utilities/
General-purpose utility scripts.

- **image-map.js** - Image mapping and analysis tools
- **bench.js** - Run simple performance benchmarks for load/extract/process paths

### 🌐 Browser verification

- **verify-browser-build.js** - Confirms the compiled browser distribution
  exists and is non-empty (`dist/browser/index.browser.js` and the shared
  `dist/index.browser.d.ts`). Run with `npm run verify:browser-build`.
- **verify-rn-bundle.js** - Bundles a copy of `dist/browser` with the real Metro
  bundler (isolated `test/rn-metro-check` fixture using `babel-preset-expo`) to
  prove it works in React Native / Expo, including Node core modules reached
  transitively through dependencies. Run with `npm run verify:rn-bundle`; Metro
  is installed only in the fixture.
- **smoke-browser-bundle.js** - End-to-end web smoke test: builds the browser
  bundle and the Vite demo (`examples/vitedemo`), then checks the output for
  stray Node references. Run with `npm run smoke:browser`.

## 🚀 Usage

Most scripts can be run from the repository root:

```bash
# Build the library first
npm run build

# Run a script
node scripts/analysis/analyze_pageset.js path/to/pageset.gridset
node scripts/analysis/extract_vocabulary.js path/to/pageset.gridset
npx ts-node scripts/conversion/txt-to-gridset.ts input.tsv output.gridset

# Benchmark a processor by file type (loadIntoTree)
node scripts/bench.js --file examples/example.gridset

# Benchmark text extraction
node scripts/bench.js --file examples/example.obz --mode extract --iterations 10

# Benchmark translation processing
node scripts/bench.js --file examples/example.sps --mode process --iterations 3
```

## 🔑 Environment Variables

For translation scripts:

```bash
# Azure Translator
export AZURE_TRANSLATOR_KEY="your-key"
export AZURE_TRANSLATOR_REGION="uksouth"

# Google Translate
export GOOGLE_TRANSLATE_KEY="your-key"

# Gemini API
export GEMINI_API_KEY="your-key"
```

See `.envrc.example` for all available environment variables.

## 📝 Notes

- These scripts use the built `dist/` directory
- Run `npm run build` before executing TypeScript scripts
- Scripts that create output files will respect `.gitignore`
- No `node_modules` in this directory - uses workspace dependencies
- Output files (`.gridset`, `.output.*`, etc.) are automatically ignored

## 🔗 Related

- **examples/** - Working code examples for all processors
- **examples/demo.js** - Comprehensive demo of all formats
- **examples/typescript-demo.ts** - TypeScript API examples
- **examples/translate_demo.js** - Translation workflow demo
- Main **README.md** - Complete library documentation
