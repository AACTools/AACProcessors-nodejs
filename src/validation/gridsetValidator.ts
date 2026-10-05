/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import * as xml2js from 'xml2js';
import { BaseValidator } from './baseValidator';
import { ValidationResult } from './validationTypes';
import {
  decodeText,
  defaultFileAdapter,
  FileAdapter,
  getBasename,
  toUint8Array,
} from '../utils/io';

/**
 * Validator for Grid3/Smartbox Gridset files (.gridset, .gridsetx)
 */
export class GridsetValidator extends BaseValidator {
  constructor() {
    super();
  }

  /**
   * Validate a Gridset file from disk
   */
  static async validateFile(
    filePath: string,
    fileAdapter?: FileAdapter
  ): Promise<ValidationResult> {
    const { readBinaryFromInput, getFileSize } = fileAdapter ?? defaultFileAdapter;
    const validator = new GridsetValidator();
    const content = await readBinaryFromInput(filePath);
    const size = await getFileSize(filePath);
    return validator.validate(content, getBasename(filePath), size);
  }

  /**
   * Check if content is Gridset format
   */
  static async identifyFormat(content: any, filename: string): Promise<boolean> {
    const name = filename.toLowerCase();
    if (name.endsWith('.gridset') || name.endsWith('.gridsetx')) {
      return true;
    }

    // Try to parse as XML and check for a Grid 3 <Grid> root element
    try {
      const contentStr = typeof content === 'string' ? content : decodeText(toUint8Array(content));
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(contentStr);
      return !!(result && (result.Grid || result.grid));
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

    const isEncrypted = filename.toLowerCase().endsWith('.gridsetx');

    // eslint-disable-next-line @typescript-eslint/require-await
    await this.add_check('filename', 'file extension', async () => {
      if (!filename.match(/\.gridsetx?$/)) {
        this.warn('filename should end with .gridset or .gridsetx');
      }
    });

    // For encrypted .gridsetx files, we can't validate the content
    if (isEncrypted) {
      // eslint-disable-next-line @typescript-eslint/require-await
      await this.add_check('encrypted_format', 'encrypted gridsetx file', async () => {
        this.warn('gridsetx files are encrypted and cannot be fully validated');
      });
      return this.buildResult(filename, filesize, 'gridset');
    }

    const isZip = this.isZip(content);

    if (isZip) {
      await this.validateZipArchive(content, filename, filesize);
    } else {
      await this.validateSingleXml(content, filename, filesize);
    }

    return this.buildResult(filename, filesize, 'gridset');
  }

  /**
   * Check if the buffer is a zip archive
   */
  private isZip(content: Buffer | Uint8Array): boolean {
    if (content.length < 4) return false;
    return content[0] === 0x50 && content[1] === 0x4b && content[2] === 0x03 && content[3] === 0x04;
  }

  /**
   * Validate a single grid.xml file (exploded/non-zip format)
   */
  private async validateSingleXml(
    content: Buffer | Uint8Array,
    filename: string,
    _filesize: number
  ): Promise<void> {
    let xmlObj: any = null;
    await this.add_check('xml_parse', 'valid XML', async () => {
      try {
        const parser = new xml2js.Parser();
        const contentStr = decodeText(content).replace(/^\uFEFF/, '');
        xmlObj = await parser.parseStringPromise(contentStr);
      } catch (e: any) {
        this.err(`Failed to parse XML: ${e.message}`, true);
      }
    });

    if (!xmlObj) return;

    await this.add_check('xml_structure', 'Grid root element', async () => {
      if (!xmlObj.Grid && !xmlObj.grid) {
        this.err('missing root Grid element', true);
      }
    });

    const grid = xmlObj.Grid || xmlObj.grid;
    if (grid) {
      await this.validateGridStructure(grid, filename);
    }
  }

  /**
   * Validate a ZIP archive (.gridset)
   *
   * Real Grid 3 archives do NOT contain a top-level gridset.xml. The required
   * structure is: Settings0/settings.xml + FileMap.xml + Grids/<name>/grid.xml
   * (+ optional Styles, images, thumbnails).
   */
  private async validateZipArchive(
    content: Buffer | Uint8Array,
    _filename: string,
    _filesize: number
  ): Promise<void> {
    const zip = await this._options.zipAdapter(content);
    const entries = zip.listFiles();

    // --- Required: at least one Grids/<name>/grid.xml ---
    const gridEntries = entries.filter((e) => /^Grids\/.+\/grid\.xml$/i.test(e));
    await this.add_check('grid_xml_presence', 'Grids/*/grid.xml presence', async () => {
      if (gridEntries.length === 0) {
        this.err('No Grids/<name>/grid.xml found in archive', true);
      }
    });

    // Validate the <Grid> structure of each grid.xml (sample up to 5)
    for (let i = 0; i < Math.min(gridEntries.length, 5); i++) {
      const entry = gridEntries[i];
      await this.add_check(`grid_xml[${entry}]`, `grid structure: ${entry}`, async () => {
        try {
          const gridXml = await zip.readFile(entry);
          const parser = new xml2js.Parser();
          const xmlObj = await parser.parseStringPromise(
            decodeText(toUint8Array(gridXml)).replace(/^\uFEFF/, '')
          );
          const grid = xmlObj.Grid || xmlObj.grid;
          if (!grid) {
            this.err(`${entry}: missing root <Grid> element`);
          } else {
            await this.validateGridStructure(grid, entry);
          }
        } catch (e: any) {
          this.err(`${entry}: failed to parse XML: ${e.message}`);
        }
      });
    }

    // --- Recommended: Settings0/settings.xml ---
    await this.add_check('settings_xml_presence', 'settings.xml presence', async () => {
      const settingsEntry = entries.find(
        (e) => e.toLowerCase() === 'settings.xml' || e.toLowerCase().endsWith('/settings.xml')
      );
      if (!settingsEntry) {
        this.warn('Missing settings.xml in archive (required for full metadata)');
      } else {
        try {
          const settingsXml = await zip.readFile(settingsEntry);
          const parser = new xml2js.Parser();
          const xmlObj = await parser.parseStringPromise(
            decodeText(toUint8Array(settingsXml)).replace(/^\uFEFF/, '')
          );
          const settings =
            xmlObj.GridSetSettings || xmlObj.gridSetSettings || xmlObj.GridsetSettings;
          if (!settings) {
            this.warn('Invalid settings.xml structure');
          } else {
            // Basic validation of settings.xml
            if (!settings.StartGrid && !settings.startGrid) {
              this.warn('settings.xml missing StartGrid element');
            }
          }
        } catch (e: any) {
          this.warn(`Failed to parse settings.xml: ${e.message}`);
        }
      }
    });

    // --- Recommended: FileMap.xml (used for image resolution) ---
    await this.add_check('filemap_presence', 'FileMap.xml presence', async () => {
      const filemapEntry = entries.find((e) => e.toLowerCase() === 'filemap.xml');
      if (!filemapEntry) {
        this.warn('Missing FileMap.xml in archive (used for image resolution)');
      }
    });
  }

  /**
   * Validate a real Grid 3 <Grid> element (from grid.xml).
   * Checks for GridGuid, Cells, and basic cell structure.
   */
  private async validateGridStructure(grid: any, label: string): Promise<void> {
    await this.add_check(`${label}_gridguid`, 'GridGuid', async () => {
      const guid = grid.GridGuid || grid.gridGuid;
      if (!guid) {
        this.warn(`${label}: missing <GridGuid> element`);
      }
    });

    await this.add_check(`${label}_cells`, 'Cells element', async () => {
      const cells = grid.Cells || grid.cells;
      if (!cells) {
        this.warn(`${label}: missing <Cells> element`);
        return;
      }
      const cellArray = cells[0]?.Cell || cells[0]?.cell;
      if (!cellArray || !Array.isArray(cellArray) || cellArray.length === 0) {
        this.warn(`${label}: <Cells> should contain at least one <Cell>`);
      }
    });
  }
}
