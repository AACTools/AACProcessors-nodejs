/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { BaseValidator } from './baseValidator';
import { ValidationResult } from './validationTypes';
import {
  decodeText,
  defaultFileAdapter,
  FileAdapter,
  getBasename,
  type ProcessorInput,
  toUint8Array,
} from '../utils/io';
import { openSqliteDatabase } from '../utils/sqlite';
import { parseXmlString } from '../utils/xml';
import { getZipAdapter, ZipAdapter } from '../utils/zip';

/**
 * Validator for TouchChat files (.ce)
 * TouchChat files are ZIP archives that contain a .c4v SQLite database.
 * Some legacy exports may be XML, so we support both formats.
 */
export class TouchChatValidator extends BaseValidator {
  constructor() {
    super();
  }

  /**
   * Validate a TouchChat file from disk
   */
  static async validateFile(
    filePath: string,
    fileAdapter?: FileAdapter
  ): Promise<ValidationResult> {
    const { readBinaryFromInput, getFileSize } = fileAdapter ?? defaultFileAdapter;
    const validator = new TouchChatValidator();
    const content = await readBinaryFromInput(filePath);
    const size = await getFileSize(filePath);
    return validator.validate(content, getBasename(filePath), size);
  }

  /**
   * Check if content is TouchChat format
   */
  static async identifyFormat(
    content: any,
    filename: string,
    fileAdapter: FileAdapter = defaultFileAdapter,
    zipAdapter?: (input: ProcessorInput) => Promise<ZipAdapter>
  ): Promise<boolean> {
    const name = filename.toLowerCase();
    if (name.endsWith('.ce')) {
      return true;
    }

    // Try to parse as ZIP and check for .c4v database
    try {
      const zip = zipAdapter
        ? await zipAdapter(content)
        : await getZipAdapter(content, fileAdapter);
      const entries = zip.listFiles();
      if (entries.some((entry) => entry.toLowerCase().endsWith('.c4v'))) {
        return true;
      }
    } catch {
      // Fall back to XML detection
    }

    // Try to parse as XML and check for TouchChat structure
    try {
      const contentStr = typeof content === 'string' ? content : decodeText(toUint8Array(content));
      const result = parseXmlString(contentStr);
      // TouchChat files typically have specific structure
      return result && (result.PageSet || result.Pageset || result.page || result.Page);
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
      if (!filename.match(/\.ce$/i)) {
        this.warn('filename should end with .ce');
      }
    });

    const looksLikeXml = this.isXmlBuffer(content);
    const zipped = looksLikeXml
      ? false
      : await this.tryValidateZipSqlite(
          content,
          this._options.fileAdapter,
          this._options.zipAdapter
        );
    if (!zipped) {
      let xmlObj: any = null;
      await this.add_check('xml_parse', 'valid XML', async () => {
        try {
          const contentStr = decodeText(content);
          xmlObj = parseXmlString(contentStr);
        } catch (e: any) {
          this.err(`Failed to parse XML: ${e.message}`, true);
        }
      });

      if (!xmlObj) {
        return this.buildResult(filename, filesize, 'touchchat');
      }

      await this.add_check('xml_structure', 'TouchChat root element', async () => {
        // TouchChat can have different root elements
        const hasValidRoot =
          xmlObj.PageSet ||
          xmlObj.Pageset ||
          xmlObj.page ||
          xmlObj.Page ||
          xmlObj.pages ||
          xmlObj.Pages;

        if (!hasValidRoot) {
          this.err('file does not contain a recognized TouchChat structure');
        }
      });

      const root =
        xmlObj.PageSet ||
        xmlObj.Pageset ||
        xmlObj.page ||
        xmlObj.Page ||
        xmlObj.pages ||
        xmlObj.Pages;
      if (root) {
        await this.validateTouchChatStructure(root);
      }
    }

    return this.buildResult(filename, filesize, 'touchchat');
  }

  /**
   * Validate TouchChat structure
   */
  private async validateTouchChatStructure(root: any): Promise<void> {
    // Check for ID
    await this.add_check('root_id', 'root element ID', async () => {
      const id = root.$?.id || root.$?.Id;
      if (!id) {
        this.warn('root element should have an id attribute');
      }
    });

    // Check for name
    await this.add_check('root_name', 'root element name', async () => {
      const name = root.$?.name || root.$?.Name || root.name?.[0];
      if (!name) {
        this.warn('root element should have a name');
      }
    });

    // Check for pages
    await this.add_check('pages', 'pages collection', async () => {
      const pages = root.page || root.Page || root.pages || root.Pages;
      if (!pages) {
        this.err('TouchChat file must contain pages');
      } else if (!Array.isArray(pages) || pages.length === 0) {
        this.err('TouchChat file must contain at least one page');
      }
    });

    // Validate individual pages
    const pages = root.page || root.Page || root.pages || root.Pages;
    if (pages && Array.isArray(pages)) {
      await this.add_check('page_count', 'page count', async () => {
        if (pages.length === 0) {
          this.err('Must contain at least one page');
        }
      });

      // Sample first few pages
      const sampleSize = Math.min(pages.length, 5);
      for (let i = 0; i < sampleSize; i++) {
        await this.validatePage(pages[i], i);
      }
    }
  }

  /**
   * Validate a single page
   */
  private async validatePage(page: any, index: number): Promise<void> {
    await this.add_check(`page[${index}]_id`, `page ${index} ID`, async () => {
      const id = page.$?.id || page.$?.Id;
      if (!id) {
        this.warn(`page ${index} is missing an id attribute`);
      }
    });

    await this.add_check(`page[${index}]_name`, `page ${index} name`, async () => {
      const name = page.$?.name || page.$?.Name || page.name?.[0];
      if (!name) {
        this.warn(`page ${index} should have a name`);
      }
    });

    // Check for buttons/items
    await this.add_check(`page[${index}]_buttons`, `page ${index} buttons`, async () => {
      const buttons = page.button || page.Button || page.item || page.Item;
      if (!buttons) {
        this.warn(`page ${index} has no buttons/items`);
      } else if (Array.isArray(buttons) && buttons.length === 0) {
        this.warn(`page ${index} should contain at least one button`);
      }
    });

    // Validate button references
    const buttons = page.button || page.Button || page.item || page.Item;
    if (buttons && Array.isArray(buttons)) {
      const sampleSize = Math.min(buttons.length, 3);
      for (let i = 0; i < sampleSize; i++) {
        await this.validateButton(buttons[i], index, i);
      }
    }
  }

  /**
   * Validate a single button
   */
  private async validateButton(button: any, pageIdx: number, buttonIdx: number): Promise<void> {
    await this.add_check(
      `page[${pageIdx}]_button[${buttonIdx}]_label`,
      `button label`,
      async () => {
        const label = button.$?.label || button.$?.Label || button.label?.[0];
        if (!label) {
          this.warn(`button ${buttonIdx} on page ${pageIdx} should have a label`);
        }
      }
    );

    await this.add_check(
      `page[${pageIdx}]_button[${buttonIdx}]_vocalization`,
      `button vocalization`,
      async () => {
        const vocalization =
          button.$?.vocalization || button.$?.Vocalization || button.vocalization?.[0];
        if (!vocalization) {
          // Vocalization is optional, so just info
        }
      }
    );

    // Check for image reference
    await this.add_check(
      `page[${pageIdx}]_button[${buttonIdx}]_image`,
      `button image`,
      async () => {
        const image = button.$?.image || button.$?.Image || button.img?.[0];
        if (!image) {
          this.warn(`button ${buttonIdx} on page ${pageIdx} should have an image reference`);
        }
      }
    );

    // Check for link/action
    await this.add_check(
      `page[${pageIdx}]_button[${buttonIdx}]_action`,
      `button action`,
      async () => {
        const link = button.$?.link || button.$?.Link;
        const action = button.$?.action || button.$?.Action;
        if (!link && !action) {
          // Not all buttons need actions, they can just speak
        }
      }
    );
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

  private isXmlBuffer(content: Buffer | Uint8Array): boolean {
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    const max = Math.min(bytes.length, 256);
    let start = 0;
    while (start < max) {
      const ch = bytes[start];
      if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09) {
        start += 1;
        continue;
      }
      break;
    }
    if (start >= max) {
      return false;
    }
    return bytes[start] === 0x3c; // '<'
  }

  private async tryValidateZipSqlite(
    content: Buffer | Uint8Array,
    fileAdapter: FileAdapter = defaultFileAdapter,
    zipAdapter?: (input: ProcessorInput) => Promise<ZipAdapter>
  ): Promise<boolean> {
    let usedZip = false;
    await this.add_check('zip', 'TouchChat ZIP package', async () => {
      try {
        const zip = zipAdapter
          ? await zipAdapter(content)
          : await getZipAdapter(content, fileAdapter);
        const entries = zip.listFiles();
        const vocabEntry = entries.find((name) => name.toLowerCase().endsWith('.c4v'));
        if (!vocabEntry) {
          this.err('TouchChat package missing .c4v database', true);
          return;
        }
        const dbBuffer = await zip.readFile(vocabEntry);
        if (!this.isSQLiteBuffer(dbBuffer)) {
          this.err('TouchChat .c4v is not a valid SQLite database', true);
          return;
        }
        usedZip = true;
        await this.validateSqliteStructure(dbBuffer);
      } catch (e: any) {
        this.err(`file is not a valid TouchChat ZIP package: ${e.message}`, true);
      }
    });
    return usedZip;
  }

  private async validateSqliteStructure(content: Buffer | Uint8Array): Promise<void> {
    await this.add_check('sqlite', 'valid TouchChat SQLite database', async () => {
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
          'resources',
          'pages',
          'buttons',
          'button_boxes',
          'button_box_cells',
          'button_box_instances',
        ];
        const missingTables = requiredTables.filter((t) => !tables.has(t));
        if (missingTables.length > 0) {
          this.err(`Missing required TouchChat tables: ${missingTables.join(', ')}`);
        }

        const resourcesCols = new Set(
          db
            .prepare('PRAGMA table_info(resources)')
            .all()
            .map((row: any) => row.name)
        );
        if (!resourcesCols.has('id') || !resourcesCols.has('name')) {
          this.err('resources table missing id/name columns');
        }

        const pagesCols = new Set(
          db
            .prepare('PRAGMA table_info(pages)')
            .all()
            .map((row: any) => row.name)
        );
        if (!pagesCols.has('id') || !pagesCols.has('resource_id')) {
          this.err('pages table missing id/resource_id columns');
        }

        const buttonsCols = new Set(
          db
            .prepare('PRAGMA table_info(buttons)')
            .all()
            .map((row: any) => row.name)
        );
        if (!buttonsCols.has('id') || !buttonsCols.has('resource_id')) {
          this.err('buttons table missing id/resource_id columns');
        }

        const pageCount = db.prepare('SELECT COUNT(*) as c FROM pages').get() as { c: number };
        if (!pageCount || pageCount.c === 0) {
          this.warn('TouchChat database has no pages');
        }
      } catch (e: any) {
        this.err(`TouchChat database validation failed: ${e.message}`, true);
      } finally {
        if (cleanup) {
          await cleanup();
        }
      }
    });
  }
}
