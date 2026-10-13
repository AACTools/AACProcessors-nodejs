/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import JSZip from 'jszip';
import { BaseValidator } from './baseValidator';
import { ValidationResult } from './validationTypes';
import { defaultFileAdapter, FileAdapter, getBasename, toUint8Array } from '../utils/io';
import { openSqliteDatabase } from '../utils/sqlite';
import { parseXmlString } from '../utils/xml';

/**
 * Validator for Snap files (.spb, .sps)
 * Snap files are zipped packages containing XML configuration
 */
export class SnapValidator extends BaseValidator {
  constructor() {
    super();
  }

  /**
   * Validate a Snap file from disk
   */
  static async validateFile(
    filePath: string,
    fileAdapter?: FileAdapter
  ): Promise<ValidationResult> {
    const { readBinaryFromInput, getFileSize } = fileAdapter ?? defaultFileAdapter;
    const validator = new SnapValidator();
    const content = await readBinaryFromInput(filePath);
    const size = await getFileSize(filePath);
    return validator.validate(content, getBasename(filePath), size);
  }

  /**
   * Check if content is Snap format
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  static async identifyFormat(content: any, filename: string): Promise<boolean> {
    const name = filename.toLowerCase();
    if (name.endsWith('.spb') || name.endsWith('.sps')) {
      return true;
    }

    // Try to parse as ZIP and check for Snap structure
    try {
      const zip = await JSZip.loadAsync(toUint8Array(content));
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      return entries.some(
        (entry) => entry.name.includes('settings') || entry.name.includes('.xml')
      );
    } catch {
      return false;
    }
  }

  /**
   * Main validation method
   */
  async validate(
    content: Buffer | Uint8Array,
    filename: string,
    filesize: number
  ): Promise<ValidationResult> {
    this.reset();

    await this.add_check('filename', 'file extension', async () => {
      if (!filename.match(/\.(spb|sps)$/)) {
        this.warn('filename should end with .spb or .sps');
      }
    });

    if (this.isSQLiteBuffer(content)) {
      await this.validateSqliteStructure(content, filename);
      return this.buildResult(filename, filesize, 'snap');
    }

    let zip: JSZip | null = null;
    let validZip = false;

    await this.add_check('zip', 'valid zip package', async () => {
      try {
        zip = await JSZip.loadAsync(toUint8Array(content));
        const entries = Object.values(zip.files);
        validZip = entries.length > 0;
      } catch (e: any) {
        this.err(`file is not a valid zip package: ${e.message}`, true);
      }
    });

    if (!validZip || !zip) {
      return this.buildResult(filename, filesize, 'snap');
    }

    await this.validateSnapStructure(zip, filename);

    return this.buildResult(filename, filesize, 'snap');
  }

  /**
   * Validate Snap package structure
   */
  private async validateSnapStructure(zip: JSZip, _filename: string): Promise<void> {
    // Check for required files
    await this.add_check('required_files', 'required package files', async () => {
      const entries = Object.values(zip.files);
      const entryNames = entries.map((e) => e.name);

      // Look for common Snap files
      const hasSettings = entryNames.some((n) => n.toLowerCase().includes('settings'));
      const hasXml = entryNames.some((n) => n.toLowerCase().endsWith('.xml'));

      if (!hasSettings && !hasXml) {
        this.err('Snap package must contain settings.xml or similar configuration file');
      }

      if (entries.length === 0) {
        this.err('Snap package is empty');
      }
    });

    // Try to parse and validate the main settings file
    const settingsEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().includes('settings')
    );

    if (settingsEntry) {
      await this.validateSettingsFile(settingsEntry);
    }

    // Check for pages
    const pageEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().includes('page')
    );

    await this.add_check('pages', 'pages in package', async () => {
      if (pageEntries.length === 0) {
        this.warn('Snap package should contain at least one page file');
      }
    });

    // Validate a sample of pages
    const samplePages = pageEntries.slice(0, 5); // Limit to first 5 pages
    for (let i = 0; i < samplePages.length; i++) {
      await this.validatePageFile(samplePages[i], i);
    }

    // Check for images
    const imageEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().match(/\.(png|jpg|jpeg|gif|bmp)$/i)
    );

    await this.add_check('images', 'image files', async () => {
      if (imageEntries.length === 0) {
        this.warn('Snap package should contain image files for buttons');
      }
    });

    // Check for audio files
    const audioEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().match(/\.(wav|mp3|m4a|ogg)$/i)
    );

    await this.add_check('audio', 'audio files', async () => {
      // Audio files are optional, so just warn if missing
      if (audioEntries.length === 0) {
        // This is informational, not a warning
      }
    });

    // Check for unexpected files
    await this.add_check('unexpected_files', 'unexpected file types', async () => {
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      const unexpectedFiles = entries.filter((entry) => {
        const name = entry.name.toLowerCase();
        // Skip common system files and directories
        if (name.startsWith('__macosx') || name.startsWith('.ds_store')) {
          return false;
        }
        // Allowed file types
        return !name.match(/\.(xml|png|jpg|jpeg|gif|bmp|wav|mp3|m4a|ogg|json)$/i);
      });

      if (unexpectedFiles.length > 0) {
        const unexpectedNames = unexpectedFiles.map((f) => f.name).slice(0, 5);
        this.warn(`Package contains unexpected file types: ${unexpectedNames.join(', ')}`);
      }
    });
  }

  private isSQLiteBuffer(content: Buffer | Uint8Array): boolean {
    const header = 'SQLite format 3\u0000';
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    if (bytes.length < header.length) {
      return false;
    }
    for (let i = 0; i < header.length; i++) {
      if (bytes[i] !== header.charCodeAt(i)) {
        return false;
      }
    }
    return true;
  }

  private async validateSqliteStructure(
    content: Buffer | Uint8Array,
    _filename: string
  ): Promise<void> {
    await this.add_check('sqlite', 'valid SQLite database', async () => {
      let cleanup: (() => Promise<void>) | undefined;
      try {
        const result = await openSqliteDatabase(content, {
          readonly: true,
          fileAdapter: this._options.fileAdapter,
        });
        const db = result.db;
        cleanup = result.cleanup;

        const tableRows = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as Array<{ name: string }>;
        const tables = new Set(tableRows.map((row) => row.name));

        const requiredTables = [
          'Page',
          'Button',
          'ElementReference',
          'ElementPlacement',
          'PageSetProperties',
        ];
        const missingTables = requiredTables.filter((t) => !tables.has(t));
        if (missingTables.length > 0) {
          this.err(`Missing required Snap tables: ${missingTables.join(', ')}`);
        }

        const pageColumns = db.prepare('PRAGMA table_info(Page)').all() as Array<{ name: string }>;
        const pageColumnNames = new Set(pageColumns.map((c) => c.name));
        if (!pageColumnNames.has('UniqueId')) {
          this.err('Page table missing UniqueId column');
        }
        if (!pageColumnNames.has('Name') && !pageColumnNames.has('Title')) {
          this.err('Page table missing Name/Title columns');
        }

        const buttonColumns = db.prepare('PRAGMA table_info(Button)').all() as Array<{
          name: string;
        }>;
        const buttonColumnNames = new Set(buttonColumns.map((c) => c.name));
        if (!buttonColumnNames.has('Label') && !buttonColumnNames.has('Message')) {
          this.err('Button table missing Label/Message columns');
        }

        const pageCount = db.prepare('SELECT COUNT(*) as c FROM Page').get() as { c: number };
        if (!pageCount || pageCount.c === 0) {
          this.warn('Snap database has no pages');
        }

        if (tables.has('PageSetData')) {
          const dataCount = db.prepare('SELECT COUNT(*) as c FROM PageSetData').get() as {
            c: number;
          };
          if (!dataCount || dataCount.c === 0) {
            this.warn('Snap database has no PageSetData assets (images/audio may be missing)');
          }
        }
      } catch (e: any) {
        this.err(`file is not a valid SQLite database: ${e.message}`, true);
      } finally {
        if (cleanup) {
          await cleanup();
        }
      }
    });
  }

  /**
   * Validate the main settings file
   */
  private async validateSettingsFile(entry: JSZip.JSZipObject): Promise<void> {
    await this.add_check('settings_format', 'settings file format', async () => {
      try {
        const content = await entry.async('string');
        const xml = parseXmlString(content);

        // Check for expected root element
        if (!xml.settings && !xml.Settings && !xml.page && !xml.Page) {
          this.warn('settings file does not contain expected root element');
        }

        // Check for required settings attributes if present
        const settings = xml.settings || xml.Settings;
        if (settings) {
          const id = settings.$?.id || settings.$?.Id;
          const name = settings.$?.name || settings.$?.Name;

          if (!id && !name) {
            this.warn('settings should have an id or name attribute');
          }
        }
      } catch (e: any) {
        this.err(`Failed to parse settings file: ${e.message}`);
      }
    });
  }

  /**
   * Validate a page file
   */
  private async validatePageFile(entry: JSZip.JSZipObject, index: number): Promise<void> {
    await this.add_check(`page[${index}]`, `page file ${index}: ${entry.name}`, async () => {
      try {
        const content = await entry.async('string');
        const xml = parseXmlString(content);

        const page = xml.page || xml.Page;
        if (!page) {
          this.err(`Page file ${entry.name} does not contain a page element`);
          return;
        }

        // Check page attributes
        const pageId = page.$?.id || page.$?.Id;
        if (!pageId) {
          this.warn(`Page ${entry.name} is missing an id attribute`);
        }

        // Check for cells/buttons
        const cells = page.cells || page.Cells || page.button || page.Button;
        if (!cells || (Array.isArray(cells) && cells.length === 0)) {
          this.warn(`Page ${entry.name} has no cells or buttons`);
        }
      } catch (e: any) {
        this.err(`Failed to parse page file ${entry.name}: ${e.message}`);
      }
    });
  }
}
