import {
  ObfValidator,
  GridsetValidator,
  SnapValidator,
  TouchChatValidator,
} from '../src/validation';
import JSZip from 'jszip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

function createSqliteDbBuffer(schemaSql: string, insertSql?: string): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-test-sqlite-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const db = new Database(dbPath);
  try {
    db.exec(schemaSql);
    if (insertSql) {
      db.exec(insertSql);
    }
  } finally {
    db.close();
  }
  const buffer = fs.readFileSync(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
  return buffer;
}

describe('Validation Coverage Tests', () => {
  describe('ObfValidator - Extended Coverage', () => {
    it('should validate button with all valid attributes', async () => {
      const validObf = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [
          {
            id: 1,
            label: 'Test Button',
            vocalization: 'test',
            image_id: 'img1',
            sound_id: 'snd1',
            hidden: false,
            background_color: 'rgb(255, 0, 0)',
            border_color: 'rgba(255, 0, 0, 0.5)',
            action: ':speak',
            actions: [':speak', ':back'],
            load_board: {
              path: 'other.obf',
            },
            top: 0,
            left: 0,
            width: 100,
            height: 100,
          },
        ],
        grid: {
          rows: 1,
          columns: 1,
          order: [[1]],
        },
        images: [
          {
            id: 'img1',
            width: 100,
            height: 100,
            content_type: 'image/png',
            url: 'http://example.com/img.png',
          },
        ],
        sounds: [
          {
            id: 'snd1',
            duration: 1.5,
            content_type: 'audio/wav',
            path: '/sounds/test.wav',
          },
        ],
      };

      const content = Buffer.from(JSON.stringify(validObf));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(true);
      expect(result.errors).toBe(0);
    });

    it('should validate background attribute', async () => {
      const obfWithBackground = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        background: {
          color: 'rgb(255, 255, 255)',
        },
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithBackground));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid background attribute', async () => {
      const obfWithBadBackground = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        background: 'not-an-object',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithBadBackground));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
    });

    it('should validate button with ext_ prefix attributes', async () => {
      const obfWithExt = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [
          {
            id: 1,
            label: 'Test',
            ext_custom_field: 'allowed',
          },
        ],
        grid: {
          rows: 1,
          columns: 1,
          order: [[1]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithExt));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      // Should have warning but still be valid
      expect(result.errors).toBe(0);
    });

    it('should reject button without action prefix', async () => {
      const obfWithBadAction = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [
          {
            id: 1,
            label: 'Test',
            action: 'invalid-action', // Missing : or + prefix
          },
        ],
        grid: {
          rows: 1,
          columns: 1,
          order: [[1]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithBadAction));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(false);
    });

    it('should validate image with all attributes', async () => {
      const obfWithFullImage = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [
          {
            id: 'img1',
            width: 100,
            height: 100,
            content_type: 'image/png',
            data: 'base64data',
            url: 'http://example.com',
            path: '/path/to/image.png',
            data_url: 'data:image/png;base64,iVBORw0KG...',
          },
        ],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithFullImage));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(true);
    });

    it('should validate sound with all attributes', async () => {
      const obfWithFullSound = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [
          {
            id: 'snd1',
            duration: 2.5,
            content_type: 'audio/mp3',
            data: 'base64data',
            url: 'http://example.com/sound.mp3',
            path: '/sounds/test.mp3',
          },
        ],
      };

      const content = Buffer.from(JSON.stringify(obfWithFullSound));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(true);
    });

    it('should warn about old format version', async () => {
      const obfOldVersion = {
        format: 'open-board-0.0', // Old version
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfOldVersion));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.warnings).toBeGreaterThan(0);
      const hasVersionWarning = result.results.some(
        (r) => r.type === 'format_version' && r.warnings && r.warnings.length > 0
      );
      expect(hasVersionWarning).toBe(true);
    });

    it('should reject future format version', async () => {
      const obfFutureVersion = {
        format: 'open-board-99.9', // Future version
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfFutureVersion));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(false);
    });

    it('should validate ext_ prefixed board attributes', async () => {
      const obfWithExt = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        ext_custom_data: 'allowed',
        ext_another_field: { valid: true },
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };

      const content = Buffer.from(JSON.stringify(obfWithExt));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.errors).toBe(0);
    });

    it('should reject invalid sound duration', async () => {
      const obfWithBadDuration = {
        format: 'open-board-0.1',
        id: 'test-board',
        locale: 'en',
        name: 'Test Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [
          {
            id: 'snd1',
            duration: -1.5, // Negative duration
            content_type: 'audio/wav',
            path: '/sounds/test.wav',
          },
        ],
      };

      const content = Buffer.from(JSON.stringify(obfWithBadDuration));
      const result = await new ObfValidator().validate(content, 'test.obf', content.length);

      expect(result.valid).toBe(false);
    });
  });

  describe('ObfValidator - OBZ Coverage', () => {
    it('should validate complete OBZ structure', async () => {
      const zip = new JSZip();

      // Create manifest.json
      const manifest = {
        format: 'open-board-0.1',
        root: 'root.obf',
        paths: {
          boards: {
            board1: 'boards/board1.obf',
          },
          images: {
            img1: 'images/img1.png',
          },
          sounds: {
            snd1: 'sounds/snd1.wav',
          },
        },
      };
      zip.file('manifest.json', JSON.stringify(manifest));

      // Create root board
      const rootBoard = {
        format: 'open-board-0.1',
        id: 'board1',
        locale: 'en',
        name: 'Root Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };
      zip.file('boards/board1.obf', JSON.stringify(rootBoard));

      // Create placeholder image and sound files
      zip.file('images/img1.png', 'fake-image-data');
      zip.file('sounds/snd1.wav', 'fake-sound-data');

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await new ObfValidator().validate(content, 'test.obz', content.length);

      expect(result.format).toBe('obz');
      expect(result.filename).toBe('test.obz');
    });

    it('should detect missing manifest in OBZ', async () => {
      const zip = new JSZip();
      zip.file('somefile.txt', 'content');

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await new ObfValidator().validate(content, 'test.obz', content.length);

      expect(result.valid).toBe(false);
      const hasManifestError = result.results.some((r) => r.type === 'manifest' && r.error);
      expect(hasManifestError).toBe(true);
    });

    it('should detect manifest root file not in zip', async () => {
      const zip = new JSZip();

      const manifest = {
        format: 'open-board-0.1',
        root: 'missing.obf', // File doesn't exist
        paths: {
          boards: {},
          images: {},
          sounds: {},
        },
      };
      zip.file('manifest.json', JSON.stringify(manifest));

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await new ObfValidator().validate(content, 'test.obz', content.length);

      expect(result.valid).toBe(false);
    });

    it('should detect board ID mismatch in manifest', async () => {
      const zip = new JSZip();

      const manifest = {
        format: 'open-board-0.1',
        root: 'boards/board1.obf',
        paths: {
          boards: {
            board1: 'boards/board1.obf',
          },
          images: {},
          sounds: {},
        },
      };
      zip.file('manifest.json', JSON.stringify(manifest));

      // Board has different ID than manifest claims
      const board = {
        format: 'open-board-0.1',
        id: 'different-id', // Mismatch!
        locale: 'en',
        name: 'Board',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };
      zip.file('boards/board1.obf', JSON.stringify(board));

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await new ObfValidator().validate(content, 'test.obz', content.length);

      expect(result.valid).toBe(false);
    });

    it('should validate manifest paths structure', async () => {
      const zip = new JSZip();

      const manifest = {
        format: 'open-board-0.1',
        root: 'root.obf',
        paths: {
          boards: {},
          images: {},
          sounds: {},
        },
      };
      zip.file('manifest.json', JSON.stringify(manifest));

      const rootBoard = {
        format: 'open-board-0.1',
        id: 'root',
        locale: 'en',
        name: 'Root',
        buttons: [],
        grid: {
          rows: 1,
          columns: 1,
          order: [[null]],
        },
        images: [],
        sounds: [],
      };
      zip.file('root.obf', JSON.stringify(rootBoard));

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await new ObfValidator().validate(content, 'test.obz', content.length);

      expect(result.valid).toBe(true);
    });
  });

  describe('GridsetValidator - Extended Coverage', () => {
    it('should parse BOM-prefixed grid.xml entries inside a real gridset archive', async () => {
      const examplePath = path.join(__dirname, '..', 'examples', 'example.gridset');
      const result = await GridsetValidator.validateFile(examplePath);

      const gridChecks = result.results.filter((c) => c.type.startsWith('grid_xml['));
      expect(gridChecks.length).toBeGreaterThan(0);
      for (const check of gridChecks) {
        expect(check.valid).toBe(true);
        expect(check.error || '').not.toContain('failed to parse XML');
      }
    });

    it('should validate a full Grid 3 grid.xml', async () => {
      const fullGrid = `<?xml version="1.0" encoding="utf-8"?>
      <Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <GridGuid>test-grid</GridGuid>
        <ColumnDefinitions>
          <ColumnDefinition/><ColumnDefinition/><ColumnDefinition/>
        </ColumnDefinitions>
        <RowDefinitions>
          <RowDefinition/><RowDefinition/><RowDefinition/>
        </RowDefinitions>
        <Cells>
          <Cell X="1" Y="1">
            <Content>
              <CaptionAndImage><Caption>Hello</Caption></CaptionAndImage>
            </Content>
          </Cell>
          <Cell X="2" Y="1">
            <Content>
              <CaptionAndImage><Caption>World</Caption></CaptionAndImage>
            </Content>
          </Cell>
        </Cells>
      </Grid>`;

      const content = Buffer.from(fullGrid);
      const result = await new GridsetValidator().validate(content, 'test.gridset', content.length);

      expect(result).toBeDefined();
      expect(result.format).toBe('gridset');
    });

    it('should warn about missing GridGuid', async () => {
      const gridNoGuid = `<?xml version="1.0" encoding="utf-8"?>
      <Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <Cells>
          <Cell X="1" Y="1"/>
        </Cells>
      </Grid>`;

      const content = Buffer.from(gridNoGuid);
      const result = await new GridsetValidator().validate(content, 'test.gridset', content.length);

      expect(result).toBeDefined();
      const hasGuidWarning = result.results.some(
        (r) => r.warnings && r.warnings.some((w) => w.includes('GridGuid'))
      );
      expect(hasGuidWarning).toBe(true);
    });

    it('should warn about missing Cells element', async () => {
      const gridNoCells = `<?xml version="1.0" encoding="utf-8"?>
      <Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <GridGuid>empty</GridGuid>
      </Grid>`;

      const content = Buffer.from(gridNoCells);
      const result = await new GridsetValidator().validate(content, 'test.gridset', content.length);

      expect(result).toBeDefined();
      const hasCellsWarning = result.results.some(
        (r) => r.warnings && r.warnings.some((w) => w.includes('Cells'))
      );
      expect(hasCellsWarning).toBe(true);
    });

    it('should warn about empty Cells', async () => {
      const gridEmptyCells = `<?xml version="1.0" encoding="utf-8"?>
      <Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <GridGuid>empty-cells</GridGuid>
        <Cells></Cells>
      </Grid>`;

      const content = Buffer.from(gridEmptyCells);
      const result = await new GridsetValidator().validate(content, 'test.gridset', content.length);

      expect(result).toBeDefined();
      const hasEmptyWarning = result.results.some(
        (r) => r.warnings && r.warnings.some((w) => w.includes('at least one'))
      );
      expect(hasEmptyWarning).toBe(true);
    });
  });

  describe('SnapValidator - Extended Coverage', () => {
    it('should detect invalid zip format', async () => {
      const notAZip = Buffer.from('This is not a zip file');
      const result = await new SnapValidator().validate(notAZip, 'test.spb', notAZip.length);

      expect(result.valid).toBe(false);
    });

    it('should validate .sps extension', async () => {
      const notAZip = Buffer.from('Not a zip');
      const result = await new SnapValidator().validate(notAZip, 'test.sps', notAZip.length);

      expect(result.valid).toBe(false);
      expect(result.format).toBe('snap');
    });

    it('should validate sqlite-based Snap files', async () => {
      const sqliteBuffer = createSqliteDbBuffer(`
        CREATE TABLE Page (Id INTEGER PRIMARY KEY, UniqueId TEXT, Name TEXT, Title TEXT);
        CREATE TABLE Button (Id INTEGER PRIMARY KEY, Label TEXT, Message TEXT);
        CREATE TABLE ElementReference (Id INTEGER PRIMARY KEY, PageId INTEGER);
        CREATE TABLE ElementPlacement (Id INTEGER PRIMARY KEY, ElementReferenceId INTEGER);
        CREATE TABLE PageSetProperties (Id INTEGER PRIMARY KEY, Name TEXT);
      `);

      const result = await new SnapValidator().validate(
        sqliteBuffer,
        'test.sps',
        sqliteBuffer.length
      );

      expect(result.valid).toBe(true);
      expect(result.format).toBe('snap');
    });
  });

  describe('TouchChatValidator - Extended Coverage', () => {
    it('should validate TouchChat zip with sqlite db', async () => {
      const sqliteBuffer = createSqliteDbBuffer(
        `
        CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE pages (id INTEGER PRIMARY KEY, resource_id INTEGER);
        CREATE TABLE buttons (id INTEGER PRIMARY KEY, resource_id INTEGER);
        CREATE TABLE button_boxes (id INTEGER PRIMARY KEY);
        CREATE TABLE button_box_cells (id INTEGER PRIMARY KEY, resource_id INTEGER, button_box_id INTEGER);
        CREATE TABLE button_box_instances (id INTEGER PRIMARY KEY, page_id INTEGER, button_box_id INTEGER);
      `,
        `
        INSERT INTO resources (id, name) VALUES (1, 'Page 1');
        INSERT INTO pages (id, resource_id) VALUES (1, 1);
        INSERT INTO buttons (id, resource_id) VALUES (1, 1);
        INSERT INTO button_boxes (id) VALUES (1);
        INSERT INTO button_box_cells (id, resource_id, button_box_id) VALUES (1, 1, 1);
        INSERT INTO button_box_instances (id, page_id, button_box_id) VALUES (1, 1, 1);
      `
      );

      const zip = new AdmZip();
      zip.addFile('vocab.c4v', sqliteBuffer);
      const content = zip.toBuffer();

      const result = await new TouchChatValidator().validate(content, 'test.ce', content.length);

      expect(result).toBeDefined();
      expect(result.format).toBe('touchchat');
      expect(result.valid).toBe(true);
    });

    it('should validate complete TouchChat structure', async () => {
      const completeTouchChat = `<?xml version="1.0" encoding="utf-8"?>
      <PageSet id="test" name="Test Pageset">
        <Pages>
          <Page id="page1" name="Page 1" rows="3" columns="3">
            <Buttons>
              <Button id="btn1" label="Hello" vocalization="Hello world" row="0" column="0"/>
              <Button id="btn2" label="Goodbye" vocalization="Goodbye" row="0" column="1"/>
            </Buttons>
          </Page>
        </Pages>
      </PageSet>`;

      const content = Buffer.from(completeTouchChat);
      const result = await new TouchChatValidator().validate(content, 'test.ce', content.length);

      expect(result).toBeDefined();
      expect(result.format).toBe('touchchat');
      expect(result.valid).toBe(true);
    });

    it('should detect missing Pages element', async () => {
      const touchChatWithoutPages = `<?xml version="1.0" encoding="utf-8"?>
      <PageSet id="test" name="Test">
      </PageSet>`;

      const content = Buffer.from(touchChatWithoutPages);
      const result = await new TouchChatValidator().validate(content, 'test.ce', content.length);

      expect(result).toBeDefined();
      // Should have warnings about missing pages
    });

    it('should validate Page without Buttons', async () => {
      const touchChatWithoutButtons = `<?xml version="1.0" encoding="utf-8"?>
      <PageSet id="test" name="Test Pageset">
        <Pages>
          <Page id="page1" name="Page 1" rows="1" columns="1"/>
        </Pages>
      </PageSet>`;

      const content = Buffer.from(touchChatWithoutButtons);
      const result = await new TouchChatValidator().validate(content, 'test.ce', content.length);

      expect(result).toBeDefined();
      // Should have warnings about missing buttons
    });

    it('should validate Button with minimal attributes', async () => {
      const minimalTouchChat = `<?xml version="1.0" encoding="utf-8"?>
      <PageSet id="test" name="Test Pageset">
        <Pages>
          <Page id="page1" name="Page 1">
            <Buttons>
              <Button id="btn1" label="Test"/>
            </Buttons>
          </Page>
        </Pages>
      </PageSet>`;

      const content = Buffer.from(minimalTouchChat);
      const result = await new TouchChatValidator().validate(content, 'test.ce', content.length);

      expect(result).toBeDefined();
      expect(result.format).toBe('touchchat');
    });
  });
});
