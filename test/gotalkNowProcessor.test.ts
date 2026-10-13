// Tests for GotalkNowProcessor: load, extract, translate round-trip, save round-trip
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import plist from 'plist';
import { GotalkNowProcessor } from '../src/processors/gotalkNowProcessor';
import { decodeNsColor, decodeNsFont } from '../src/processors/gotalkNow/nsKeyed';
import { AACTree, AACPage, AACButton } from '../src/core/treeStructure';
import { getProcessor } from '../src/core/analyze';

/**
 * Build a minimal but realistic .gtbz fixture in a temp dir.
 * Mirrors the structure of real GoTalk NOW archives.
 */
function buildFixtureGtbz(outPath: string): void {
  const zip = new AdmZip();

  const bookInfo = { GoTalkBookFormatVersion: 1 };

  // System page (-5): express bar with a back/jump button to page 1.
  // Content page (1): a 4-button page with TTS + Jump buttons.
  const pageData = {
    '-5': {
      Buttons: {
        '0': { ActionData: { TTSText: '' }, ButtonType: 'TTS' },
        '1': { ActionData: { TTSText: '' }, ButtonType: 'TTS' },
        '3': {
          ActionData: { JumpTo: 1, TTSText: '' },
          ButtonText: ' ',
          ButtonType: 'Jump',
        },
      },
    },
    1: {
      ButtonCount: 2,
      PageTitle: 'Mit dem Hund spielen',
      BackgroundColor: Buffer.from('nonsense-color-blob'),
      Buttons: {
        '0': {
          ActionData: { TTSText: '' },
          ButtonText: 'Ich möchte mit ChiChi spielen!',
          ButtonType: 'TTS',
        },
        '1': {
          ActionData: { TTSText: 'Willst du spielen?' },
          ButtonText: 'Willst du spielen?',
          ButtonType: 'TTS',
        },
      },
    },
  };

  const pageOrder = [1];

  zip.addFile('BookInfo.plist', Buffer.from(plist.build(bookInfo)));
  zip.addFile('PageData.plist', Buffer.from(plist.build(pageData)));
  zip.addFile('PageOrder.plist', Buffer.from(plist.build(pageOrder)));
  zip.addFile('PageHistory.plist', Buffer.from(plist.build([])));
  // A dummy image referenced by no button, to exercise asset preservation.
  zip.addFile('Source-1-0-DUMMY.png', Buffer.from('not-a-real-png'));

  zip.writeZip(outPath);
}

describe('GotalkNowProcessor', () => {
  const fixturePath = path.join(__dirname, 'temp_gotalknow_fixture.gtbz');
  const tempOutputPath = path.join(__dirname, 'temp_gotalknow_out.gtbz');
  const tempSavePath = path.join(__dirname, 'temp_gotalknow_save.gtbz');

  beforeAll(() => {
    buildFixtureGtbz(fixturePath);
  });

  afterAll(() => {
    for (const p of [fixturePath, tempOutputPath, tempSavePath]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  describe('loadIntoTree', () => {
    it('loads a .gtbz into an AACTree', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);

      expect(tree).toBeInstanceOf(AACTree);
      expect(tree.metadata.format).toBe('gotalknow');
      expect(tree.metadata.version).toBe('1');
      // Two pages present (system page -5 + content page 1).
      expect(Object.keys(tree.pages).length).toBeGreaterThanOrEqual(2);
    });

    it('sets the home page from PageOrder', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      expect(tree.metadata.defaultHomePageId).toBe('1');
    });

    it('uses PageTitle as the page name', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      expect(tree.pages['1'].name).toBe('Mit dem Hund spielen');
    });

    it('maps TTS buttons to SPEAK_TEXT semantic actions', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      const page1 = tree.pages['1'];
      expect(page1).toBeDefined();

      const btn0 = page1.buttons.find((b) => b.id === '1_btn_0');
      expect(btn0).toBeDefined();
      expect(btn0?.label).toBe('Ich möchte mit ChiChi spielen!');
      // Empty TTSText → label is spoken.
      expect(btn0?.message).toBe('Ich möchte mit ChiChi spielen!');
      expect(String(btn0?.semanticAction?.intent)).toBe('SPEAK_TEXT');
    });

    it('uses explicit TTSText as message when set', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      const btn1 = tree.pages['1'].buttons.find((b) => b.id === '1_btn_1');
      expect(btn1?.label).toBe('Willst du spielen?');
      expect(btn1?.message).toBe('Willst du spielen?');
    });

    it('maps Jump buttons to NAVIGATE_TO semantic actions', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      const jumpBtn = tree.pages['-5'].buttons.find((b) => b.id === '-5_btn_3');
      expect(jumpBtn).toBeDefined();
      expect(String(jumpBtn?.semanticAction?.intent)).toBe('NAVIGATE_TO');
      expect(jumpBtn?.targetPageId).toBe('1');
    });

    it('derives a grid from ButtonCount', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(fixturePath);
      const page1 = tree.pages['1'];
      // ButtonCount 2 → near-square rectangle: 2 cols × 1 row.
      expect(page1.grid.length).toBe(1);
      expect(page1.grid[0].length).toBe(2);
    });

    it('throws ValidationFailureError for a non-gtbz input', async () => {
      const processor = new GotalkNowProcessor();
      await expect(processor.loadIntoTree(Buffer.from('not a zip'))).rejects.toThrow();
    });
  });

  describe('extractTexts', () => {
    it('extracts button labels and messages', async () => {
      const processor = new GotalkNowProcessor();
      const texts = await processor.extractTexts(fixturePath);
      expect(texts).toContain('Ich möchte mit ChiChi spielen!');
      expect(texts).toContain('Willst du spielen?');
    });
  });

  describe('processTexts (round-trip preserving assets)', () => {
    it('translates text fields and preserves all other archive entries', async () => {
      const processor = new GotalkNowProcessor();
      const translations = new Map<string, string>([
        ['Ich möchte mit ChiChi spielen!', 'I want to play with ChiChi!'],
        ['Willst du spielen?', 'Do you want to play?'],
      ]);

      const buffer = await processor.processTexts(fixturePath, translations, tempOutputPath);
      expect(buffer.byteLength).toBeGreaterThan(0);

      // The translated file should still be a valid zip with all original entries.
      const outZip = new AdmZip(tempOutputPath);
      const names = outZip.getEntries().map((e) => e.entryName);
      expect(names).toContain('BookInfo.plist');
      expect(names).toContain('PageData.plist');
      expect(names).toContain('PageOrder.plist');
      expect(names).toContain('PageHistory.plist');
      expect(names).toContain('Source-1-0-DUMMY.png'); // asset preserved

      // Reload and verify the new text.
      const newTexts = await processor.extractTexts(tempOutputPath);
      expect(newTexts).toContain('I want to play with ChiChi!');
      expect(newTexts).toContain('Do you want to play?');
      // Original German text should no longer be present.
      expect(newTexts).not.toContain('Ich möchte mit ChiChi spielen!');
    });
  });

  describe('saveFromTree (round-trip)', () => {
    it('builds a .gtbz from a tree and reloads it', async () => {
      const processor = new GotalkNowProcessor();

      const tree = new AACTree();
      tree.metadata.format = 'gotalknow';

      const page = new AACPage({ id: '1', name: 'Page 1', buttons: [] });
      page.addButton(
        new AACButton({ id: '1_btn_0', label: 'Hello', message: 'Hello there', type: 'SPEAK' })
      );
      page.addButton(
        new AACButton({
          id: '1_btn_1',
          label: 'Go',
          message: '',
          type: 'NAVIGATE',
          targetPageId: '2',
        })
      );
      tree.addPage(page);

      await processor.saveFromTree(tree, tempSavePath);
      expect(fs.existsSync(tempSavePath)).toBe(true);

      const reloaded = await processor.loadIntoTree(tempSavePath);
      expect(reloaded.pages['1']).toBeDefined();
      expect(reloaded.pages['1'].buttons.length).toBe(2);

      const speakBtn = reloaded.pages['1'].buttons.find((b) => b.id === '1_btn_0');
      expect(speakBtn?.label).toBe('Hello');

      const navBtn = reloaded.pages['1'].buttons.find((b) => b.id === '1_btn_1');
      expect(String(navBtn?.semanticAction?.intent)).toBe('NAVIGATE_TO');
      expect(navBtn?.targetPageId).toBe('2');
    });
  });

  describe('getProcessor factory', () => {
    it('returns a GotalkNowProcessor for .gtbz', () => {
      const processor = getProcessor('gotalknow');
      expect(processor).toBeInstanceOf(GotalkNowProcessor);
    });

    it('returns a GotalkNowProcessor via extension path', () => {
      const { getProcessor: factory } = require('../src/index.node');
      const processor = factory('sample.gtbz');
      expect(processor).toBeInstanceOf(GotalkNowProcessor);
    });
  });

  describe('alias methods (platform compatibility)', () => {
    it('extractStringsWithMetadata returns structured strings', async () => {
      const processor = new GotalkNowProcessor();
      const result = await processor.extractStringsWithMetadata(fixturePath);
      expect(result.errors).toHaveLength(0);
      expect(result.extractedStrings.length).toBeGreaterThan(0);
      const labels = result.extractedStrings.map((s) => s.string);
      expect(labels).toContain('Ich möchte mit ChiChi spielen!');
    });
  });

  describe('NSKeyedArchiver decoders', () => {
    it('decodes an NSRGB colour triplet to hex', () => {
      // "0.908 0.355 0.522" embedded in a fake archiver blob.
      const blob = Buffer.from('junkNSRGB\x00\x000.908 0.355 0.522\x00tail', 'latin1');
      expect(decodeNsColor(blob)).toBe('#e85b85');
    });

    it('returns undefined for NSWhite colours (binary-encoded, not readable)', () => {
      // NSWhite stores floats as raw IEEE-754, not a readable triplet.
      const blob = Buffer.from('bplist00NSWhiteUIColorwhiteColor', 'latin1');
      expect(decodeNsColor(blob)).toBeUndefined();
    });

    it('returns undefined for unparseable colour data', () => {
      expect(decodeNsColor(Buffer.from('no floats here!'))).toBeUndefined();
    });

    it('extracts a font family name', () => {
      const blob = Buffer.from('UIFontName\x00Futura-Medium\x00NSStuff', 'latin1');
      expect(decodeNsFont(blob).fontFamily).toBe('Futura-Medium');
    });

    it('returns no family when only keywords are present', () => {
      const blob = Buffer.from('UIFont NSDictionary NSObject', 'latin1');
      expect(decodeNsFont(blob).fontFamily).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // .gotalk-book share-export variant: everything nested under
  // <BookName>.gotalk-book/, __MACOSX cruft, snapshot images, library symbols.
  // Synthetic fixture modelled on real share exports (no real-user data).
  // -------------------------------------------------------------------------
  describe('gotalk-book share export variant', () => {
    const nestedFixturePath = path.join(__dirname, 'temp_gotalkbook_fixture.gotalk-book.zip');
    const nestedTranslateOut = path.join(__dirname, 'temp_gotalkbook_translated.zip');
    const DIR = 'Demo Book.gotalk-book';

    function buildNestedFixture(outPath: string): void {
      const zip = new AdmZip();
      const bookInfo = { GoTalkBookFormatVersion: 1 };
      const pageData = {
        1: {
          ButtonCount: 9,
          PageTitle: 'Wunsch',
          Buttons: {
            // Library symbol (Metacom): no bundled file should be resolved.
            '0': {
              ActionData: { TTSText: '' },
              ButtonText: 'trinken',
              ButtonType: 'TTS',
              ButtonImages: [
                {
                  SourceLibrary: 'Metacom',
                  SourceImageName: 'symbols/trinken.png',
                  QuickRecoveryPath: 'var/mobile/Containers/…/trinken.png',
                },
              ],
            },
            // Bundled user image: QuickRecoveryPath is an iOS container path;
            // resolution must happen by basename against the archive.
            '1': {
              ActionData: { TTSText: '' },
              ButtonText: 'Hund',
              ButtonType: 'TTS',
              ButtonImages: [
                {
                  SourceLibrary: '',
                  QuickRecoveryPath: 'var/mobile/Containers/…/Documents/my-dog.JPG',
                },
              ],
            },
            // Two entries where the first is app clip-art ("GoTalk Image
            // Library"): the second entry is the user's snapshot image.
            '2': {
              ActionData: { TTSText: '' },
              ButtonText: 'Pause',
              ButtonType: 'TTS',
              ButtonImages: [
                { SourceLibrary: 'GoTalk Image Library', SourceImageName: 'clipart/break' },
                { SourceLibrary: '', Location: 'somewhere/1-2-9.png' },
              ],
            },
            // No usable image entry at all -> snapshot fallback <page>-<btn>-<count>.
            '3': {
              ActionData: { TTSText: '' },
              ButtonText: 'fertig',
              ButtonType: 'TTS',
              ButtonImages: [{ SourceLibrary: '', Location: 'gone/missing.png' }],
            },
            // Jump with the sentinel value 0 -> no navigation target.
            '4': {
              ActionData: { JumpTo: 0, TTSText: '' },
              ButtonText: 'zurück',
              ButtonType: 'Jump',
            },
            // Jump with a real target.
            '5': {
              ActionData: { JumpTo: 2, TTSText: '' },
              ButtonText: 'weiter',
              ButtonType: 'Jump',
            },
          },
        },
        // Sparse buttons, no ButtonCount: grid size = max(index)+1 = 3.
        2: {
          PageTitle: 'Gefühle',
          Buttons: {
            '0': { ActionData: { TTSText: '' }, ButtonText: 'ja', ButtonType: 'TTS' },
            '2': { ActionData: { TTSText: '' }, ButtonText: 'nein', ButtonType: 'TTS' },
          },
        },
      };
      const pageOrder = [1, 2];

      const p = (name: string): string => `${DIR}/${name}`;
      zip.addFile(p('BookInfo.plist'), Buffer.from(plist.build(bookInfo)));
      zip.addFile(
        p('PageData.plist'),
        Buffer.from(plist.build(pageData as unknown as plist.PlistValue))
      );
      zip.addFile(p('PageOrder.plist'), Buffer.from(plist.build(pageOrder)));
      zip.addFile(p('PageHistory.plist'), Buffer.from(plist.build([])));
      // Bundled images: extension guessing + case-insensitive basename.
      zip.addFile(p('my-dog.jpg'), Buffer.from('dog-bytes'));
      // Snapshot render (exact name page-btn-count.png).
      zip.addFile(p('1-2-9.png'), Buffer.from('snap-1-2'));
      zip.addFile(p('1-3-9.png'), Buffer.from('snap-1-3'));
      // macOS resource-fork cruft that must be ignored.
      zip.addFile(`__MACOSX/${DIR}/._PageData.plist`, Buffer.from('resource fork junk'));

      zip.writeZip(outPath);
    }

    beforeAll(() => {
      buildNestedFixture(nestedFixturePath);
    });

    afterAll(() => {
      for (const p of [nestedFixturePath, nestedTranslateOut]) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    });

    it('loads a nested .gotalk-book export (prefix + __MACOSX tolerance)', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      expect(Object.keys(tree.pages).sort()).toEqual(['1', '2']);
      expect(tree.metadata.defaultHomePageId).toBe('1');
      expect(tree.pages['1'].name).toBe('Wunsch');
    });

    it('resolves bundled images by basename with extension guessing', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const btn = tree.pages['1'].buttons.find((b) => b.label === 'Hund');
      expect(btn?.resolvedImageEntry).toBe(`${DIR}/my-dog.jpg`);
    });

    it('marks library symbols without resolving a bundled file', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const btn = tree.pages['1'].buttons.find((b) => b.label === 'trinken');
      expect(btn?.symbolLibrary).toBe('Metacom');
      expect(btn?.symbolPath).toBe('symbols/trinken.png');
      expect(btn?.resolvedImageEntry).toBeUndefined();
    });

    it('skips GoTalk Image Library clip-art and picks the user image entry', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const btn = tree.pages['1'].buttons.find((b) => b.label === 'Pause');
      expect(btn?.symbolLibrary).not.toBe('GoTalk Image Library');
      expect(btn?.resolvedImageEntry).toBe(`${DIR}/1-2-9.png`);
    });

    it('falls back to the rendered snapshot <page>-<btn>-<count>.png', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const btn = tree.pages['1'].buttons.find((b) => b.label === 'fertig');
      expect(btn?.resolvedImageEntry).toBe(`${DIR}/1-3-9.png`);
    });

    it('treats JumpTo 0 as no jump but keeps real Jump targets', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const back = tree.pages['1'].buttons.find((b) => b.label === 'zurück');
      const fwd = tree.pages['1'].buttons.find((b) => b.label === 'weiter');
      expect(back?.targetPageId).toBeUndefined();
      expect(fwd?.targetPageId).toBe('2');
    });

    it('sizes sparse pages by max button index + 1', async () => {
      const processor = new GotalkNowProcessor();
      const tree = await processor.loadIntoTree(nestedFixturePath);
      const page2 = tree.pages['2'];
      // max index 2 -> count 3 -> cols 2, rows 2 (near-square).
      expect(page2.grid.length).toBe(2);
      expect(page2.grid[0].length).toBe(2);
    });

    it('processTexts round-trips a nested export without flattening it', async () => {
      const processor = new GotalkNowProcessor();
      const translations = new Map([['ja', 'yes']]);
      await processor.processTexts(nestedFixturePath, translations, nestedTranslateOut);
      const out = new AdmZip(nestedTranslateOut);
      const names = out.getEntries().map((e) => e.entryName);
      expect(names).toContain(`${DIR}/PageData.plist`);
      expect(names).toContain(`${DIR}/my-dog.jpg`);
      expect(names).toContain(`__MACOSX/${DIR}/._PageData.plist`); // cruft preserved
      expect(names).not.toContain('PageData.plist'); // not hoisted to root
    });
  });
});
