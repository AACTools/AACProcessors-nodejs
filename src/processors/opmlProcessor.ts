import {
  BaseProcessor,
  ProcessorOptions,
  ExtractStringsResult,
  TranslatedString,
  SourceString,
} from '../core/baseProcessor';
import { AACTree, AACPage, AACButton, AACSemanticIntent } from '../core/treeStructure';
import { XMLParser, XMLValidator, XMLBuilder } from 'fast-xml-parser';
import {
  ValidationFailureError,
  buildValidationResultFromMessage,
} from '../validation/validationTypes';
import { ProcessorInput, getBasename, encodeText } from '../utils/io';

interface OpmlOutline {
  '@_text'?: string;
  text?: string;
  _attributes?: {
    text: string;
    [key: string]: string;
  };
  outline?: OpmlOutline[];
}

interface OpmlDocument {
  opml: {
    body: {
      outline: OpmlOutline[];
    };
  };
}

function sanitizeOutlineId(text: string): string {
  const slug = text.replace(/[^a-zA-Z0-9]/g, '_');
  if (slug === '__proto__' || slug === 'prototype' || slug === 'constructor') {
    return `_${slug}`;
  }
  return slug;
}

class OpmlProcessor extends BaseProcessor {
  readonly capabilities = {
    wordList: 'none' as const,
    preservesAssetsOnSave: false,
    newCellCreation: 'allowed' as const,
  };

  constructor(options?: ProcessorOptions) {
    super(options);
  }
  private processOutline(
    outline: OpmlOutline,
    parentId: string | null = null
  ): { page: AACPage | null; childPages: AACPage[] } {
    if (!outline || typeof outline !== 'object') {
      return { page: null, childPages: [] };
    }
    const text =
      outline['@_text'] ||
      (outline._attributes && outline._attributes.text) ||
      (outline as any).text;
    if (!text || typeof text !== 'string') {
      // Skip invalid outlines
      return { page: null, childPages: [] };
    }
    const page = new AACPage({
      id: sanitizeOutlineId(text),
      name: text,
      grid: [],
      buttons: [],
      parentId,
    });

    const childPages: AACPage[] = [];

    if (outline.outline) {
      const children = Array.isArray(outline.outline) ? outline.outline : [outline.outline];
      children.forEach((child) => {
        const childText =
          child['@_text'] || (child._attributes && child._attributes.text) || (child as any).text;
        if (childText && typeof childText === 'string') {
          const button = new AACButton({
            id: `nav_${page.id}_${childText}`,
            label: childText,
            message: '',
            targetPageId: sanitizeOutlineId(childText),
          });
          // Load path: do not record as a user mutation
          page._loadButton(button);

          const { page: childPage, childPages: grandChildren } = this.processOutline(
            child,
            page.id
          );
          if (childPage && childPage.id) childPages.push(childPage, ...grandChildren);
        }
      });
    }

    if (!page || !page.id) return { page: null, childPages: [] };
    return { page, childPages };
  }

  async extractTexts(filePathOrBuffer: ProcessorInput): Promise<string[]> {
    const { readTextFromInput } = this.options.fileAdapter;

    const content = await readTextFromInput(filePathOrBuffer);

    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(content) as OpmlDocument;
    const texts: string[] = [];

    function processNode(node: OpmlOutline): void {
      // Handle different attribute formats
      let textValue: string | undefined;

      if (node && node._attributes && typeof node._attributes.text === 'string') {
        textValue = node._attributes.text;
      } else if (node && typeof node['@_text'] === 'string') {
        textValue = node['@_text'];
      } else if (node && typeof node.text === 'string') {
        textValue = node.text;
      }

      if (textValue) {
        texts.push(textValue);
      }

      if (node && node.outline) {
        const children = Array.isArray(node.outline) ? node.outline : [node.outline];
        children.forEach(processNode);
      }
    }

    const outlines = Array.isArray(data.opml.body.outline)
      ? data.opml.body.outline
      : [data.opml.body.outline];
    outlines.forEach(processNode);
    return texts;
  }

  async loadIntoTree(filePathOrBuffer: ProcessorInput): Promise<AACTree> {
    const { readBinaryFromInput, readTextFromInput } = this.options.fileAdapter;

    const filename =
      typeof filePathOrBuffer === 'string' ? getBasename(filePathOrBuffer) : 'upload.opml';
    const buffer = await readBinaryFromInput(filePathOrBuffer);
    const content = await readTextFromInput(buffer);

    try {
      if (!content || !content.trim()) {
        const validationResult = buildValidationResultFromMessage({
          filename,
          filesize: buffer.byteLength,
          format: 'opml',
          message: 'Empty OPML content',
          type: 'content',
          description: 'OPML content is empty',
        });
        throw new ValidationFailureError('Empty OPML content', validationResult);
      }

      // Validate XML before parsing, fast-xml-parser is permissive by default
      const validationResult = XMLValidator.validate(content);
      if (validationResult !== true) {
        const reason = (validationResult as any)?.err?.msg || JSON.stringify(validationResult);
        const structured = buildValidationResultFromMessage({
          filename,
          filesize: buffer.byteLength,
          format: 'opml',
          message: `Invalid OPML XML: ${reason}`,
          type: 'xml',
          description: 'OPML XML validation',
        });
        throw new ValidationFailureError('Invalid OPML XML', structured);
      }

      const parser = new XMLParser({ ignoreAttributes: false });
      const data = parser.parse(content) as OpmlDocument;
      const tree = new AACTree();
      tree.metadata.format = 'opml';

      // Handle case where body.outline might not exist or be in different formats
      const bodyOutline = data.opml?.body?.outline;
      if (!bodyOutline) {
        const structured = buildValidationResultFromMessage({
          filename,
          filesize: buffer.byteLength,
          format: 'opml',
          message: 'Missing body.outline in OPML document',
          type: 'structure',
          description: 'OPML outline root',
        });
        throw new ValidationFailureError('Invalid OPML structure', structured);
      }

      const outlines = Array.isArray(bodyOutline) ? bodyOutline : [bodyOutline];
      let firstRootId: string | null = null;
      outlines.forEach((outline) => {
        const { page, childPages } = this.processOutline(outline);
        if (page && page.id) {
          tree.addPage(page);
          if (!firstRootId) firstRootId = page.id;
        }
        childPages.forEach((childPage) => {
          if (childPage && childPage.id) tree.addPage(childPage);
        });
      });
      // Set rootId to first root page, or fallback to first page if any exist
      if (firstRootId) {
        tree.rootId = firstRootId;
      } else if (Object.keys(tree.pages).length > 0) {
        tree.rootId = Object.keys(tree.pages)[0];
      }
      return tree;
    } catch (err: any) {
      if (err instanceof ValidationFailureError) {
        throw err;
      }
      const validationResult = buildValidationResultFromMessage({
        filename,
        filesize: buffer.byteLength,
        format: 'opml',
        message: err?.message || 'Failed to parse OPML',
        type: 'parse',
        description: 'Parse OPML XML',
      });
      throw new ValidationFailureError('Failed to load OPML file', validationResult, err);
    }
  }

  async processTexts(
    filePathOrBuffer: ProcessorInput,
    translations: Map<string, string>,
    outputPath: string
  ): Promise<Uint8Array> {
    const { writeBinaryToPath, readTextFromInput } = this.options.fileAdapter;

    const content = await readTextFromInput(filePathOrBuffer);

    let translatedContent = content;

    // Apply translations to text attributes in OPML outline elements
    translations.forEach((translation, originalText) => {
      if (typeof originalText === 'string' && typeof translation === 'string') {
        // Replace text attributes in outline elements
        const textAttrRegex = new RegExp(
          `text="${originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
          'g'
        );
        translatedContent = translatedContent.replace(textAttrRegex, `text="${translation}"`);
      }
    });

    const resultBuffer = encodeText(translatedContent);
    await writeBinaryToPath(outputPath, resultBuffer);
    return resultBuffer;
  }

  async saveFromTree(tree: AACTree, outputPath: string): Promise<void> {
    const { writeTextToPath } = this.options.fileAdapter;

    // Helper to recursively build outline nodes with cycle detection
    function buildOutline(page: AACPage, visited: Set<string> = new Set()): OpmlOutline {
      // Prevent infinite recursion by tracking visited pages
      if (visited.has(page.id)) {
        return {
          '@_text': `${page.name || page.id} (circular reference)`,
        };
      }

      visited.add(page.id);

      const outline: OpmlOutline = {
        '@_text': page.name || page.id,
      };

      // Find child pages (by NAVIGATE buttons)
      const childOutlines = page.buttons
        .filter(
          (b) =>
            b.semanticAction?.intent === AACSemanticIntent.NAVIGATE_TO &&
            !!b.targetPageId &&
            !!tree.pages[b.targetPageId]
        )
        .map((b) => {
          const targetId = b.targetPageId;
          if (!targetId) {
            return null;
          }
          const targetPage = tree.pages[targetId];
          if (!targetPage) {
            return null;
          }
          return buildOutline(targetPage, new Set(visited));
        })
        .filter((childOutline): childOutline is OpmlOutline => childOutline !== null);
      if (childOutlines.length) outline.outline = childOutlines;
      return outline;
    }
    // Find root pages (no parentId or not navigated to by any button)
    const navigatedIds = new Set<string>();
    Object.values(tree.pages).forEach((page) => {
      page.buttons.forEach((b) => {
        if (b.semanticAction?.intent === AACSemanticIntent.NAVIGATE_TO && b.targetPageId)
          navigatedIds.add(b.targetPageId);
      });
    });
    let rootPages = Object.values(tree.pages).filter((page) => !navigatedIds.has(page.id));
    // If no rootPages, fall back to tree.rootId
    const treeRootId = tree.rootId;
    if ((!rootPages || rootPages.length === 0) && treeRootId && tree.pages[treeRootId]) {
      rootPages = [tree.pages[treeRootId]];
    } else if (treeRootId) {
      rootPages = rootPages.sort((a, b) =>
        a.id === treeRootId ? -1 : b.id === treeRootId ? 1 : 0
      );
    }
    // Build outlines
    const outlines = rootPages.map((page) => buildOutline(page));
    // Compose OPML document
    const opmlObj = {
      opml: {
        '@_version': '2.0',
        head: { title: 'Exported OPML' },
        body: { outline: outlines },
      },
    };
    // Convert to XML
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: '    ',
      suppressEmptyNode: false,
      attributeNamePrefix: '@_',
    });
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(opmlObj);
    await writeTextToPath(outputPath, xml);
  }

  /**
   * Extract strings with metadata for aac-tools-platform compatibility
   * Uses the generic implementation from BaseProcessor
   */
  extractStringsWithMetadata(filePath: string): Promise<ExtractStringsResult> {
    return this.extractStringsWithMetadataGeneric(filePath);
  }

  /**
   * Generate translated download for aac-tools-platform compatibility
   * Uses the generic implementation from BaseProcessor
   */
  generateTranslatedDownload(
    filePath: string,
    translatedStrings: TranslatedString[],
    sourceStrings: SourceString[]
  ): Promise<string> {
    return this.generateTranslatedDownloadGeneric(filePath, translatedStrings, sourceStrings);
  }
}

export { OpmlProcessor };
