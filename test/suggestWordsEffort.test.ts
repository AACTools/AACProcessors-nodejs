/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from '@jest/globals';
import { AACTree, AACPage, AACButton } from '../src/core/treeStructure';
import { MetricsCalculator } from '../src/utilities/analytics/metrics/core';
import { EFFORT_CONSTANTS, visualScanEffort } from '../src/utilities/analytics/metrics/effort';

function buildTreeWithPredictions(
  predictions: string[],
  parametersPredictions?: string[],
  pos?: string
): { tree: AACTree; btnId: string } {
  const tree = new AACTree();
  const page = new AACPage({
    id: 'root',
    name: 'Home',
    grid: { columns: 2, rows: 2 },
  });

  const btn = new AACButton({
    id: 'some_btn',
    label: 'some',
    type: 'SPEAK',
    x: 0,
    y: 0,
    predictions,
    pos,
    parameters: parametersPredictions ? { predictions: parametersPredictions } : undefined,
  });

  page.grid[0][0] = btn;
  page.addButton(btn);
  tree.addPage(page);
  tree.rootId = 'root';

  return { tree, btnId: btn.id };
}

describe('Suggest Words effort cost', () => {
  it('adds confirmation cost to Suggest Words word forms', async () => {
    const suggestWords = ['something', 'someone', 'somewhere'];
    const { tree } = buildTreeWithPredictions(suggestWords, suggestWords);

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree, { useSmartGrammar: true });

    const parentBtn = result.buttons.find((b) => b.label === 'some');
    expect(parentBtn).toBeDefined();

    const something = result.buttons.find((b) => b.label === 'something');
    expect(something).toBeDefined();
    expect(something!.is_word_form).toBe(true);
    expect(something!.is_suggest_words).toBe(true);

    const expectedEffort =
      parentBtn!.effort + visualScanEffort(0) + EFFORT_CONSTANTS.SUGGEST_WORDS_SELECTION_EFFORT;
    expect(something!.effort).toBeCloseTo(expectedEffort, 4);
  });

  it('does not add confirmation cost to morphology word forms', async () => {
    const predictions = ['goes', 'going', 'went'];
    const { tree } = buildTreeWithPredictions(predictions, undefined, 'Verb');

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree, { useSmartGrammar: true });

    const parentBtn = result.buttons.find((b) => b.label === 'some');
    expect(parentBtn).toBeDefined();

    const goes = result.buttons.find((b) => b.label === 'goes');
    expect(goes).toBeDefined();
    expect(goes!.is_word_form).toBe(true);
    expect(goes!.is_suggest_words).toBeUndefined();

    expect(goes!.effort).toBeCloseTo(parentBtn!.effort + visualScanEffort(0), 4);
  });

  it('only adds confirmation to Suggest Words forms when predictions are mixed', async () => {
    const suggestWordsOriginals = ['something', 'someone'];
    const allPredictions = ['something', 'someone', 'somes'];
    const { tree } = buildTreeWithPredictions(allPredictions, suggestWordsOriginals, 'Noun');

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree, { useSmartGrammar: true });

    const parentBtn = result.buttons.find((b) => b.label === 'some');

    const something = result.buttons.find((b) => b.label === 'something');
    expect(something).toBeDefined();
    expect(something!.is_suggest_words).toBe(true);
    expect(something!.effort).toBeCloseTo(
      parentBtn!.effort + visualScanEffort(0) + EFFORT_CONSTANTS.SUGGEST_WORDS_SELECTION_EFFORT,
      4
    );

    // "somes" is at index 2 → predictionPriorItems = 2
    const somes = result.buttons.find((b) => b.label === 'somes');
    expect(somes).toBeDefined();
    expect(somes!.is_suggest_words).toBeUndefined();
    expect(somes!.effort).toBeCloseTo(parentBtn!.effort + visualScanEffort(2), 4);
  });

  it('has no confirmation when parameters.predictions is absent', async () => {
    const predictions = ['something', 'someone'];
    const { tree } = buildTreeWithPredictions(predictions, undefined, 'Noun');

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree, { useSmartGrammar: true });

    const parentBtn = result.buttons.find((b) => b.label === 'some');

    const something = result.buttons.find((b) => b.label === 'something');
    expect(something).toBeDefined();
    expect(something!.is_suggest_words).toBeUndefined();
    expect(something!.effort).toBeCloseTo(parentBtn!.effort + visualScanEffort(0), 4);
  });

  it('SUGGEST_WORDS_SELECTION_EFFORT is between 0.5 and 1.0', () => {
    expect(EFFORT_CONSTANTS.SUGGEST_WORDS_SELECTION_EFFORT).toBeGreaterThanOrEqual(0.5);
    expect(EFFORT_CONSTANTS.SUGGEST_WORDS_SELECTION_EFFORT).toBeLessThanOrEqual(1.0);
  });
});
