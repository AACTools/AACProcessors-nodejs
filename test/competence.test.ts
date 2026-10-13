import { describe, expect, it } from '@jest/globals';
import {
  analyzeTimeline,
  lexicalDiversity,
  lexicalRichness,
  morphologicalDiversity,
  movingAverageTTR,
  spellingValidity,
  summarizeActivity,
  syntacticDiversity,
  tokenize,
  type CompetenceUtterance,
  type InflectionCategory,
} from '../src/utilities/analytics/competence';
import {
  historyEntriesToCompetenceUtterances,
  type HistoryEntry,
} from '../src/utilities/analytics/history';

/* ------------------------------------------------------------------ *
 * Inline language fixtures.
 *
 * The library core ships NO word lists, so tests inject a tiny closed-class
 * set + inflection classifier. Real callers pass curated language resources.
 * ------------------------------------------------------------------ */

const FIXTURE_CC = new Set([
  'and',
  'but',
  'or',
  'because',
  'if',
  'so',
  'although',
  'to',
  'for',
  'with',
  'in',
  'on',
  'at',
  'of',
  'from',
  'by',
  'under',
  'over',
]);

function fixtureClassify(w: string): InflectionCategory {
  if (w.endsWith('ing')) return 'progressive';
  if (w.endsWith('ed')) return 'past';
  if (w.endsWith("'s")) return 'possessive';
  if (w.endsWith('s')) return 'plural';
  return 'base';
}

describe('competence / tokenize', () => {
  it('lowercases and keeps apostrophes inside words', () => {
    expect(tokenize("I DON'T want it")).toEqual(['i', "don't", 'want', 'it']);
  });

  it('drops punctuation but keeps accented characters', () => {
    expect(tokenize('Hallo, wereld! Café — och "ja".')).toEqual([
      'hallo',
      'wereld',
      'café',
      'och',
      'ja',
    ]);
  });

  it('returns [] for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   !!! ')).toEqual([]);
  });
});

describe('competence / movingAverageTTR (MATTR)', () => {
  it('returns nulls for an empty stream', () => {
    const r = movingAverageTTR([], 30);
    expect(r.median).toBeNull();
    expect(r.nWindows).toBe(0);
  });

  it('treats a short sample as a single window TTR', () => {
    const r = movingAverageTTR(['a', 'b', 'c'], 30);
    expect(r.median).toBeCloseTo(1.0);
    expect(r.nWindows).toBe(1);
  });

  it('gives a higher diversity for a varied stream than a repetitive one', () => {
    const varied = (
      'the quick brown fox jumps over lazy dog cat hat bat ' +
      'sun moon star tree leaf rock river hill cloud rain wind'
    ).split(/\s+/);
    const repetitive = Array.from({ length: 40 }, () => 'yes');
    const v = lexicalDiversity(varied, 30).median;
    const r = lexicalDiversity(repetitive, 30).median;
    expect(v).not.toBeNull();
    expect(r).not.toBeNull();
    if (v !== null && r !== null) expect(v).toBeGreaterThan(r);
    // Repetitive single-word stream has TTR ~ 1/30 within windows.
    expect(r).toBeCloseTo(1 / 30, 5);
  });

  it('MATTR is sample-length insensitive', () => {
    const base = 'a b c d e f g h i j k l m n o'.split(/\s+/); // 15 unique
    const doubled = [...base, ...base]; // same words repeated
    expect(movingAverageTTR(base, 15).median).toBeCloseTo(1.0);
    expect(movingAverageTTR(doubled, 15).median).toBeCloseTo(1.0);
  });
});

describe('competence / syntacticDiversity (closed-class, injected)', () => {
  it('is unavailable with no closed-class data (no silent degradation)', () => {
    const r = syntacticDiversity(['and', 'but'], { windowSize: 30 });
    expect(r.median).toBeNull();
    expect(r.unavailable).toBeDefined();
  });

  it('scores a window rich in varied connectors higher than one using only "and"', () => {
    const rich =
      'I went to the shop and bought milk but the milk was off so I went back because it was bad although they refunded me'.split(
        /\s+/
      );
    const onlyAnd = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'and' : 'cat'));
    const r1 = syntacticDiversity(rich, { windowSize: 15, closedClassWords: FIXTURE_CC });
    const r2 = syntacticDiversity(onlyAnd, { windowSize: 15, closedClassWords: FIXTURE_CC });
    expect(r1.median).not.toBeNull();
    expect(r2.median).not.toBeNull();
    if (r1.median !== null && r2.median !== null) {
      expect(r1.median).toBeGreaterThan(r2.median);
      // Only "and" repeated ~8x per window -> distinct/total = 1/8.
      expect(r2.median).toBeLessThan(0.2);
    }
  });

  it('works for any language because the set is injected (Dutch example)', () => {
    const nl = new Set(['en', 'of', 'maar', 'want', 'omdat', 'aan', 'in', 'op']);
    const r = syntacticDiversity('ik wil graag naar buiten omdat het mooi weer is'.split(/\s+/), {
      windowSize: 8,
      closedClassWords: nl,
    });
    expect(r.median).not.toBeNull();
  });
});

describe('competence / morphologicalDiversity (classifier injected)', () => {
  it('is unavailable without a classifier', () => {
    const r = morphologicalDiversity(['cats'], { windowSize: 5 });
    expect(r.median).toBeNull();
    expect(r.unavailable).toBeDefined();
  });

  it('scores inflected words above a base-only stream', () => {
    const morphed = 'cats running jumped'.split(/\s+/);
    const base = 'cat run jump'.split(/\s+/);
    const r1 = morphologicalDiversity(morphed, {
      windowSize: 3,
      classifyInflection: fixtureClassify,
    });
    const r2 = morphologicalDiversity(base, { windowSize: 3, classifyInflection: fixtureClassify });
    expect(r1.median).not.toBeNull();
    expect(r2.median).toBeNull(); // no inflected words -> unavailable
  });
});

describe('competence / spellingValidity', () => {
  it('returns null without a dictionary', () => {
    expect(spellingValidity(['hello', 'wrld'])).toBeNull();
  });

  it('counts dictionary hits over unique alphabetic words', () => {
    const dict = new Set(['hello', 'world']);
    // unique alphabetic words: hello, world, xyz -> 2/3
    expect(spellingValidity(['hello', 'world', 'xyz', 'hello'], dict)).toBeCloseTo(2 / 3, 5);
  });

  it('ignores non-alphabetic tokens', () => {
    const dict = new Set(['hello']);
    expect(spellingValidity(['hello', '12', 'a'], dict)).toBeCloseTo(1.0, 5);
  });
});

describe('competence / summarizeActivity', () => {
  it('counts utterances, words, active days and words per utterance', () => {
    const DAY = 86_400_000;
    const utts: CompetenceUtterance[] = [
      { text: 'hello world', timestampMs: 0 },
      { text: 'good morning', timestampMs: DAY },
      { text: 'bye', timestampMs: DAY + 1000 },
    ];
    const a = summarizeActivity(utts);
    expect(a.utterances).toBe(3);
    expect(a.words).toBe(5);
    expect(a.activeDays).toBe(2);
    expect(a.wordsPerUtterance.median).toBe(2);
    expect(a.wordsPerUtterance.n).toBe(3);
  });
});

describe('competence / lexicalRichness (Brunet W, Honoré R)', () => {
  it('computes W, R and hapax counts for a mixed stream', () => {
    // N=6, V=5 ("the" twice + cat/dog/bird/fish once each) -> V1=4
    const r = lexicalRichness(['the', 'cat', 'the', 'dog', 'bird', 'fish']);
    expect(r.tokens).toBe(6);
    expect(r.types).toBe(5);
    expect(r.hapax).toBe(4);
    expect(r.brunetsW).toBeCloseTo(6 * Math.pow(5, -0.165), 10);
    expect(r.honoresR).toBeCloseTo((100 * Math.log(6)) / (1 - 4 / 5), 10);
  });

  it('returns the closed-form Honoré R for a standard example', () => {
    // N=5, V=4, V1=3: "a a b c d"
    const r = lexicalRichness(['a', 'a', 'b', 'c', 'd']);
    expect(r.hapax).toBe(3);
    expect(r.honoresR).toBeCloseTo((100 * Math.log(5)) / (1 - 3 / 4), 10);
  });

  it('R is null when every type is a hapax or N<=1', () => {
    expect(lexicalRichness(['a', 'b', 'c']).honoresR).toBeNull();
    expect(lexicalRichness(['a']).honoresR).toBeNull();
    expect(lexicalRichness([]).brunetsW).toBeNull();
    expect(lexicalRichness([]).honoresR).toBeNull();
  });

  it('W decreases (richer) as vocabulary diversifies at fixed N', () => {
    const narrow = lexicalRichness(['go', 'go', 'go', 'go', 'go', 'go']);
    const wide = lexicalRichness(['go', 'went', 'going', 'goes', 'gone', 'go']);
    if (wide.brunetsW === null || narrow.brunetsW === null) {
      throw new Error('expected Brunets W to be defined');
    }
    expect(wide.brunetsW).toBeLessThan(narrow.brunetsW);
  });
});

describe('competence / analyzeTimeline', () => {
  const DAY = 86_400_000;

  function buildCorpus(): CompetenceUtterance[] {
    const now = Date.now();
    const utts: CompetenceUtterance[] = [];
    const simpleMonth = now - 60 * DAY;
    for (let i = 0; i < 30; i++) {
      utts.push({ text: 'I want it yes', timestampMs: simpleMonth + i * 1000 });
    }
    for (let i = 0; i < 30; i++) {
      utts.push({
        text: 'I think that we should go to the park because the weather is lovely although it might rain',
        timestampMs: now - i * 60_000,
      });
    }
    return utts;
  }

  it('bins utterances by month and computes per-bin metrics', () => {
    const report = analyzeTimeline(buildCorpus(), {
      months: 3,
      windowSize: 15,
      minWordsPerMonth: 1,
      lang: 'en',
      resources: { closedClassWords: FIXTURE_CC, classifyInflection: fixtureClassify },
    });
    expect(report.schema).toBe('aac-competence-report/v1');
    expect(report.timeline.length).toBeGreaterThanOrEqual(1);
    for (const bin of report.timeline) {
      expect(bin.suppressed).toBe(false);
      expect(bin.lexicalDiversity.median).not.toBeNull();
      // Lexical richness is resource-free — always present on unsuppressed bins.
      expect(bin.lexicalRichness.brunetsW).not.toBeNull();
      expect(bin.lexicalRichness.tokens).toBe(bin.words);
      expect(bin.lexicalRichness.types).toBe(bin.uniqueWords);
    }
  });

  it('reports support + warnings when language resources are missing', () => {
    const report = analyzeTimeline(buildCorpus(), {
      months: 3,
      windowSize: 15,
      minWordsPerMonth: 1,
      lang: 'fr', // no resources provided -> syntactic/morphological unavailable
    });
    expect(report.support.syntactic.available).toBe(false);
    expect(report.support.morphological.available).toBe(false);
    expect(report.support.semantic.available).toBe(true);
    expect(report.warnings.some((w) => w.includes("'fr'"))).toBe(true);
    // The measure itself reports unavailable in each bin.
    expect(report.timeline[0].syntacticDiversity.unavailable).toBeDefined();
  });

  it('flags sparse months as suppressed and omits their diversity figures', () => {
    const now = Date.now();
    const report = analyzeTimeline([{ text: 'hi', timestampMs: now - 40 * DAY }], {
      months: 3,
      minWordsPerMonth: 150,
      lang: 'en',
    });
    const suppressed = report.timeline.filter((b) => b.suppressed);
    expect(suppressed.length).toBeGreaterThan(0);
    expect(suppressed[0].lexicalDiversity.median).toBeNull();
    expect(suppressed[0].suppressReason).toContain('fewer than');
  });

  it('emits no raw text or word lists anywhere in the report', () => {
    const report = analyzeTimeline(buildCorpus(), {
      months: 3,
      windowSize: 15,
      minWordsPerMonth: 1,
      lang: 'en',
      resources: { closedClassWords: FIXTURE_CC },
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain('hello');
    expect(json).not.toContain('because the weather');
    expect(report.privacy.rawUtterancesIncluded).toBe(false);
    expect(report.privacy.wordListsIncluded).toBe(false);
    expect(report.privacy.fringeWordFrequencyIncluded).toBe(false);
  });

  it('trends lexical diversity upward for an improving corpus', () => {
    const report = analyzeTimeline(buildCorpus(), {
      months: 3,
      windowSize: 15,
      minWordsPerMonth: 1,
      lang: 'en',
      resources: { closedClassWords: FIXTURE_CC },
    });
    expect(report.trend.metric).toBe('lexicalDiversity.median');
    expect(report.trend.direction).toBe('up');
    expect(report.trend.delta).not.toBeNull();
    if (report.trend.delta !== null) expect(report.trend.delta).toBeGreaterThan(0);
  });

  it('respects the trailing-months window (drops old utterances)', () => {
    const now = Date.now();
    const report = analyzeTimeline(
      [{ text: 'very old utterance here', timestampMs: now - 400 * DAY }],
      { months: 3, minWordsPerMonth: 1, lang: 'en' }
    );
    expect(report.timeline.length).toBe(0);
    expect(report.overall.totalUtterances).toBe(0);
  });
});

describe('competence / source-agnostic (OBF/OBFL via adapter)', () => {
  it('analyses any HistoryEntry source, e.g. OBF/OBFL logs, identically to native utterances', () => {
    const now = Date.now();
    // OBF/OBFL-style history: phrases with occurrences, source-tagged 'OBL'.
    const obfEntries: HistoryEntry[] = [
      {
        id: 'obf-1',
        source: 'OBL',
        content: 'I want a drink of water please',
        occurrences: [
          { timestamp: new Date(now - 50 * 86_400_000) },
          { timestamp: new Date(now - 49 * 86_400_000) },
        ],
      },
      {
        id: 'obf-2',
        source: 'OBL',
        content: 'the cat sat on the mat because it was tired',
        occurrences: [{ timestamp: new Date(now - 1000) }],
      },
    ];

    const utts = historyEntriesToCompetenceUtterances(obfEntries);
    // Two occurrences of phrase 1 + one of phrase 2 = 3 utterances.
    expect(utts.length).toBe(3);

    const report = analyzeTimeline(utts, {
      months: 3,
      windowSize: 10,
      minWordsPerMonth: 1,
      lang: 'en',
      resources: { closedClassWords: FIXTURE_CC },
    });
    expect(report.source.platform).toBe('Grid3'); // default label; data came from OBF
    expect(report.overall.totalUtterances).toBe(3);
    // No raw phrase text leaks into the output.
    expect(JSON.stringify(report)).not.toContain('drink of water');
  });
});
