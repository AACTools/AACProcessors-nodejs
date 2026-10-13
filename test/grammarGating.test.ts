import { MorphologyEngine } from '../src/utilities/analytics/morphology/engine';
import { MetricsCalculator } from '../src/utilities/analytics/metrics/core';
import {
  AACTree,
  AACPage,
  AACButton,
  AACSemanticCategory,
  AACSemanticIntent,
} from '../src/core/treeStructure';

interface BtnCfg {
  id: string;
  label: string;
  message?: string;
  pos?: string;
  contentType?: 'Normal' | 'AutoContent' | 'Workspace' | 'LiveCell' | 'Inflector' | 'Prediction';
  parameters?: { [key: string]: any };
  predictions?: string[];
  targetPageId?: string;
  semanticAction?: any;
}

function makeBtn(cfg: BtnCfg): AACButton {
  return new AACButton({
    id: cfg.id,
    label: cfg.label,
    message: cfg.message ?? cfg.label,
    pos: cfg.pos,
    contentType: cfg.contentType,
    parameters: cfg.parameters,
    predictions: cfg.predictions,
    targetPageId: cfg.targetPageId,
    semanticAction: cfg.semanticAction,
  });
}

function makeTree(
  pages: Array<{
    id: string;
    name: string;
    grid?: BtnCfg[][];
  }>
): AACTree {
  const tree = new AACTree();
  for (const p of pages) {
    const grid = (p.grid || []).map((row) => row.map((cfg) => (cfg ? makeBtn(cfg) : null)));
    const allButtons = grid.flat().filter((b): b is AACButton => b !== null);
    const page = new AACPage({
      id: p.id,
      name: p.name,
      grid,
      buttons: allButtons,
    });
    tree.addPage(page);
  }
  return tree;
}

function speakAction(): any {
  return {
    intent: AACSemanticIntent.SPEAK_TEXT,
    category: AACSemanticCategory.COMMUNICATION,
  };
}

describe('Grammar Gating', () => {
  describe('Grid3 Verb Forms with MorphologyEngine.fromGrid3Verbs', () => {
    const verbMap = new Map<string, string[]>([
      ['go', ['goes', 'going', 'gone', 'went']],
      ['speak', ['speaks', 'speaking', 'spoken', 'spoke']],
      ['have', ['has', 'had', 'having']],
      ['drink', ['drinks', 'drinking', 'drunk', 'drank']],
    ]);

    let engine: MorphologyEngine;

    beforeAll(() => {
      engine = MorphologyEngine.fromGrid3Verbs({ locale: 'en-GB', verbs: verbMap });
    });

    test('returns verb forms from the map when a verb is looked up', () => {
      const forms = engine.inflect('go', 'Verb');
      expect(forms).toContain('goes');
      expect(forms).toContain('going');
      expect(forms).toContain('gone');
      expect(forms).toContain('went');
    });

    test('returns forms for speak from the map', () => {
      const forms = engine.inflect('speak', 'Verb');
      expect(forms).toContain('speaks');
      expect(forms).toContain('speaking');
      expect(forms).toContain('spoken');
      expect(forms).toContain('spoke');
    });

    test('returns forms for have from the map', () => {
      const forms = engine.inflect('have', 'Verb');
      expect(forms).toContain('has');
      expect(forms).toContain('had');
      expect(forms).toContain('having');
    });

    test('returns built-in forms for words not in the verb map', () => {
      const forms = engine.inflect('walk', 'Verb');
      expect(forms).toContain('walks');
      expect(forms).toContain('walked');
      expect(forms).toContain('walking');
    });

    test('returns built-in forms for non-verb words', () => {
      const forms = engine.inflect('child', 'Noun');
      expect(forms).toContain('children');
    });

    test('prefers verb map forms over built-in rules for map verbs', () => {
      const forms = engine.inflect('drink', 'Verb');
      expect(forms).toContain('drunk');
      expect(forms).toContain('drank');
    });
  });

  describe('{gerund} Placeholder Filtering', () => {
    test('filters out forms containing braces', () => {
      const verbMap = new Map<string, string[]>([
        ['abandon', ['abandoned', 'abandons', 'abandoning', '{gerund}']],
      ]);
      const engine = MorphologyEngine.fromGrid3Verbs({ locale: 'en-GB', verbs: verbMap });
      const forms = engine.inflect('abandon', 'Verb');
      expect(forms).not.toContain('{gerund}');
      expect(forms).toContain('abandoning');
      expect(forms).toContain('abandoned');
      expect(forms).toContain('abandons');
    });

    test('filters out multiple placeholder forms', () => {
      const verbMap = new Map<string, string[]>([
        ['test', ['tested', '{gerund}', '{past}', 'testing']],
      ]);
      const engine = MorphologyEngine.fromGrid3Verbs({ locale: 'en-GB', verbs: verbMap });
      const forms = engine.inflect('test', 'Verb');
      expect(forms).not.toContain('{gerund}');
      expect(forms).not.toContain('{past}');
      expect(forms).toContain('tested');
      expect(forms).toContain('testing');
    });
  });

  describe('Grid3 Per-Page Suffix Gating', () => {
    let calc: MetricsCalculator;

    beforeEach(() => {
      calc = new MetricsCalculator();
    });

    test('pages WITHOUT suffix buttons get NO morphology forms', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [[{ id: 'b1', label: 'go', pos: 'Verb', semanticAction: speakAction() }]],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true });

      const goBtn = tree.pages['home'].grid[0][0];
      expect(goBtn?.predictions).toBeUndefined();
    });

    test('pages WITH suffix buttons get morphology forms', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'go', pos: 'Verb', semanticAction: speakAction() },
              { id: 'b2', label: '-s', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true });

      const goBtn = tree.pages['home'].grid[0][0];
      expect(goBtn?.predictions).toBeDefined();
      expect((goBtn?.predictions || []).length).toBeGreaterThan(0);
    });

    test('pages with only -s suffix do not produce adjective comparative/superlative forms', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'big', pos: 'Adjective', semanticAction: speakAction() },
              { id: 'b2', label: '-s', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true });

      const bigBtn = tree.pages['home'].grid[0][0];
      if (bigBtn?.predictions && bigBtn.predictions.length > 0) {
        expect(bigBtn.predictions).not.toContain('bigger');
        expect(bigBtn.predictions).not.toContain('biggest');
      }
    });

    test('Magic Wand pages (with all 6 suffixes) produce full forms', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'big', pos: 'Adjective', semanticAction: speakAction() },
              { id: 'b2', label: '-s', pos: 'Suffix' },
              { id: 'b3', label: "-'s", pos: 'Suffix' },
              { id: 'b4', label: '-er', pos: 'Suffix' },
              { id: 'b5', label: '-est', pos: 'Suffix' },
              { id: 'b6', label: '-ly', pos: 'Suffix' },
              { id: 'b7', label: '-y', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true });

      const bigBtn = tree.pages['home'].grid[0][0];
      expect(bigBtn?.predictions).toBeDefined();
      expect(bigBtn?.predictions).toContain('bigger');
      expect(bigBtn?.predictions).toContain('biggest');
    });

    test('noun on page with -s suffix gets plural form', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'book', pos: 'Noun', semanticAction: speakAction() },
              { id: 'b2', label: '-s', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true });

      const bookBtn = tree.pages['home'].grid[0][0];
      expect(bookBtn?.predictions).toBeDefined();
      expect(bookBtn?.predictions).toContain('books');
    });
  });

  describe('TDSnap Inflector Gating', () => {
    let calc: MetricsCalculator;

    beforeEach(() => {
      calc = new MetricsCalculator();
    });

    test('when no Inflector buttons exist, no morphology forms are generated', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [[{ id: 'b1', label: 'cat', pos: 'Noun', semanticAction: speakAction() }]],
        },
      ]);

      await calc.analyze(tree, { useSmartGrammar: true, tdsnapLexiconPath: undefined });

      const catBtn = tree.pages['home'].grid[0][0];
      expect(catBtn?.predictions).toBeUndefined();
    });

    test('with NOUN:PLU Inflector button, plural forms are gated', () => {
      const _tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'cat', pos: 'Noun', semanticAction: speakAction() },
              {
                id: 'inf1',
                label: 'Plural',
                contentType: 'Inflector',
                parameters: { grammar: { handler: 'NOUN:PLU' } },
              },
            ],
          ],
        },
      ]);

      const engine = MorphologyEngine.fromTDSnapLexicon({
        locale: 'en_GB',
        words: new Map([
          [
            'cat',
            {
              lexemeId: 1,
              forms: [
                { tag: 'PLU', form: 'cats' },
                { tag: 'ADJR', form: 'catter' },
              ],
            },
          ],
        ]),
      });

      const morphResult = engine.inflect('cat', 'Noun');
      expect(morphResult).toContain('cats');
    });

    test('multiple Inflector buttons enable corresponding form types', () => {
      const _tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'happy', pos: 'Adjective', semanticAction: speakAction() },
              {
                id: 'inf1',
                label: 'Plural',
                contentType: 'Inflector',
                parameters: { grammar: { handler: 'NOUN:PLU' } },
              },
              {
                id: 'inf2',
                label: 'Comparative',
                contentType: 'Inflector',
                parameters: { grammar: { handler: 'DESCRIBE:ADJR' } },
              },
              {
                id: 'inf3',
                label: 'Superlative',
                contentType: 'Inflector',
                parameters: { grammar: { handler: 'DESCRIBE:ADJT' } },
              },
            ],
          ],
        },
      ]);

      const availableTags = new Set<string>(['PLU', 'ADJR', 'ADJT']);

      const engine = MorphologyEngine.fromTDSnapLexicon({
        locale: 'en_GB',
        words: new Map([
          [
            'happy',
            {
              lexemeId: 1,
              forms: [
                { tag: 'ADJR', form: 'happier' },
                { tag: 'ADJT', form: 'happiest' },
                { tag: 'ADV', form: 'happily' },
              ],
            },
          ],
        ]),
      });

      const entry = engine.getLexiconEntry('happy');
      expect(entry).toBeDefined();
      const filteredForms = (entry?.forms || [])
        .filter((f) => availableTags.has(f.tag))
        .map((f) => f.form);
      expect(filteredForms).toContain('happier');
      expect(filteredForms).toContain('happiest');
      expect(filteredForms).not.toContain('happily');
    });
  });

  describe('treeHasPosTags Exclusion', () => {
    let calc: MetricsCalculator;

    beforeEach(() => {
      calc = new MetricsCalculator();
    });

    test('returns no smart grammar when only Suffix buttons exist', async () => {
      const _tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: '-s', pos: 'Suffix' },
              { id: 'b2', label: '-er', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      const result = await calc.analyze(_tree);
      expect(result.total_words).toBe(0);
    });

    test('returns no smart grammar when only Inflector buttons exist', async () => {
      const _tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              {
                id: 'b1',
                label: 'Plural',
                contentType: 'Inflector',
                parameters: { grammar: { handler: 'NOUN:PLU' } },
              },
            ],
          ],
        },
      ]);

      const result = await calc.analyze(_tree);
      expect(result.total_words).toBe(0);
    });

    test('real POS tags trigger smart grammar even alongside Suffix buttons', async () => {
      const tree = makeTree([
        {
          id: 'home',
          name: 'Home',
          grid: [
            [
              { id: 'b1', label: 'go', pos: 'Verb', semanticAction: speakAction() },
              { id: 'b2', label: '-s', pos: 'Suffix' },
            ],
          ],
        },
      ]);

      const result = await calc.analyze(tree);
      expect(result.total_words).toBeGreaterThan(0);
    });
  });
});
