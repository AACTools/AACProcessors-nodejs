import { describe, expect, it } from '@jest/globals';
import path from 'path';
import {
  dumpVocabulary,
  type VocabularyDump,
} from '../src/utilities/analytics/metrics/vocabularyDump';
import type { AACTree, AACButton } from '../src/types/aac';
import type { MetricsResult } from '../src/utilities/analytics/metrics/types';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function makeButton(id: string, label: string, extra: Partial<AACButton> = {}): AACButton {
  return { id, label, message: label, ...extra };
}

function makeTree(
  pages: Array<{
    id: string;
    name: string;
    buttons: AACButton[];
    wordListItems?: Array<{ text: string; image?: string; partOfSpeech?: string }>;
  }>
): AACTree {
  const pageMap: AACTree['pages'] = {};
  for (const p of pages) {
    pageMap[p.id] = {
      id: p.id,
      name: p.name,
      grid: [],
      buttons: p.buttons,
      parentId: null,
      ...(p.wordListItems ? { wordListItems: p.wordListItems } : {}),
    } as AACTree['pages'][string];
  }
  return {
    pages: pageMap,
    metadata: { format: 'gridset', name: 'test set', locale: 'en-GB' },
    rootId: pages[0]?.id ?? null,
    toolbarId: null,
    getPage: (id: string) => pageMap[id],
    addPage: () => {},
  } as unknown as AACTree;
}

function makeMetrics(buttons: Partial<MetricsResult['buttons'][number]>[]): MetricsResult {
  return {
    analysis_version: 'test',
    locale: 'en-GB',
    total_boards: 1,
    total_buttons: buttons.length,
    total_words: buttons.length,
    reference_counts: {},
    grid: { rows: 3, columns: 3 },
    buttons: buttons as MetricsResult['buttons'],
    levels: {},
  };
}

/* ------------------------------------------------------------------ *
 * Synthetic tree
 * ------------------------------------------------------------------ */

const TREE = makeTree([
  {
    id: 'home',
    name: 'Home',
    buttons: [
      makeButton('b1', 'hello', { pos: 'Verb' } as Partial<AACButton> & { pos?: string }),
      makeButton('b2', 'thank you'),
      makeButton('b3', 'want', {
        parameters: { predictions: ['want', 'go'] },
      }),
    ],
    wordListItems: [
      { text: 'dog', partOfSpeech: 'Noun' },
      { text: 'cat' }, // untagged -> Unknown
      { text: 'happy dog', partOfSpeech: 'Noun' }, // multi-word phrase
    ],
  },
]);

describe('dumpVocabulary', () => {
  it('counts button vocabulary with POS breakdown', () => {
    const dump = dumpVocabulary(TREE);
    const b = dump.summary.buttons;
    expect(b.entries).toBe(3); // hello, thank you, want
    expect(b.uniqueWords).toBe(2); // hello, want
    expect(b.uniquePhrases).toBe(1); // thank you
    expect(b.byPartOfSpeech['Verb']).toBe(1);
    expect(b.byPartOfSpeech['Unknown']).toBe(2); // thank you, want
    expect(dump.summary.totalButtons).toBe(3);
    expect(dump.summary.totalBoards).toBe(1);
  });

  it('counts page wordlists with per-list detail', () => {
    const dump = dumpVocabulary(TREE);
    const wl = dump.summary.wordLists;
    expect(wl.lists).toBe(1);
    expect(wl.entries).toBe(3);
    expect(wl.uniqueWords).toBe(2); // dog, cat
    expect(wl.uniquePhrases).toBe(1); // happy dog
    expect(wl.byPartOfSpeech['Noun']).toBe(2); // dog, happy dog
    expect(wl.byPartOfSpeech['Unknown']).toBe(1); // cat
  });

  it('counts prediction dictionaries from parameters.predictions', () => {
    const dump = dumpVocabulary(TREE);
    const pd = dump.summary.predictionDictionaries;
    expect(pd.buttonsWithDictionaries).toBe(1);
    expect(pd.entries).toBe(2); // want, go
    expect(pd.uniqueWords).toBe(2);
  });

  it('returns null wordForms when no metrics supplied', () => {
    const dump = dumpVocabulary(TREE);
    expect(dump.summary.wordForms).toBeNull();
  });

  it('counts smart-grammar word forms, excluding original dictionary words', () => {
    const metrics = makeMetrics([
      { label: 'going', is_word_form: true, pos: 'Verb', parent_button_id: 'b1' },
      { label: 'want', is_word_form: true, pos: 'Verb', parent_button_id: 'b3' }, // original -> excluded
      { label: 'hello', is_word_form: false },
    ]);
    const dump = dumpVocabulary(TREE, { metrics });
    const wf = dump.summary.wordForms!;
    expect(wf).not.toBeNull();
    expect(wf.entries).toBe(1); // going only
    expect(wf.byPartOfSpeech['Verb']).toBe(1);
    expect(wf.parentButtons).toBe(1);
  });

  it('combines unique entries across all sources', () => {
    const metrics = makeMetrics([
      { label: 'going', is_word_form: true, pos: 'Verb', parent_button_id: 'b1' },
    ]);
    const dump = dumpVocabulary(TREE, { metrics });
    // words: hello, want, dog, cat, go, going = 6; phrases: thank you, happy dog = 2
    expect(dump.summary.combined.uniqueWords).toBe(6);
    expect(dump.summary.combined.uniquePhrases).toBe(2);
    expect(dump.summary.combined.uniqueEntries).toBe(8);
  });

  it('is case-insensitive and whitespace-normalising', () => {
    const tree = makeTree([
      {
        id: 'p',
        name: 'P',
        buttons: [makeButton('a', '  Hello '), makeButton('b', 'HELLO')],
        wordListItems: [{ text: 'thank  you' }],
      },
    ]);
    const dump = dumpVocabulary(tree);
    expect(dump.summary.buttons.entries).toBe(2);
    expect(dump.summary.buttons.uniqueWords).toBe(1);
    expect(dump.summary.wordLists.uniquePhrases).toBe(1);
  });

  it('emits schema/source metadata and no word lists', () => {
    const dump: VocabularyDump = dumpVocabulary(TREE);
    expect(dump.schema).toBe('aac-vocabulary-dump/v1');
    expect(dump.generatedAt).toBeTruthy();
    expect(dump.source.format).toBe('gridset');
    expect(dump.source.locale).toBe('en-GB');
    // Counts only: no word arrays anywhere in the output.
    const json = JSON.stringify(dump);
    expect(json).not.toContain('"dog"');
    expect(json).not.toContain('["hello"');
  });
});

/* ------------------------------------------------------------------ *
 * Real gridset asset
 * ------------------------------------------------------------------ */

describe('dumpVocabulary on example.gridset', () => {
  it('surfaces the embedded wordlists and full-pipeline word forms', async () => {
    const { GridsetProcessor } = await import('../src/processors/gridsetProcessor');
    const { MetricsCalculator } = await import('../src/utilities/analytics/metrics/core');
    const assetPath = path.join(__dirname, 'assets/gridset/example.gridset');

    const processor = new GridsetProcessor();
    const tree = await processor.loadIntoTree(assetPath);
    const metrics = await new MetricsCalculator().analyze(tree);

    const dump = dumpVocabulary(tree, { metrics });
    const s = dump.summary;

    expect(s.totalBoards).toBeGreaterThan(10);
    // This asset embeds 15 non-empty page wordlists (38 more are empty placeholders).
    expect(s.wordLists.lists).toBeGreaterThanOrEqual(15);
    expect(s.wordLists.entries).toBeGreaterThan(15);
    expect(s.combined.uniqueEntries).toBeGreaterThan(100);
    // Smart grammar should generate at least some inflections (POS-tagged set).
    expect(s.wordForms).not.toBeNull();
  }, 30000);
});
