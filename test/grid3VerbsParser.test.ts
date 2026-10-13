/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Grid3VerbsParser } from '../src/utilities/analytics/morphology/grid3VerbsParser';
import { join } from 'path';

const SYNTHETIC_XML = join(__dirname, 'assets', 'grid3', 'synthetic-verbs.xml');

// Users can set GRID3_MORPHOLOGY_DIR to point to their own copy of
// Grid 3's Locale directory (e.g. copied from another machine).
// Example: GRID3_MORPHOLOGY_DIR=/path/to/Grid3/Locale npm test
const MORPHOLOGY_DIR =
  process.env.GRID3_MORPHOLOGY_DIR ||
  (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Smartbox\\Grid 3\\Locale' : '');

const parser = new Grid3VerbsParser();

function fileExists(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getMorphZip(locale: string): string {
  return join(MORPHOLOGY_DIR, locale, 'verbs', 'verbs.zip');
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

describe('Grid3VerbsParser - Synthetic XML (always runs)', () => {
  test('synthetic fixture exists', () => {
    expect(fileExists(SYNTHETIC_XML)).toBe(true);
  });

  describe('parseXml (flat forms)', () => {
    let forms: Map<string, string[]>;
    let locale: string;

    beforeAll(() => {
      const xml = fs.readFileSync(SYNTHETIC_XML, 'utf-8');
      const result = parser.parseXml(xml);
      locale = result.locale;
      forms = result.verbs;
    });

    test('detects locale test-XX', () => {
      expect(locale).toBe('test-XX');
    });

    test('parses 3 verbs', () => {
      expect(forms.size).toBe(3);
    });

    test('regular verb walk -> walks, walked, walking', () => {
      const walkForms = forms.get('walk');
      expect(walkForms).toBeDefined();
      expect(walkForms).toContain('walks');
      expect(walkForms).toContain('walked');
      expect(walkForms).toContain('walking');
    });

    test('irregular verb go -> goes, went, going, gone', () => {
      const goForms = forms.get('go');
      expect(goForms).toBeDefined();
      expect(goForms).toContain('goes');
      expect(goForms).toContain('went');
      expect(goForms).toContain('going');
      expect(goForms).toContain('gone');
    });

    test('default-rule verb jump -> jumps, jumped, jumping', () => {
      const jumpForms = forms.get('jump');
      expect(jumpForms).toBeDefined();
      expect(jumpForms).toContain('jumps');
      expect(jumpForms).toContain('jumped');
      expect(jumpForms).toContain('jumping');
    });

    test('no compound forms', () => {
      for (const [, wordForms] of forms) {
        for (const f of wordForms) {
          expect(f).not.toContain(' ');
        }
      }
    });
  });

  describe('parseXmlDetailed (forms with conditions)', () => {
    let detailed: Map<string, Array<{ value: string; conditions: Map<string, string> }>>;

    beforeAll(async () => {
      const result = await parser.parseXmlFileDetailed(SYNTHETIC_XML);
      detailed = result.verbs;
    });

    test('parses 3 verbs with conditions', () => {
      expect(detailed.size).toBe(3);
    });

    test('walk has "walks" with person=third, time=present', () => {
      const walkForms = detailed.get('walk');
      expect(walkForms).toBeDefined();
      const walksForm = walkForms!.find((f) => f.value === 'walks');
      expect(walksForm).toBeDefined();
      expect(walksForm!.conditions.get('person')).toBe('third');
      expect(walksForm!.conditions.get('time')).toBe('present');
    });

    test('walk has "walked" with time=past', () => {
      const walkForms = detailed.get('walk');
      const walkedForm = walkForms!.find((f) => f.value === 'walked');
      expect(walkedForm).toBeDefined();
      expect(walkedForm!.conditions.get('time')).toBe('past');
    });

    test('go has "went" with time=past', () => {
      const goForms = detailed.get('go');
      const wentForm = goForms!.find((f) => f.value === 'went');
      expect(wentForm).toBeDefined();
      expect(wentForm!.conditions.get('time')).toBe('past');
    });

    test('go has "gone" with participleType=pastparticiple', () => {
      const goForms = detailed.get('go');
      const goneForm = goForms!.find((f) => f.value === 'gone');
      expect(goneForm).toBeDefined();
      expect(goneForm!.conditions.get('participleType')).toBe('pastparticiple');
    });

    test('go has "goes" with person=third', () => {
      const goForms = detailed.get('go');
      const goesForm = goForms!.find((f) => f.value === 'goes');
      expect(goesForm).toBeDefined();
      expect(goesForm!.conditions.get('person')).toBe('third');
    });
  });

  describe('parseZip with synthetic data', () => {
    test('can parse a zip file containing verbs.xml', async () => {
      // Create a temporary zip with our synthetic XML
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AdmZip = require('adm-zip');
      const tmpDir = join(__dirname, 'assets', 'grid3', '_tmp');
      const zipPath = join(tmpDir, 'verbs.zip');

      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        const zip = new AdmZip();
        zip.addFile('verbs.xml', fs.readFileSync(SYNTHETIC_XML));
        zip.writeZip(zipPath);

        const result = await parser.parseZip(zipPath);
        expect(result.verbs.size).toBe(3);
        expect(result.verbs.get('go')).toContain('went');
      } finally {
        try {
          fs.unlinkSync(zipPath);
          fs.rmdirSync(tmpDir);
        } catch {
          // cleanup best effort
        }
      }
    });
  });
});

describe('Grid3VerbsParser - External morphology data', () => {
  // These tests run when GRID3_MORPHOLOGY_DIR points to a valid
  // Grid 3 Locale directory (or a directory someone has copied
  // the verbs.zip files into). On CI without Grid 3, these skip.
  test('parses en-GB verbs.zip', async () => {
    const zipPath = getMorphZip('en-GB');
    if (!fileExists(zipPath)) return;
    const result = await parser.parseZip(zipPath);
    expect(result.verbs.size).toBeGreaterThan(100);
  });

  test('en-GB go -> goes, going, gone, went', async () => {
    const zipPath = getMorphZip('en-GB');
    if (!fileExists(zipPath)) return;
    const result = await parser.parseZip(zipPath);
    const goForms = result.verbs.get('go');
    expect(goForms).toBeDefined();
    expect(goForms).toContain('goes');
    expect(goForms).toContain('going');
    expect(goForms).toContain('gone');
    expect(goForms).toContain('went');
  });

  test('en-GB detailed has conditions', async () => {
    const zipPath = getMorphZip('en-GB');
    if (!fileExists(zipPath)) return;
    const result = await parser.parseZipDetailed(zipPath);
    const goForms = result.verbs.get('go');
    expect(goForms).toBeDefined();
    expect(goForms!.length).toBeGreaterThan(0);
    const went = goForms!.find((f) => f.value === 'went');
    expect(went).toBeDefined();
  });

  test('parses nb-NO verbs.zip', async () => {
    const zipPath = getMorphZip('nb-NO');
    if (!fileExists(zipPath)) return;
    const result = await parser.parseZip(zipPath);
    expect(result.verbs.size).toBeGreaterThan(100);
  });
});
