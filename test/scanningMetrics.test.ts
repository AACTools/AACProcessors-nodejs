import { describe, expect, it } from '@jest/globals';
import { AACTree, AACPage, AACButton, AACScanType } from '../src/core/treeStructure';
import { MetricsCalculator } from '../src/utilities/analytics/metrics/core';

describe('Scanning Metrics', () => {
  it('calculates linear scanning effort correctly', async () => {
    const tree = new AACTree();
    const page = new AACPage({
      id: 'root',
      name: 'Home',
      grid: { columns: 2, rows: 2 },
      scanType: AACScanType.LINEAR,
    });

    // Target button is #3 (linear index 2)
    const btn1 = new AACButton({
      id: 'btn1',
      label: '1',
      type: 'SPEAK',
      x: 0,
      y: 0,
    });
    const btn2 = new AACButton({
      id: 'btn2',
      label: '2',
      type: 'SPEAK',
      x: 1,
      y: 0,
    });
    const btn3 = new AACButton({
      id: 'btn3',
      label: '3',
      type: 'SPEAK',
      x: 0,
      y: 1,
    }); // Target

    page.grid[0][0] = btn1;
    page.grid[0][1] = btn2;
    page.grid[1][0] = btn3;

    page.addButton(btn1);
    page.addButton(btn2);
    page.addButton(btn3);

    tree.addPage(page);
    tree.rootId = 'root';

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree);

    const btn3Metrics = result.buttons.find((b) => b.label === '3');
    // Steps = 3 (buttons 1, 2, 3), Selections = 1
    // Scan Effort = 3 * 0.015 + 1 * 0.1 = 0.045 + 0.1 = 0.145
    // baseBoardEffort(2, 2, 4):
    // buttonSize = 0.09 * (2+2)/2 = 0.18
    // fieldSize = 0.005 * 4 = 0.02
    // total = 0.2 + 0.145 = 0.345

    expect(btn3Metrics?.effort).toBeCloseTo(0.345, 4);
  });

  it('calculates row-column scanning effort correctly', async () => {
    const tree = new AACTree();
    const page = new AACPage({
      id: 'root',
      name: 'Home',
      grid: { columns: 5, rows: 5 },
      scanType: AACScanType.ROW_COLUMN,
    });

    // Target button at row 3 (index 2), col 4 (index 3)
    const btn = new AACButton({
      id: 'target',
      label: 'Target',
      type: 'SPEAK',
      x: 3,
      y: 2,
    });
    page.grid[2][3] = btn;
    page.addButton(btn);

    tree.addPage(page);

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree);

    const metrics = result.buttons.find((b) => b.label === 'Target');
    // Steps = (rowIndex + 1) + (colIndex + 1) = (2 + 1) + (3 + 1) = 7 steps
    // Selections = 2
    // Scan Effort = 7 * 0.015 + 2 * 0.1 = 0.105 + 0.2 = 0.305
    // baseBoardEffort(5, 5, 25):
    // buttonSize = 0.09 * (5+5)/2 = 0.45
    // fieldSize = 0.005 * 25 = 0.125
    // total = 0.575 + 0.305 = 0.88

    expect(metrics?.effort).toBeCloseTo(0.88, 4);
  });

  it('calculates block scanning effort correctly', async () => {
    const tree = new AACTree();
    const page = new AACPage({
      id: 'root',
      name: 'Home',
      grid: { columns: 4, rows: 4 },
      scanType: AACScanType.BLOCK_ROW_COLUMN,
      scanBlocksConfig: [
        { id: 1, name: 'Block A', order: 1 },
        { id: 2, name: 'Block B', order: 2 },
      ],
    });

    // Target button in Block B, at some position
    const btnA = new AACButton({
      id: 'a',
      label: 'A',
      scanBlocks: [1],
      type: 'SPEAK',
    });
    const btnB1 = new AACButton({
      id: 'b1',
      label: 'B1',
      scanBlocks: [2],
      type: 'SPEAK',
    });
    const btnB2 = new AACButton({
      id: 'b2',
      label: 'B2',
      scanBlocks: [2],
      type: 'SPEAK',
    }); // Target

    page.grid[0][0] = btnA;
    page.grid[1][0] = btnB1;
    page.grid[1][1] = btnB2;

    page.addButton(btnA);
    page.addButton(btnB1);
    page.addButton(btnB2);

    tree.addPage(page);

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree);

    const metrics = result.buttons.find((b) => b.label === 'B2');
    // Steps = blockOrder (2) + btnInBlockIndex (1) + 1 = 4 steps
    // Selections = 2
    // Scan Effort = 4 * 0.015 + 2 * 0.1 = 0.06 + 0.2 = 0.26
    // baseBoardEffort(4, 4, 16):
    // buttonSize = 0.09 * 4 = 0.36
    // fieldSize = 0.005 * 16 = 0.08
    // total = 0.44 + 0.26 = 0.70

    expect(metrics?.effort).toBeCloseTo(0.7, 4);
  });
  it('calculates error correction effort correctly', async () => {
    const tree = new AACTree();
    const page = new AACPage({
      id: 'root',
      name: 'Home',
      grid: { columns: 10, rows: 1 },
      scanningConfig: {
        errorCorrectionEnabled: true,
        errorRate: 0.2, // 20% error rate
      },
    });

    const btn1 = new AACButton({ id: 'btn1', label: 'B1', type: 'SPEAK' });
    page.grid[0][0] = btn1;
    page.addButton(btn1);
    tree.addPage(page);

    const calculator = new MetricsCalculator();
    const result = await calculator.analyze(tree);

    const metrics = result.buttons.find((b) => b.label === 'B1');
    // B1 is at root, index 0.
    // Steps = 1, Selections = 1
    // Ideal Scan Effort = 1 * 0.015 + 1 * 0.1 = 0.115
    // LoopSteps = 1 (only 1 visible button)
    // Error Penalty = errorRate (0.2) * (loopSteps (1) * stepCost (0.015)) = 0.2 * 0.015 = 0.003
    // Total Scan Effort = 0.115 + 0.003 = 0.118
    // baseBoardEffort(1, 10, 10):
    // buttonSize = 0.09 * (1+10)/2 = 0.495
    // fieldSize = 0.005 * 10 = 0.05
    // total = 0.545 + 0.118 = 0.663

    expect(metrics?.effort).toBeCloseTo(0.663, 4);
  });
});
