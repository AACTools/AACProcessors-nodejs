/**
 * Core Metrics Analysis Engine
 *
 * Implements the main BFS traversal algorithm from the Ruby aac-metrics tool.
 * Calculates effort scores for all buttons in an AAC board set.
 *
 * Based on: aac-metrics/lib/aac-metrics/metrics.rb
 */

import {
  AACTree,
  AACPage,
  AACButton,
  AACSemanticCategory,
  AACScanType,
} from '../../../core/treeStructure';
import { CellScanningOrder, ScanningSelectionMethod } from '../../../types/aac';
import { ButtonMetrics, MetricsOptions, MetricsResult } from './types';
import {
  baseBoardEffort,
  distanceEffort,
  visualScanEffort,
  EFFORT_CONSTANTS,
  localScanEffort,
  scanningEffort,
} from './effort';
import { MorphologyEngine } from '../morphology';

interface ToVisitItem {
  board: AACPage;
  level: number;
  entryX: number;
  entryY: number;
  priorEffort?: number;
  temporaryHomeId?: string | null;
  entryCloneId?: string;
  entrySemanticId?: string;
}

export class MetricsCalculator {
  private locale: string = 'en';

  /**
   * Main analysis function - calculates metrics for an AAC tree
   *
   * @param tree - The AAC tree to analyze
   * @param options - Optional configuration for metrics calculation
   * @returns Complete metrics result
   */
  async analyze(tree: AACTree, options: MetricsOptions = {}): Promise<MetricsResult> {
    // Get root board - prioritize tree.rootId, then fall back to boards with no parentId
    let rootBoard: AACPage | undefined;
    if (tree.rootId) {
      rootBoard = tree.pages[tree.rootId];
    }
    if (!rootBoard) {
      rootBoard = Object.values(tree.pages).find((p: AACPage) => !p.parentId);
    }
    if (!rootBoard) {
      throw new Error('No root board found in tree');
    }

    this.locale = tree.metadata?.locale || (rootBoard as any).locale || 'en';

    // Step 1: Build semantic/clone reference maps
    const { setRefs, setPcts } = this.buildReferenceMaps(tree);

    // Step 2: BFS traversal from root board
    const startBoards: AACPage[] = [rootBoard];

    // Find boards with temporary_home settings
    Object.values(tree.pages).forEach((board: AACPage) => {
      board.buttons.forEach((btn: AACButton) => {
        if (btn.targetPageId && btn.semanticAction) {
          // Check for temporary_home in platformData or fallback
          const tempHome =
            btn.semanticAction.platformData?.grid3?.parameters?.temporary_home ||
            btn.semanticAction.fallback?.temporary_home;
          if (tempHome === 'prior') {
            startBoards.push(board);
          } else if (tempHome === true && btn.targetPageId) {
            const targetBoard = tree.getPage(btn.targetPageId);
            if (targetBoard && !startBoards.includes(targetBoard)) {
              startBoards.push(targetBoard);
            }
          }
        }
      });
    });

    const knownButtons = new Map<string, ButtonMetrics>();
    const levels: { [level: number]: ButtonMetrics[] } = {};
    let totalButtons = 0;

    // Identify spelling/keyboard page and its access effort
    const { spellingPage, spellingBaseEffort, spellingAvgLetterEffort } =
      this.identifySpellingMetrics(tree, options, setPcts);

    // Analyze from each starting board
    startBoards.forEach((startBoard) => {
      const result = this.analyzeFrom(tree, startBoard, setPcts, startBoard === rootBoard, options);

      result.buttons.forEach((btn) => {
        const existing = knownButtons.get(btn.label);
        if (!existing || btn.effort < existing.effort) {
          knownButtons.set(btn.label, btn);
        }
        if (btn.count && existing && existing.count) {
          btn.count += existing.count;
        }
      });

      if (startBoard === rootBoard) {
        Object.assign(levels, result.levels);
        totalButtons = result.totalButtons;
      }
    });

    // Update buttons using dynamic spelling effort if applicable
    const buttons = Array.from(knownButtons.values()).sort((a, b) => a.effort - b.effort);

    // Expand morphological predictions from POS tags if enabled or auto-detected
    const useSmartGrammar = options.useSmartGrammar === true || this.treeHasPosTags(tree);
    if (useSmartGrammar) {
      await this.expandMorphologicalPredictions(tree, options);
    }

    if (useSmartGrammar) {
      const { wordFormMetrics, replacedLabels } = this.calculateWordFormMetrics(
        tree,
        buttons,
        options
      );

      // Remove buttons that were replaced by lower-effort word forms
      const filteredButtons = buttons.filter((btn) => !replacedLabels.has(btn.label.toLowerCase()));

      // Add word forms and re-sort
      filteredButtons.push(...wordFormMetrics);
      filteredButtons.sort((a, b) => a.effort - b.effort);

      // Replace the original buttons array
      buttons.length = 0;
      buttons.push(...filteredButtons);
    }

    // Calculate grid dimensions
    const grid = this.calculateGridDimensions(tree);

    // Identify prediction metrics
    let predictionPageId: string | undefined;
    let hasDynamicPrediction = false;

    // A page is prediction-capable if it has an AutoContent Prediction button reachable from root
    // We already have analyzed from rootBoard
    if (rootBoard) {
      const rootAnalysis = this.analyzeFrom(tree, rootBoard, setPcts, true, options);
      // Scan reached pages for prediction slots
      for (const [pageId, _] of rootAnalysis.visitedBoardEfforts) {
        const page = tree.getPage(pageId);
        const hasPredictionSlot = page?.buttons.some(
          (b) => b.contentType === 'AutoContent' && b.contentSubType === 'Prediction'
        );
        if (hasPredictionSlot) {
          hasDynamicPrediction = true;
          predictionPageId = pageId;
          break;
        }
      }
    }

    return {
      analysis_version: '0.2',
      locale: this.locale,
      total_boards: Object.keys(tree.pages).length,
      total_buttons: totalButtons,
      total_words: buttons.length,
      reference_counts: setRefs,
      grid,
      buttons,
      levels,
      spelling_effort_base: spellingBaseEffort,
      spelling_effort_per_letter: spellingAvgLetterEffort,
      spelling_page_id: spellingPage?.id,
      has_dynamic_prediction: hasDynamicPrediction,
      prediction_page_id: predictionPageId,
    };
  }

  /**
   * Identify keyboard/spelling page and calculate base/avg effort
   */
  private identifySpellingMetrics(
    tree: AACTree,
    options: MetricsOptions,
    setPcts: { [id: string]: number }
  ): {
    spellingPage: AACPage | null;
    spellingBaseEffort: number;
    spellingAvgLetterEffort: number;
  } {
    let spellingPage: AACPage | null = null;

    if (options.spellingPageId) {
      spellingPage = tree.getPage(options.spellingPageId) || null;
    }

    if (!spellingPage && tree.metadata?.defaultKeyboardPageId) {
      spellingPage = tree.getPage(tree.metadata.defaultKeyboardPageId) || null;
    }

    if (!spellingPage) {
      // Look for pages with keyboard-like names or content
      spellingPage =
        Object.values(tree.pages).find((p) => {
          const name = p.name.toLowerCase();
          return name.includes('keyboard') || name.includes('spelling') || name.includes('abc');
        }) || null;
    }

    if (!spellingPage)
      return {
        spellingPage: null,
        spellingBaseEffort: 10,
        spellingAvgLetterEffort: 2.5,
      };

    // Calculate effort to reach this page from root
    const rootBoard = tree.rootId
      ? tree.pages[tree.rootId]
      : Object.values(tree.pages).find((p) => !p.parentId);

    if (!rootBoard)
      return {
        spellingPage,
        spellingBaseEffort: 10,
        spellingAvgLetterEffort: 2.5,
      };

    // Analyze specifically to find the lowest effort path to the spelling page
    const result = this.analyzeFrom(tree, rootBoard, setPcts, true, options);
    const spellingBaseEffort = result.visitedBoardEfforts.get(spellingPage.id) ?? 10;

    // Calculate average effort of alphabetical buttons on that page
    const letters = spellingPage.buttons.filter(
      (b) => b.label.length === 1 && /[a-zA-Z]/.test(b.label)
    );
    let avgEffort = 2.5;

    if (letters.length > 0) {
      // We need to calculate the effort of these buttons relative to the spelling page itself
      // (as if the user is already on the keyboard)
      const keyboardResult = this.analyzeFrom(tree, spellingPage, setPcts, false, options);
      const keyboardLetters = keyboardResult.buttons.filter(
        (b) => b.label.length === 1 && /[a-zA-Z]/.test(b.label)
      );

      if (keyboardLetters.length > 0) {
        avgEffort = keyboardLetters.reduce((sum, b) => sum + b.effort, 0) / keyboardLetters.length;
      }
    }

    return {
      spellingPage,
      spellingBaseEffort,
      spellingAvgLetterEffort: avgEffort,
    };
  }

  /**
   * Build reference maps for semantic_id and clone_id frequencies
   */
  private buildReferenceMaps(tree: AACTree): {
    setRefs: { [id: string]: number };
    setPcts: { [id: string]: number };
  } {
    const setRefs: { [id: string]: number } = {};
    const cellRefs: { [ref: string]: number } = {};
    let rootRows = 0;
    let rootCols = 0;
    // First pass: calculate dimensions and count references
    Object.values(tree.pages).forEach((board: AACPage) => {
      rootRows = rootRows || board.grid.length;
      rootCols = rootCols || board.grid[0]?.length || 0;

      // Count semantic_id and clone_id occurrences from board properties (upstream)
      board.semantic_ids?.forEach((id: string) => {
        setRefs[id] = (setRefs[id] || 0) + 1;
      });
      board.clone_ids?.forEach((id: string) => {
        setRefs[id] = (setRefs[id] || 0) + 1;
      });

      // Count cell references
      for (let r = 0; r < board.grid.length; r++) {
        for (let c = 0; c < (board.grid[r]?.length || 0); c++) {
          const ref = `${r}.${c}`;
          const hasButton = board.grid[r][c] !== null;
          cellRefs[ref] = (cellRefs[ref] || 0) + (hasButton ? 1.0 : 0.25);
        }
      }
    });

    // Calculate percentages
    const setPcts: { [id: string]: number } = {};
    const totalBoards = Object.keys(tree.pages).length;

    Object.entries(setRefs).forEach(([id, count]) => {
      // Extract location from ID (Ruby uses id.split(/-/)[1])
      const parts = id.split('-');
      if (parts.length >= 2) {
        const loc = parts[1];
        const cellCount = cellRefs[loc] || totalBoards;
        setPcts[id] = count / cellCount;
        if (setPcts[id] > 1.0) {
          // console.log(`⚠️ setPcts[${id}] = ${setPcts[id].toFixed(4)} (count=${count}, cellCount=${cellCount.toFixed(2)})`);
          setPcts[id] = 1.0; // Cap at 1.0 like Ruby effectively does
        }
      } else {
        setPcts[id] = count / totalBoards;
      }
    });

    return { setRefs, setPcts };
  }

  /**
   * Count scan items for visual scanning effort
   * When block scanning is enabled, count unique scan blocks instead of individual buttons
   */
  private countScanBlocks(
    board: AACPage,
    currentRowIndex: number,
    currentColIndex: number,
    priorScanBlocks: Set<number>
  ): number {
    // Block scanning: count unique scan blocks before current position
    // Reuse the priorScanBlocks set from the parent scope
    for (let r = 0; r <= currentRowIndex; r++) {
      const row = board.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (r === currentRowIndex && c === currentColIndex) return priorScanBlocks.size;
        const btn = row[c];
        if (btn && (btn.label || btn.id).length > 0) {
          const block =
            btn.scanBlock ||
            (btn.scanBlocks && btn.scanBlocks.length > 0 ? btn.scanBlocks[0] : null);
          if (block !== null) priorScanBlocks.add(block);
        }
      }
    }
    return priorScanBlocks.size;
  }

  /**
   * Analyze starting from a specific board
   */
  private analyzeFrom(
    tree: AACTree,
    brd: AACPage,
    setPcts: { [id: string]: number },
    _isRoot: boolean,
    options: MetricsOptions = {}
  ): {
    buttons: ButtonMetrics[];
    levels: { [level: number]: ButtonMetrics[] };
    totalButtons: number;
    visitedBoardEfforts: Map<string, number>;
  } {
    const visitedBoardIds = new Map<string, number>();
    const visitedBoardEfforts = new Map<string, number>();
    const toVisit: ToVisitItem[] = [
      {
        board: brd,
        level: 0,
        entryX: 1.0,
        entryY: 1.0,
      },
    ];

    const knownButtons = new Map<string, ButtonMetrics>();
    const levels: { [level: number]: ButtonMetrics[] } = {};

    while (toVisit.length > 0) {
      const item = toVisit.shift();
      if (!item) break;
      const { board, level, entryX, entryY, priorEffort = 0, temporaryHomeId } = item;

      // Skip if already visited at a lower level with equal or better prior effort
      // Skip if already visited at a strictly lower level
      const existingLevel = visitedBoardIds.get(board.id);
      if (existingLevel !== undefined && existingLevel < level) {
        continue;
      }
      visitedBoardIds.set(board.id, level);
      visitedBoardEfforts.set(board.id, priorEffort);

      const rows = board.grid.length;
      const cols = board.grid[0]?.length || 0;

      // Calculate board-level effort
      // Ruby uses grid size (rows * cols) for field size effort
      const gridSize = rows * cols;
      let boardEffort = baseBoardEffort(rows, cols, gridSize);

      // Apply reuse discounts - iterate through grid cells like Ruby does
      let reuseDiscount = 0.0;
      board.grid.forEach((row: (AACButton | null)[]) => {
        row.forEach((btn: AACButton | null) => {
          if (!btn) return;

          if (btn.clone_id && setPcts[btn.clone_id]) {
            reuseDiscount += EFFORT_CONSTANTS.REUSED_CLONE_FROM_OTHER_BONUS * setPcts[btn.clone_id];
          } else if (btn.semantic_id && setPcts[btn.semantic_id]) {
            reuseDiscount +=
              EFFORT_CONSTANTS.REUSED_SEMANTIC_FROM_OTHER_BONUS * setPcts[btn.semantic_id];
          }
        });
      });

      boardEffort = Math.max(0, boardEffort - reuseDiscount);

      // Calculate board link percentages
      const boardPcts = this.calculateBoardLinkPercentages(tree, board);

      // Get scanning configuration from page (if available) or options
      const scanningConfig = options.scanningConfig || board.scanningConfig;
      const blockScanEnabled = scanningConfig?.blockScanEnabled || false;

      // Process each button
      const btnHeight = 1.0 / rows;
      const btnWidth = 1.0 / cols;

      // Track scan blocks for block scanning
      const priorScanBlocks: Set<number> = new Set<number>();

      // Iterate over grid positions directly (not just buttons)
      // This matches Ruby's nested loop: rows.times do |row_idx|; columns.times do |col_idx|
      for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        for (let colIndex = 0; colIndex < cols; colIndex++) {
          const btn = board.grid[rowIndex]?.[colIndex];
          if (!btn) continue; // Skip empty cells

          const x = btnWidth / 2 + btnWidth * colIndex;
          const y = btnHeight / 2 + btnHeight * rowIndex;

          // Calculate prior grid positions (not just buttons)
          // This matches Ruby's prior_buttons which increments for each grid position
          const priorGridPositions = rowIndex * cols + colIndex;

          // For block scanning, count unique scan blocks instead
          const priorItems = blockScanEnabled
            ? this.countScanBlocks(board, rowIndex, colIndex, priorScanBlocks)
            : priorGridPositions;

          // Calculate button-level effort
          let buttonEffort = boardEffort;

          // Debug for specific button (disabled for production)
          const debugSpecificButton = btn.label === '$938c2cc0dc';
          if (debugSpecificButton) {
            console.log(
              `\n🔍 DEBUG Button ${btn.label} at [${rowIndex},${colIndex}] on ${board.id}:`
            );
            console.log(`   Entry point: (${entryX.toFixed(4)}, ${entryY.toFixed(4)})`);
            console.log(`   Current level: ${level}`);
            console.log(`   Prior positions: ${priorItems}`);
            console.log(`   Starting effort: ${buttonEffort.toFixed(6)}`);
          }

          // Apply semantic_id discounts
          if (btn.semantic_id && boardPcts[btn.semantic_id]) {
            const discount =
              EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.semantic_id];
            const old = buttonEffort;
            buttonEffort = Math.min(buttonEffort, buttonEffort * discount);
            if (debugSpecificButton)
              console.log(
                `   Semantic board discount: ${old.toFixed(6)} -> ${buttonEffort.toFixed(6)} (pct=${boardPcts[btn.semantic_id].toFixed(4)})`
              );
          } else if (btn.semantic_id && boardPcts[`upstream-${btn.semantic_id}`]) {
            const discount =
              EFFORT_CONSTANTS.RECOGNIZABLE_SEMANTIC_FROM_PRIOR_DISCOUNT /
              boardPcts[`upstream-${btn.semantic_id}`];
            const old = buttonEffort;
            buttonEffort = Math.min(buttonEffort, buttonEffort * discount);
            if (debugSpecificButton)
              console.log(
                `   Semantic upstream discount: ${old.toFixed(6)} -> ${buttonEffort.toFixed(6)} (pct=${boardPcts[`upstream-${btn.semantic_id}`].toFixed(4)})`
              );
          }

          // Apply clone_id discounts
          if (btn.clone_id && boardPcts[btn.clone_id]) {
            const discount =
              EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.clone_id];
            buttonEffort = Math.min(buttonEffort, buttonEffort * discount);
          } else if (btn.clone_id && boardPcts[`upstream-${btn.clone_id}`]) {
            const discount =
              EFFORT_CONSTANTS.RECOGNIZABLE_CLONE_FROM_PRIOR_DISCOUNT /
              boardPcts[`upstream-${btn.clone_id}`];
            buttonEffort = Math.min(buttonEffort, buttonEffort * discount);
          }

          // Calculate button effort based on access method (Touch vs Scanning)
          const isScanning = !!scanningConfig || !!board.scanType;
          if (isScanning) {
            const { steps, selections, loopSteps } = this.calculateScanSteps(
              board,
              btn,
              rowIndex,
              colIndex,
              scanningConfig
            );

            // Determine effective costs based on selection method
            let currentStepCost = options.scanStepCost ?? EFFORT_CONSTANTS.SCAN_STEP_COST;
            const currentSelectionCost =
              options.scanSelectionCost ?? EFFORT_CONSTANTS.SCAN_SELECTION_COST;

            // Step Scan 2 Switch: Every step is a physical selection with Switch 1
            if (scanningConfig?.selectionMethod === ScanningSelectionMethod.StepScan2Switch) {
              // The cost of moving is now a selection cost
              currentStepCost = currentSelectionCost;
            } else if (
              scanningConfig?.selectionMethod === ScanningSelectionMethod.StepScan1Switch
            ) {
              // Single switch step scan: every step is a physical selection
              currentStepCost = currentSelectionCost;
            }

            let sEffort = scanningEffort(steps, selections, currentStepCost, currentSelectionCost);

            // Factor in error correction if enabled
            if (scanningConfig?.errorCorrectionEnabled) {
              const errorRate =
                scanningConfig.errorRate ?? EFFORT_CONSTANTS.DEFAULT_SCAN_ERROR_RATE;
              // A "miss" results in needing to wait for a loop (or part of one)
              // We model this as errorRate * (loopSteps * stepCost)
              const retryPenalty = loopSteps * currentStepCost;
              sEffort += errorRate * retryPenalty;
            }

            // Apply discounts to scanning effort (similar to touch)
            if (btn.semantic_id && boardPcts[btn.semantic_id]) {
              const discount =
                EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.semantic_id];
              sEffort = Math.min(sEffort, sEffort * discount);
            } else if (btn.clone_id && boardPcts[btn.clone_id]) {
              const discount =
                EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.clone_id];
              sEffort = Math.min(sEffort, sEffort * discount);
            }

            buttonEffort += sEffort;
          } else {
            // Add distance effort (Touch only)
            let distance = distanceEffort(x, y, entryX, entryY);

            // Apply distance discounts
            if (btn.semantic_id) {
              if (boardPcts[btn.semantic_id]) {
                const discount =
                  EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.semantic_id];
                distance = Math.min(distance, distance * discount);
              } else if (boardPcts[`upstream-${btn.semantic_id}`]) {
                const discount =
                  EFFORT_CONSTANTS.RECOGNIZABLE_SEMANTIC_FROM_PRIOR_DISCOUNT /
                  boardPcts[`upstream-${btn.semantic_id}`];
                distance = Math.min(distance, distance * discount);
              } else if (level > 0 && setPcts[btn.semantic_id]) {
                const discount =
                  EFFORT_CONSTANTS.RECOGNIZABLE_SEMANTIC_FROM_OTHER_DISCOUNT /
                  setPcts[btn.semantic_id];
                distance = Math.min(distance, distance * discount);
              }
            }
            if (btn.clone_id) {
              if (boardPcts[btn.clone_id]) {
                const discount =
                  EFFORT_CONSTANTS.SAME_LOCATION_AS_PRIOR_DISCOUNT / boardPcts[btn.clone_id];
                distance = Math.min(distance, distance * discount);
              } else if (boardPcts[`upstream-${btn.clone_id}`]) {
                const discount =
                  EFFORT_CONSTANTS.RECOGNIZABLE_CLONE_FROM_PRIOR_DISCOUNT /
                  boardPcts[`upstream-${btn.clone_id}`];
                distance = Math.min(distance, distance * discount);
              } else if (level > 0 && setPcts[btn.clone_id]) {
                const discount =
                  EFFORT_CONSTANTS.RECOGNIZABLE_CLONE_FROM_OTHER_DISCOUNT / setPcts[btn.clone_id];
                distance = Math.min(distance, distance * discount);
              }
            }

            buttonEffort += distance;

            // Add visual scan or local scan effort
            if (
              distance > EFFORT_CONSTANTS.DISTANCE_THRESHOLD_TO_SKIP_VISUAL_SCAN ||
              (entryX === 1.0 && entryY === 1.0)
            ) {
              buttonEffort += visualScanEffort(priorItems);
            } else {
              buttonEffort += localScanEffort(distance);
            }
          }

          // Add cumulative prior effort
          buttonEffort += priorEffort;

          // Track scan blocks for block scanning, otherwise track individual buttons
          if (blockScanEnabled) {
            const scanBlockId = btn.scanBlock ?? btn.scanBlocks?.[0];
            if (scanBlockId !== undefined && scanBlockId !== null) {
              priorScanBlocks.add(scanBlockId);
            }
          }

          // Handle navigation buttons
          if (btn.targetPageId) {
            const nextBoard = tree.getPage(btn.targetPageId);
            if (nextBoard) {
              // Only add to toVisit if this board hasn't been visited yet at any level
              // The visitedBoardIds map stores the *lowest* level a board was visited.
              // If it's already in the map, it means we've processed it or scheduled it at a lower level.
              if (visitedBoardIds.get(nextBoard.id) === undefined) {
                const changeEffort = EFFORT_CONSTANTS.BOARD_CHANGE_PROCESSING_EFFORT;
                const tempHomeId =
                  btn.semanticAction?.platformData?.grid3?.parameters?.temporary_home === 'prior'
                    ? board.id
                    : btn.semanticAction?.platformData?.grid3?.parameters?.temporary_home === true
                      ? btn.targetPageId
                      : temporaryHomeId;

                toVisit.push({
                  board: nextBoard,
                  level: level + 1,
                  priorEffort: buttonEffort + changeEffort,
                  temporaryHomeId: tempHomeId,
                  entryX: x,
                  entryY: y,
                  entryCloneId: btn.clone_id,
                  entrySemanticId: btn.semantic_id,
                });
              }
            }
          }

          // Track word if it speaks or adds to sentence
          const isSpeak =
            btn.semanticAction?.category === AACSemanticCategory.COMMUNICATION && !btn.targetPageId; // Must not be a navigation button
          const addToSentence =
            btn.semanticAction?.platformData?.grid3?.parameters?.add_to_sentence ||
            btn.semanticAction?.fallback?.add_to_sentence;

          if (isSpeak || addToSentence) {
            let finalEffort = buttonEffort;

            // Apply Board Change Processing Effort Discount (matching Ruby lines 347-350)
            const changeEffort = EFFORT_CONSTANTS.BOARD_CHANGE_PROCESSING_EFFORT;
            if (btn.clone_id && boardPcts[btn.clone_id]) {
              const discount = Math.min(
                changeEffort,
                (changeEffort * 0.3) / boardPcts[btn.clone_id]
              );
              finalEffort -= discount;
            } else if (btn.semantic_id && boardPcts[btn.semantic_id]) {
              const discount = Math.min(
                changeEffort,
                (changeEffort * 0.5) / boardPcts[btn.semantic_id]
              );
              finalEffort -= discount;
            }

            const existing = knownButtons.get(btn.label);
            const knownBtn: ButtonMetrics = {
              id: btn.id,
              label: btn.label,
              level,
              effort: finalEffort,
              count: (existing?.count || 0) + 1,
              semantic_id: btn.semantic_id,
              clone_id: btn.clone_id,
              temporary_home_id: temporaryHomeId || undefined,
            };

            if (!existing || finalEffort < existing.effort) {
              knownButtons.set(btn.label, knownBtn);
            }
          }
        }
      }
    }

    // Convert to array and group by level
    const buttons = Array.from(knownButtons.values());
    buttons.forEach((btn) => {
      if (!levels[btn.level]) {
        levels[btn.level] = [];
      }
      levels[btn.level].push(btn);
    });

    // Calculate total_buttons as sum of all button counts (matching Ruby line 136)
    // Ruby: total_buttons: buttons.map{|b| b[:count] || 1}.sum
    const calculatedTotalButtons = buttons.reduce((sum, btn) => sum + (btn.count || 1), 0);

    return {
      buttons,
      levels,
      totalButtons: calculatedTotalButtons,
      visitedBoardEfforts,
    };
  }

  /**
   * Calculate what percentage of links to this board match semantic_id/clone_id
   */
  private calculateBoardLinkPercentages(tree: AACTree, board: AACPage): { [id: string]: number } {
    const boardPcts: { [id: string]: number } = {};
    let totalLinks = 0;

    Object.values(tree.pages).forEach((sourceBoard: AACPage) => {
      sourceBoard.buttons.forEach((btn: AACButton) => {
        if (btn.targetPageId === board.id) {
          totalLinks++;
          if (btn.semantic_id) {
            boardPcts[btn.semantic_id] = (boardPcts[btn.semantic_id] || 0) + 1;
          }
          if (btn.clone_id) {
            boardPcts[btn.clone_id] = (boardPcts[btn.clone_id] || 0) + 1;
          }

          // Also count IDs present on the source board that links to this one
          sourceBoard.semantic_ids?.forEach((id: string) => {
            boardPcts[`upstream-${id}`] = (boardPcts[`upstream-${id}`] || 0) + 1;
          });
          sourceBoard.clone_ids?.forEach((id: string) => {
            boardPcts[`upstream-${id}`] = (boardPcts[`upstream-${id}`] || 0) + 1;
          });
        }
      });
    });

    // Convert counts to percentages
    if (totalLinks > 0) {
      Object.keys(boardPcts).forEach((id) => {
        boardPcts[id] = boardPcts[id] / totalLinks;
      });
    }

    boardPcts['all'] = totalLinks;
    return boardPcts;
  }

  /**
   * Quick check whether any button in the tree has a POS tag.
   * Used to auto-enable smart grammar without requiring explicit opt-in.
   *
   * IMPORTANT: Only counts POS from non-Inflector and non-Suffix buttons.
   * TDSnap Inflector buttons and Grid3 Suffix buttons are grammar controls,
   * not content words — they should NOT auto-enable morphology.
   */
  private treeHasPosTags(tree: AACTree): boolean {
    for (const page of Object.values(tree.pages)) {
      for (const row of page.grid) {
        for (const btn of row) {
          if (
            btn?.pos &&
            btn.pos !== 'Unknown' &&
            btn.pos !== 'Ignore' &&
            btn.pos !== 'Suffix' &&
            btn.contentType !== 'Inflector'
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Expand morphological predictions from POS tags on buttons
   *
   * For each button that has a POS tag (e.g., 'Verb', 'Noun'), use the
   * MorphologyEngine to generate inflected word forms and populate the
   * button's predictions array. This is done as a pre-processing step
   * before calculateWordFormMetrics assigns effort to each form.
   */
  private async expandMorphologicalPredictions(
    tree: AACTree,
    options: MetricsOptions
  ): Promise<void> {
    const locale = options.morphologyLocale || 'en-gb';
    let morph: MorphologyEngine;

    if (options.tdsnapLexiconPath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { TDSnapLexiconParser } = require('../morphology/tdsnapLexiconParser');
      const parser = new TDSnapLexiconParser();
      const lexiconData = await parser.parseDb(options.tdsnapLexiconPath, locale.replace('-', '_'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      morph = MorphologyEngine.fromTDSnapLexicon(lexiconData);
      this.expandTDSnapPredictions(tree, morph);
      return;
    }

    if (options.grid3VerbsPath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Grid3VerbsParser } = require('../morphology/grid3VerbsParser');
      const parser = new Grid3VerbsParser();
      const verbForms = await parser.parseZip(options.grid3VerbsPath);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      morph = MorphologyEngine.fromGrid3Verbs(verbForms);
      this.expandGrid3Predictions(tree, morph);
      return;
    }

    morph = new MorphologyEngine(locale);
    this.expandGrid3Predictions(tree, morph);
  }

  /**
   * Expand morphological predictions for Grid3 pagesets.
   *
   * Grid3 uses suffix buttons (pos='Suffix') on the same page as content words.
   * Different pages have different suffix buttons — e.g., topic pages may only
   * have -s (plural), while the Magic Wand page has -s, -er, -est, -ly, -y, -'s.
   *
   * Rules:
   * 1. Build a suffix→formSlot map (-s → plural, -er → comparative, etc.)
   * 2. For each page, collect available suffix buttons
   * 3. Only generate forms for slots that have matching suffix buttons on that page
   * 4. POS inference is used for untagged content words (Grid3 grids often lack POS)
   */
  private expandGrid3Predictions(tree: AACTree, morph: MorphologyEngine): void {
    const skipInference = new Set([
      'a',
      'an',
      'the',
      'to',
      'in',
      'on',
      'at',
      'of',
      'for',
      'and',
      'or',
      'but',
      'not',
      'no',
      'yes',
      'is',
      'am',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'has',
      'have',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'shall',
      'may',
      'might',
      'can',
      'must',
      'with',
      'from',
      'by',
      'up',
      'down',
      'out',
      'off',
      'over',
      'under',
      'again',
      'then',
      'than',
      'so',
      'if',
      'when',
      'where',
      'how',
      'what',
      'who',
      'which',
      'that',
      'this',
      'these',
      'those',
      'here',
      'there',
      'now',
      'very',
      'just',
      'more',
      'also',
      'too',
      'please',
      'thank',
      'hi',
      'hello',
      'bye',
      'goodbye',
      'okay',
      'oh',
      'wow',
      'sorry',
    ]);

    // Map suffix button labels to the morphology slots they produce
    const SUFFIX_TO_SLOT: Record<string, string[]> = {
      '-s': ['plural'],
      "-'s": ['possessive'],
      '-er': ['comparative'],
      '-est': ['superlative'],
      '-ly': ['adverb'],
      '-y': ['adjective'],
    };

    // POS → slots that POS can produce (for filtering)
    const POS_TO_SUFFIX_SLOTS: Record<string, Set<string>> = {
      Noun: new Set(['plural', 'possessive']),
      Verb: new Set(['plural']),
      Adjective: new Set(['comparative', 'superlative', 'adverb', 'adjective']),
    };

    for (const page of Object.values(tree.pages)) {
      // Collect suffix buttons on this page
      const pageSuffixes = new Set<string>();
      const pageSuffixSlots = new Set<string>();
      for (const row of page.grid) {
        for (const btn of row) {
          if (btn?.pos === 'Suffix' && btn.label) {
            pageSuffixes.add(btn.label);
            const slots = SUFFIX_TO_SLOT[btn.label];
            if (slots) {
              for (const s of slots) pageSuffixSlots.add(s);
            }
          }
        }
      }

      // No suffix buttons on this page → no morphology
      if (pageSuffixSlots.size === 0) continue;

      for (const row of page.grid) {
        for (const btn of row) {
          if (!btn || !btn.label) continue;
          if (btn.pos === 'Suffix') continue;

          let pos = btn.pos;

          if (!pos || pos === 'Unknown' || pos === 'Ignore') {
            const lower = btn.label.toLowerCase();
            if (!skipInference.has(lower) && !lower.includes(' ') && lower.length > 1) {
              const inferredPOS = morph.inferPOS(lower);
              if (inferredPOS) {
                pos = inferredPOS;
                btn.pos = inferredPOS;
              } else {
                pos = 'Noun';
                btn.pos = 'Noun';
              }
            }
          }

          if (!pos || pos === 'Unknown' || pos === 'Ignore') continue;

          // Check if this POS can produce forms matching the page's suffix slots
          const posSlots = POS_TO_SUFFIX_SLOTS[pos];
          if (!posSlots) continue;
          const hasRelevantSlot = [...posSlots].some((s) => pageSuffixSlots.has(s));
          if (!hasRelevantSlot) continue;

          const allForms = morph.inflect(btn.label, pos);
          if (allForms.length === 0) continue;

          // Filter forms: only include those producible by suffixes on this page
          // For the built-in engine, we can't easily map forms to slots, so
          // include all forms when any relevant suffix exists. The per-page
          // gate (suffix presence) is the main filter.
          const existing = btn.predictions || [];
          const merged = new Set([...existing, ...allForms]);
          btn.predictions = Array.from(merged);
        }
      }
    }
  }

  /**
   * Expand morphological predictions for TDSnap pagesets.
   *
   * TDSnap uses Inflector buttons (ContentType=3) on "Word Forms" pages to
   * provide morphology. These pages are loaded dynamically by the runtime,
   * NOT via navigation buttons, so they are unreachable in our tree model.
   *
   * Rules:
   * 1. If the pageset has NO Inflector buttons → no morphology at all
   * 2. Only generate forms whose grammar tag matches an available Inflector
   *    (e.g., if there's no -ly Inflector, don't generate "happily")
   * 3. No POS inference — only the lexicon determines which words get forms
   */
  private expandTDSnapPredictions(tree: AACTree, morph: MorphologyEngine): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TDSnapLexiconParser } = require('../morphology/tdsnapLexiconParser');

    // Step 1: Collect available grammar tags from Inflector buttons
    const availableTags = new Set<string>();
    for (const page of Object.values(tree.pages)) {
      for (const row of page.grid) {
        for (const btn of row) {
          if (btn?.contentType === 'Inflector' && btn.parameters?.grammar?.handler) {
            const parsed = TDSnapLexiconParser.parseContentTypeHandler(
              btn.parameters.grammar.handler as string
            );
            if (parsed) {
              const key = `${parsed.category}:${parsed.subtype}`;
              const tag = TDSnapLexiconParser.HANDLER_TAG_MAP[key] as string | undefined;
              if (tag) availableTags.add(tag);
            }
          }
        }
      }
    }

    if (availableTags.size === 0) return;

    // Step 2: For each button, look up lexicon forms filtered by available tags
    for (const page of Object.values(tree.pages)) {
      for (const row of page.grid) {
        for (const btn of row) {
          if (!btn || !btn.label || btn.contentType === 'Inflector') continue;

          const filtered = this.filterFormsByAvailableTags(morph, btn.label, availableTags);

          if (filtered.length > 0) {
            const existing = btn.predictions || [];
            const merged = new Set([...existing, ...filtered]);
            btn.predictions = Array.from(merged);
          }
        }
      }
    }
  }

  private filterFormsByAvailableTags(
    morph: MorphologyEngine,
    base: string,
    availableTags: Set<string>
  ): string[] {
    const entry = morph.getLexiconEntry(base.toLowerCase());
    if (!entry) return [];

    const forms: string[] = [];
    for (const f of entry.forms) {
      if (availableTags.has(f.tag) && f.form.toLowerCase() !== base.toLowerCase()) {
        forms.push(f.form);
      }
    }
    return forms;
  }

  /**
   * Calculate metrics for word forms (smart grammar predictions)
   *
   * Word forms are dynamically generated and not part of the tree structure.
   * Their effort is calculated as:
   * - Parent button's cumulative effort (to reach the button)
   * - + Effort to select the word form from its position in predictions grid
   *
   * If a word exists as both a regular button and a word form, the version
   * with lower effort is kept.
   *
   * @param tree - The AAC tree
   * @param buttons - Already calculated button metrics
   * @param options - Metrics options
   * @returns Object containing word form metrics and labels that were replaced
   */
  private calculateWordFormMetrics(
    tree: AACTree,
    buttons: ButtonMetrics[],
    options: MetricsOptions = {}
  ): { wordFormMetrics: ButtonMetrics[]; replacedLabels: Set<string> } {
    const wordFormMetrics: ButtonMetrics[] = [];
    const replacedLabels = new Set<string>();

    // Track buttons by label to compare efforts
    const existingLabels = new Map<string, ButtonMetrics>();
    buttons.forEach((btn) => existingLabels.set(btn.label.toLowerCase(), btn));

    // Build a map of POS tags from ALL tree buttons, keyed by lowercase label.
    // This ensures words on BFS-unreachable pages still contribute POS data.
    const treePosMap = new Map<string, string>();
    const treePredictionsMap = new Map<string, string[]>();
    Object.values(tree.pages).forEach((page: AACPage) => {
      page.grid.forEach((row: (AACButton | null)[]) => {
        row.forEach((btn: AACButton | null) => {
          if (!btn || !btn.label) return;
          const lower = btn.label.toLowerCase();
          if (btn.pos && btn.pos !== 'Unknown' && btn.pos !== 'Ignore') {
            treePosMap.set(lower, btn.pos);
          }
          if (btn.predictions && btn.predictions.length > 0) {
            const existing = treePredictionsMap.get(lower);
            if (!existing || btn.predictions.length > existing.length) {
              treePredictionsMap.set(lower, btn.predictions);
            }
          }
        });
      });
    });

    // For metrics buttons that lack POS but have a tree counterpart with POS,
    // propagate the POS tag so it's available in the output.
    buttons.forEach((btn) => {
      const lower = btn.label.toLowerCase();
      if (!btn.pos || btn.pos === 'Unknown' || btn.pos === 'Ignore') {
        const treePos = treePosMap.get(lower);
        if (treePos) btn.pos = treePos;
      }
    });

    // Note: buttons on pages unreachable via BFS from the root page are
    // intentionally excluded. If there is no navigation path to a page,
    // those buttons are not accessible to the user and should not count
    // as available vocabulary.

    // Iterate through all pages to find buttons with predictions
    Object.values(tree.pages).forEach((page: AACPage) => {
      page.grid.forEach((row: (AACButton | null)[]) => {
        row.forEach((btn: AACButton | null) => {
          if (!btn || !btn.predictions || btn.predictions.length === 0) return;

          // Find the parent button's metrics (by id first, then by label)
          let parentMetrics = buttons.find((b) => b.id === btn.id);
          if (!parentMetrics && btn.label) {
            parentMetrics = existingLabels.get(btn.label.toLowerCase());
          }
          if (!parentMetrics) return;

          // Build set of original Suggest Words predictions (from Prediction.PredictThis).
          // These require an extra confirmation tap from the user. Smart grammar
          // morphology outcomes are generated automatically and need no extra tap.
          const suggestWordsSet = new Set<string>(
            ((btn.parameters?.predictions || []) as string[]).map((w) => w.toLowerCase())
          );

          // Calculate effort for each word form
          btn.predictions.forEach((wordForm: string, index: number) => {
            const wordFormLower = wordForm.toLowerCase();

            const isSuggestWords = suggestWordsSet.has(wordFormLower);

            let wordFormEffort: number;

            if (options.tdsnapLexiconPath && !isSuggestWords) {
              // TDSnap Inflector-based form: the grammar overlay appears
              // dynamically when a word is selected. The cost is a fixed
              // single selection to tap the Inflector button.
              wordFormEffort =
                parentMetrics.effort + EFFORT_CONSTANTS.TDSNAP_GRAMMAR_OVERLAY_EFFORT;
            } else {
              // Grid-based prediction layout (Suggest Words, or Grid3 morphology)
              const predictionsGridCols = 2;
              const predictionRowIndex = Math.floor(index / predictionsGridCols);
              const predictionColIndex = index % predictionsGridCols;
              const predictionPriorItems =
                predictionRowIndex * predictionsGridCols + predictionColIndex;
              const predictionSelectionEffort = visualScanEffort(predictionPriorItems);

              const suggestWordsConfirmation = isSuggestWords
                ? EFFORT_CONSTANTS.SUGGEST_WORDS_SELECTION_EFFORT
                : 0;

              wordFormEffort =
                parentMetrics.effort + predictionSelectionEffort + suggestWordsConfirmation;
            }

            // Check if this word already exists as a regular button
            const existingBtn = existingLabels.get(wordFormLower);

            // If word exists and has lower or equal effort, skip the word form
            if (existingBtn && existingBtn.effort <= wordFormEffort) {
              return;
            }

            // If word exists but word form has lower effort, mark for replacement
            if (existingBtn && existingBtn.effort > wordFormEffort) {
              replacedLabels.add(wordFormLower);
            }

            // Create word form metric
            const wordFormBtn: ButtonMetrics = {
              id: `${btn.id}_wordform_${index}`,
              label: wordForm,
              level: parentMetrics.level,
              effort: wordFormEffort,
              count: 1,
              semantic_id: parentMetrics.semantic_id,
              clone_id: parentMetrics.clone_id,
              temporary_home_id: parentMetrics.temporary_home_id,
              is_word_form: true,
              is_suggest_words: suggestWordsSet.has(wordFormLower) || undefined,
              parent_button_id: btn.id,
              parent_button_label: parentMetrics.label,
            };

            wordFormMetrics.push(wordFormBtn);
            existingLabels.set(wordFormLower, wordFormBtn);
          });
        });
      });
    });

    console.log(
      `📝 Calculated ${wordFormMetrics.length} word form metrics` +
        (replacedLabels.size > 0
          ? ` (${replacedLabels.size} replaced higher-effort buttons: ${Array.from(replacedLabels).join(', ')})`
          : '')
    );

    return { wordFormMetrics, replacedLabels };
  }

  /**
   * Calculate grid dimensions from the tree
   */
  private calculateGridDimensions(tree: AACTree): {
    rows: number;
    columns: number;
  } {
    let totalRows = 0;
    let totalCols = 0;
    let count = 0;

    Object.values(tree.pages).forEach((page: AACPage) => {
      totalRows += page.grid.length;
      totalCols += page.grid[0]?.length || 0;
      count++;
    });

    return {
      rows: Math.round(totalRows / count),
      columns: Math.round(totalCols / count),
    };
  }

  /**
   * Calculate scanning steps and selections for a button based on access method
   */
  private calculateScanSteps(
    board: AACPage,
    btn: AACButton,
    rowIndex: number,
    colIndex: number,
    overrideConfig?: any
  ): { steps: number; selections: number; loopSteps: number } {
    const config = overrideConfig || board.scanningConfig;
    // Determine scanning type from local scanType or scanningConfig
    let type: AACScanType = board.scanType || AACScanType.LINEAR;
    if (config?.cellScanningOrder) {
      const order = config.cellScanningOrder;
      // String matching for CellScanningOrder
      if (order === CellScanningOrder.RowColumnScan) type = AACScanType.ROW_COLUMN;
      else if (order === CellScanningOrder.ColumnRowScan) type = AACScanType.COLUMN_ROW;
      else if (order === CellScanningOrder.SimpleScanColumnsFirst) type = AACScanType.COLUMN_ROW;
      else if (order === CellScanningOrder.SimpleScan) type = AACScanType.LINEAR;
    }

    // Force block scan if enabled in config
    const isBlockScan =
      config?.blockScanEnabled ||
      type === AACScanType.BLOCK_ROW_COLUMN ||
      type === AACScanType.BLOCK_COLUMN_ROW;

    if (isBlockScan) {
      const blockId =
        btn.scanBlock || (btn.scanBlocks && btn.scanBlocks.length > 0 ? btn.scanBlocks[0] : null);

      // If no block assigned, treat as its own block at the end (fallback)
      if (blockId === null) {
        const loop = board.grid.length + (board.grid[0]?.length || 0);
        return {
          steps: rowIndex + colIndex + 1,
          selections: 1,
          loopSteps: loop,
        };
      }

      const blockConfig = board.scanBlocksConfig?.find((c) => c.id === blockId);
      const blockOrder = blockConfig?.order ?? blockId;

      // Count unique blocks
      const blocks = new Set<number>();
      let btnInBlockIndex = 0;
      let itemsInBlock = 0;

      for (let r = 0; r < board.grid.length; r++) {
        for (let c = 0; c < (board.grid[r]?.length || 0); c++) {
          const b = board.grid[r][c];
          if (b) {
            const id = b.scanBlock ?? b.scanBlocks?.[0];
            if (id !== undefined && id !== null) blocks.add(id);

            if (id === blockId) {
              itemsInBlock++;
              if (b === btn) {
                btnInBlockIndex = itemsInBlock - 1;
              }
            }
          }
        }
      }

      // 1 selection for block, 1 for item
      return {
        steps: blockOrder + btnInBlockIndex + 1,
        selections: 2,
        loopSteps: blocks.size + itemsInBlock,
      };
    }

    switch (type) {
      case AACScanType.LINEAR: {
        let index = 0;
        let found = false;
        let totalVisible = 0;
        for (let r = 0; r < board.grid.length; r++) {
          for (let c = 0; c < board.grid[r].length; c++) {
            const b = board.grid[r][c];
            if (b && (b.label || '').length > 0) {
              totalVisible++;
              if (!found) {
                if (b === btn) {
                  found = true;
                } else {
                  index++;
                }
              }
            }
          }
        }
        return { steps: index + 1, selections: 1, loopSteps: totalVisible };
      }

      case AACScanType.ROW_COLUMN:
        return {
          steps: rowIndex + 1 + (colIndex + 1),
          selections: 2,
          loopSteps: board.grid.length + (board.grid[0]?.length || 0),
        };

      case AACScanType.COLUMN_ROW:
        return {
          steps: colIndex + 1 + (rowIndex + 1),
          selections: 2,
          loopSteps: (board.grid[0]?.length || 0) + board.grid.length,
        };

      default:
        return {
          steps: rowIndex + 1 + (colIndex + 1),
          selections: 2,
          loopSteps: board.grid.length + (board.grid[0]?.length || 0),
        };
    }
  }
}
