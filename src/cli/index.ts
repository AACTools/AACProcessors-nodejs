#!/usr/bin/env node
import { program } from 'commander';
import { prettyPrintTree } from './prettyPrint';
import { getProcessor } from '../core/analyze';
import { ProcessorOptions } from '../core/baseProcessor';
import {
  exportHistoryToBaton,
  readGrid3History,
  readSnapUsage,
} from '../utilities/analytics/history';
import { ComparisonAnalyzer, MetricsCalculator, dumpVocabulary } from '../utilities/analytics';
import type { VocabularyDump } from '../utilities/analytics';
import { getZipAdapter } from '../utils/zip';
import { CellScanningOrder, ScanningSelectionMethod } from '../types/aac';
import { defaultFileAdapter, extname } from '../utils/io';
import { readFileSync } from 'node:fs';

const { pathExists, isDirectory, join, basename, writeTextToPath } = defaultFileAdapter;

// Helper function to detect format from file/folder path
async function detectFormat(filePath: string): Promise<string> {
  // Check if it's a folder ending with .ascconfig
  if (
    (await pathExists(filePath)) &&
    (await isDirectory(filePath)) &&
    filePath.endsWith('.ascconfig')
  ) {
    return 'ascconfig';
  }

  // Map multi-file formats to their base processor
  if (filePath.endsWith('.obfset')) {
    return 'obf'; // Use ObfProcessor for .obfset files
  }
  if (filePath.endsWith('.gridset')) {
    return 'gridset';
  }
  if (filePath.endsWith('.gtbz')) {
    return 'gotalknow';
  }
  // GoTalk NOW share exports keep their book suffix before the archive
  // extension ("MyBook.gotalk-book.zip") — route on the book suffix.
  if (/\.gotalk-book(\.|$)/i.test(filePath)) {
    return 'gotalknow';
  }

  // Bare .zip: sniff the archive for GoTalk NOW plists (root or nested
  // <BookName>.gotalk-book/ folder). Other zip-based formats (.obz, .spb,
  // .gridset) always arrive with their own extension.
  if (filePath.toLowerCase().endsWith('.zip')) {
    try {
      const zip = await getZipAdapter(filePath, defaultFileAdapter);
      const files = zip.listFiles();
      const hasGoTalkPlists = files.some(
        (f: string) =>
          !f.startsWith('__MACOSX/') && /(^|\/)PageData\.plist$/.test(f.replace(/\\/g, '/'))
      );
      if (hasGoTalkPlists) return 'gotalknow';
    } catch {
      /* not a readable zip — fall through to extension-based detection */
    }
  }

  // Otherwise use file extension
  return extname(filePath).slice(1);
}

// Helper function to parse filtering options from CLI arguments
function parseFilteringOptions(options: {
  preserveAllButtons?: boolean;
  excludeNavigation?: boolean;
  excludeSystem?: boolean;
  excludeButtons?: string;
  gridsetPassword?: string;
}): ProcessorOptions {
  const processorOptions: ProcessorOptions = {};

  if (options.gridsetPassword) {
    processorOptions.gridsetPassword = options.gridsetPassword;
  }

  // Handle preserve all buttons flag
  if (options.preserveAllButtons) {
    processorOptions.preserveAllButtons = true;
    return processorOptions; // If preserving all, ignore other options
  }

  // Handle specific exclusion flags
  if (options.excludeNavigation !== undefined) {
    processorOptions.excludeNavigationButtons = options.excludeNavigation;
  }
  if (options.excludeSystem !== undefined) {
    processorOptions.excludeSystemButtons = options.excludeSystem;
  }

  // Handle custom button exclusion list
  if (options.excludeButtons) {
    const excludeList = options.excludeButtons
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    if (excludeList.length > 0) {
      processorOptions.customButtonFilter = (button) => {
        const label = button.label?.toLowerCase() || '';
        const message = button.message?.toLowerCase() || '';

        // Exclude if button label or message contains any of the excluded terms
        return !excludeList.some((term) => label.includes(term) || message.includes(term));
      };
    }
  }

  return processorOptions;
}

// Set version from package.json
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};
program.version(packageJson.version);

program
  .command('analyze <file>')
  .option('--format <format>', 'Format type (auto-detected if not specified)')
  .option('--pretty', 'Pretty print output')
  .option('--preserve-all-buttons', 'Preserve all buttons including navigation/system buttons')
  .option('--no-exclude-navigation', "Don't exclude navigation buttons (Home, Back)")
  .option('--no-exclude-system', "Don't exclude system buttons (Delete, Clear, etc.)")
  .option('--exclude-buttons <list>', 'Comma-separated list of button labels/terms to exclude')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .action(
    async (
      file: string,
      options: {
        format?: string;
        pretty?: boolean;
        preserveAllButtons?: boolean;
        excludeNavigation?: boolean;
        excludeSystem?: boolean;
        excludeButtons?: string;
        gridsetPassword?: string;
      }
    ) => {
      try {
        // Parse filtering options
        const filteringOptions = parseFilteringOptions(options);

        // Auto-detect format if not specified
        const format = options.format || (await detectFormat(file));
        const processor = getProcessor(format, filteringOptions);
        const tree = await processor.loadIntoTree(file);

        const result = {
          format,
          tree,
          filtering: filteringOptions,
        };

        if (options.pretty) {
          console.log(prettyPrintTree(result.tree));
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        console.error(
          'Error analyzing file:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('extract <file>')
  .option('--format <format>', 'Format type (auto-detected if not specified)')
  .option('--verbose', 'Verbose output')
  .option('--quiet', 'Quiet output')
  .option('--preserve-all-buttons', 'Preserve all buttons including navigation/system buttons')
  .option('--no-exclude-navigation', "Don't exclude navigation buttons (Home, Back)")
  .option('--no-exclude-system', "Don't exclude system buttons (Delete, Clear, etc.)")
  .option('--exclude-buttons <list>', 'Comma-separated list of button labels/terms to exclude')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .action(
    async (
      file: string,
      options: {
        format?: string;
        verbose?: boolean;
        quiet?: boolean;
        preserveAllButtons?: boolean;
        excludeNavigation?: boolean;
        excludeSystem?: boolean;
        excludeButtons?: string;
        gridsetPassword?: string;
      }
    ) => {
      try {
        // Parse filtering options
        const filteringOptions = parseFilteringOptions(options);

        // Auto-detect format if not specified
        const format = options.format || (await detectFormat(file));
        const processor = getProcessor(format, filteringOptions);
        const texts = await processor.extractTexts(file);

        if (!options.quiet) {
          if (options.verbose) {
            console.log(`Extracting texts from ${file} (format: ${format})`);
            console.log(`Found ${texts.length} text entries:`);

            // Show filtering info in verbose mode
            if (filteringOptions.preserveAllButtons) {
              console.log('Filtering: All buttons preserved');
            } else {
              const filters = [];
              if (filteringOptions.excludeNavigationButtons !== false) filters.push('navigation');
              if (filteringOptions.excludeSystemButtons !== false) filters.push('system');
              if (filteringOptions.customButtonFilter) filters.push('custom');
              if (filters.length > 0) {
                console.log(`Filtering: Excluding ${filters.join(', ')} buttons`);
              }
            }
          }
        }

        // Output the texts (one per line for easier processing)
        texts.forEach((text) => console.log(text));
      } catch (error) {
        console.error(
          'Error extracting texts:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('convert <input> <output>')
  .option('--format <format>', 'Output format (required)')
  .option('--preserve-all-buttons', 'Preserve all buttons including navigation/system buttons')
  .option('--no-exclude-navigation', "Don't exclude navigation buttons (Home, Back)")
  .option('--no-exclude-system', "Don't exclude system buttons (Delete, Clear, etc.)")
  .option('--exclude-buttons <list>', 'Comma-separated list of button labels/terms to exclude')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .action(
    async (
      input: string,
      output: string,
      options: {
        format?: string;
        preserveAllButtons?: boolean;
        excludeNavigation?: boolean;
        excludeSystem?: boolean;
        excludeButtons?: string;
        gridsetPassword?: string;
      }
    ) => {
      try {
        if (!options.format) {
          console.error('Error: --format option is required for convert command');
          process.exit(1);
        }

        // Parse filtering options
        const filteringOptions = parseFilteringOptions(options);

        // Auto-detect input format
        const inputFormat = await detectFormat(input);
        const inputProcessor = getProcessor(inputFormat, filteringOptions);

        // Load the tree (handle both files and folders)
        const tree = await inputProcessor.loadIntoTree(input);

        // Save using output format with same filtering options
        const outputProcessor = getProcessor(options.format, filteringOptions);
        await outputProcessor.saveFromTree(tree, output);

        // Show filtering summary
        let filteringSummary = '';
        if (filteringOptions.preserveAllButtons) {
          filteringSummary = ' (all buttons preserved)';
        } else {
          const filters = [];
          if (filteringOptions.excludeNavigationButtons !== false) filters.push('navigation');
          if (filteringOptions.excludeSystemButtons !== false) filters.push('system');
          if (filteringOptions.customButtonFilter) filters.push('custom');
          if (filters.length > 0) {
            filteringSummary = ` (filtered: ${filters.join(', ')} buttons)`;
          }
        }

        console.log(
          `Successfully converted ${input} to ${output} (${options.format} format)${filteringSummary}`
        );
      } catch (error) {
        console.error(
          'Error converting file:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('validate <file>')
  .description('Validate an AAC file format')
  .option('--format <format>', 'Format type (auto-detected if not specified)')
  .option('--json', 'Output results as JSON')
  .option('--quiet', 'Only output validation result (valid/invalid)')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .action(
    async (
      file: string,
      options: {
        format?: string;
        json?: boolean;
        quiet?: boolean;
        gridsetPassword?: string;
      }
    ) => {
      try {
        // Auto-detect format if not specified
        const format = options.format || (await detectFormat(file));

        // Get processor with gridset password if provided
        const processorOptions: ProcessorOptions = {};
        if (options.gridsetPassword) {
          processorOptions.gridsetPassword = options.gridsetPassword;
        }

        const processor = getProcessor(format, processorOptions);

        // Check if processor supports validation
        if (!processor.validate) {
          console.error(`Error: Validation not supported for format '${format}'`);
          process.exit(1);
        }

        // Run validation
        const result = await processor.validate(file);

        // Output results
        if (options.quiet) {
          console.log(result.valid ? 'valid' : 'invalid');
        } else if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Pretty print validation results
          console.log(`\nValidation Results for: ${result.filename}`);
          console.log(`Format: ${result.format}`);
          console.log(`File size: ${result.filesize} bytes`);
          console.log(`Status: ${result.valid ? '✓ VALID' : '✗ INVALID'}`);
          console.log(`Errors: ${result.errors}`);
          console.log(`Warnings: ${result.warnings}\n`);

          if (result.errors > 0 || result.warnings > 0) {
            if (result.errors > 0) {
              console.log('Errors:');
              result.results
                .filter((r) => !r.valid)
                .forEach((check) => {
                  console.log(`  ✗ ${check.description}`);
                  if (check.error) {
                    console.log(`    ${check.error}`);
                  }
                });
            }

            if (result.warnings > 0) {
              console.log('\nWarnings:');
              result.results.forEach((check) => {
                if (check.warnings && check.warnings.length > 0) {
                  console.log(`  ⚠ ${check.description}`);
                  check.warnings.forEach((warning) => {
                    console.log(`    ${warning}`);
                  });
                }
              });
            }
          }

          // Show sub-results if available
          if (result.sub_results && result.sub_results.length > 0) {
            console.log('\nSub-results:');
            result.sub_results.forEach((sub, idx) => {
              console.log(`  [${idx + 1}] ${sub.filename}`);
              console.log(
                `      Status: ${sub.valid ? '✓' : '✗'} (${sub.errors} errors, ${sub.warnings} warnings)`
              );
            });
          }

          console.log('');
        }

        // Exit with appropriate code
        process.exit(result.valid ? 0 : 1);
      } catch (error) {
        console.error(
          'Error validating file:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('history <input>')
  .option('--format <format>', 'Output format: raw or baton', 'raw')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--source <source>', 'History source: auto, grid3, snap', 'auto')
  .option('--anonymous-uuid <uuid>', 'Anonymous UUID for baton export')
  .option('--export-date <iso>', 'Export date for baton export (ISO string)')
  .option('--encryption <mode>', 'Encryption label for baton export', 'none')
  .option('--version <version>', 'Baton export version', '1.0')
  .action(
    async (
      input: string,
      options: {
        format?: string;
        out?: string;
        source?: string;
        anonymousUuid?: string;
        exportDate?: string;
        encryption?: string;
        version?: string;
      }
    ) => {
      try {
        if (!(await pathExists(input))) {
          throw new Error(`File not found: ${input}`);
        }

        const normalizedSource = (options.source || 'auto').toLowerCase();
        const ext = extname(input).toLowerCase();
        const isGrid3Db = ext === '.sqlite' || basename(input).toLowerCase() === 'history.sqlite';
        const isSnap = ext === '.sps' || ext === '.spb';

        let entries;
        if (normalizedSource === 'grid3' || (normalizedSource === 'auto' && isGrid3Db)) {
          entries = await readGrid3History(input);
        } else if (normalizedSource === 'snap' || (normalizedSource === 'auto' && isSnap)) {
          entries = await readSnapUsage(input);
        } else {
          throw new Error('Unable to detect history source. Use --source grid3 or --source snap.');
        }

        const format = (options.format || 'raw').toLowerCase();
        let payload: unknown = entries;

        if (format === 'baton') {
          payload = exportHistoryToBaton(entries, {
            version: options.version,
            exportDate: options.exportDate,
            encryption: options.encryption,
            anonymousUUID: options.anonymousUuid,
          });
        } else if (format !== 'raw') {
          throw new Error(`Unsupported format: ${format}`);
        }

        const output = JSON.stringify(payload, null, 2);
        if (options.out) {
          await writeTextToPath(options.out, output);
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error(
          'Error exporting history:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('metrics <file>')
  .option('--format <format>', 'Format type (auto-detected if not specified)')
  .option('--pretty', 'Pretty print JSON output')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--preserve-all-buttons', 'Preserve all buttons including navigation/system buttons')
  .option('--no-exclude-navigation', "Don't exclude navigation buttons (Home, Back)")
  .option('--no-exclude-system', "Don't exclude system buttons (Delete, Clear, etc.)")
  .option('--exclude-buttons <list>', 'Comma-separated list of button labels/terms to exclude')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .option('--access-method <method>', 'direct or scanning', 'direct')
  .option('--scanning-pattern <pattern>', 'linear, row-column, or block', 'row-column')
  .option(
    '--selection-method <method>',
    'auto-1-switch, step-1-switch, or step-2-switch',
    'auto-1-switch'
  )
  .option('--error-correction', 'Enable scanning error correction', false)
  .option('--use-prediction', 'Enable prediction in CARE scoring', false)
  .option('--no-smart-grammar', 'Disable smart grammar word forms')
  .option('--care', 'Include CARE comparison output', false)
  .action(
    async (
      file: string,
      options: {
        format?: string;
        pretty?: boolean;
        out?: string;
        preserveAllButtons?: boolean;
        excludeNavigation?: boolean;
        excludeSystem?: boolean;
        excludeButtons?: string;
        gridsetPassword?: string;
        accessMethod?: string;
        scanningPattern?: string;
        selectionMethod?: string;
        errorCorrection?: boolean;
        usePrediction?: boolean;
        smartGrammar?: boolean;
        care?: boolean;
      }
    ) => {
      try {
        const filteringOptions = parseFilteringOptions(options);
        const format = options.format || (await detectFormat(file));
        const processor = getProcessor(format, filteringOptions);
        const tree = await processor.loadIntoTree(file);

        const accessMethod = (options.accessMethod || 'direct').toLowerCase();
        const scanningPattern = (options.scanningPattern || 'row-column').toLowerCase();
        const selectionMethodParam = (options.selectionMethod || 'auto-1-switch').toLowerCase();
        const errorCorrection = !!options.errorCorrection;

        let scanningConfig = undefined;
        if (accessMethod === 'scanning') {
          let cellScanningOrder = CellScanningOrder.SimpleScan;
          let blockScanEnabled = false;

          switch (scanningPattern) {
            case 'linear':
              cellScanningOrder = CellScanningOrder.SimpleScan;
              break;
            case 'row-column':
              cellScanningOrder = CellScanningOrder.RowColumnScan;
              break;
            case 'block':
              cellScanningOrder = CellScanningOrder.RowColumnScan;
              blockScanEnabled = true;
              break;
            default:
              throw new Error(`Unsupported scanning pattern: ${scanningPattern}`);
          }

          let selectionMethod = ScanningSelectionMethod.AutoScan;
          switch (selectionMethodParam) {
            case 'auto-1-switch':
              selectionMethod = ScanningSelectionMethod.AutoScan;
              break;
            case 'step-1-switch':
              selectionMethod = ScanningSelectionMethod.StepScan1Switch;
              break;
            case 'step-2-switch':
              selectionMethod = ScanningSelectionMethod.StepScan2Switch;
              break;
            default:
              throw new Error(`Unsupported selection method: ${selectionMethodParam}`);
          }

          scanningConfig = {
            cellScanningOrder,
            blockScanEnabled,
            selectionMethod,
            errorCorrectionEnabled: errorCorrection,
            errorRate: errorCorrection ? 0.1 : undefined,
          };
        }

        const calculator = new MetricsCalculator();
        const metrics = await calculator.analyze(tree, {
          scanningConfig,
          useSmartGrammar: options.smartGrammar,
        });

        let care = undefined;
        if (options.care) {
          const comparison = new ComparisonAnalyzer();
          care = await comparison.compare(metrics, metrics, {
            includeSentences: true,
            usePrediction: !!options.usePrediction,
            scanningConfig,
          });
        }

        const result = {
          format,
          filtering: filteringOptions,
          accessMethod,
          scanningPattern,
          selectionMethod: selectionMethodParam,
          errorCorrection,
          metrics,
          care,
        };

        const output = options.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
        if (options.out) {
          await writeTextToPath(options.out, output);
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error(
          'Error calculating metrics:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

program
  .command('vocabulary <file>')
  .description(
    'Counts-only vocabulary inventory: buttons, wordlists, prediction dictionaries and word forms (no word lists are emitted)'
  )
  .option('--format <format>', 'Format type (auto-detected if not specified)')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--preserve-all-buttons', 'Preserve all buttons including navigation/system buttons')
  .option('--no-exclude-navigation', "Don't exclude navigation buttons (Home, Back)")
  .option('--no-exclude-system', "Don't exclude system buttons (Delete, Clear, etc.)")
  .option('--exclude-buttons <list>', 'Comma-separated list of button labels/terms to exclude')
  .option('--gridset-password <password>', 'Password for encrypted Grid3 archives (.gridsetx)')
  .option('--no-smart-grammar', 'Skip smart-grammar word-form counts')
  .action(
    async (
      file: string,
      options: {
        format?: string;
        out?: string;
        preserveAllButtons?: boolean;
        excludeNavigation?: boolean;
        excludeSystem?: boolean;
        excludeButtons?: string;
        gridsetPassword?: string;
        smartGrammar?: boolean;
      }
    ) => {
      try {
        const filteringOptions = parseFilteringOptions(options);
        const format = options.format || (await detectFormat(file));
        const processor = getProcessor(format, filteringOptions);

        // The gridset loader logs debug chatter to stdout; silence it so the
        // command's stdout is exactly one JSON document.
        const silenced = Object.entries(console).reduce(
          (acc, [k, fn]) => {
            acc[k] = fn;
            return acc;
          },
          {} as Record<string, unknown>
        );
        for (const k of ['log', 'info', 'debug', 'warn']) {
          (console as unknown as Record<string, unknown>)[k] = () => {};
        }
        let dump: VocabularyDump | undefined;
        try {
          const tree = await processor.loadIntoTree(file);
          // analyze() first: it expands morphological predictions on the tree,
          // which dumpVocabulary() needs for the word-form counts.
          const metrics = await new MetricsCalculator().analyze(tree, {
            useSmartGrammar: options.smartGrammar,
          });
          dump = dumpVocabulary(tree, { metrics });
        } finally {
          for (const [k, fn] of Object.entries(silenced)) {
            (console as unknown as Record<string, unknown>)[k] = fn as (...a: unknown[]) => void;
          }
        }

        const result = {
          format,
          filtering: filteringOptions,
          vocabulary: dump,
        };

        const output = JSON.stringify(result, null, 2);
        if (options.out) {
          await writeTextToPath(options.out, output);
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error(
          'Error dumping vocabulary:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    }
  );

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}

program.parse(process.argv);
