// Regression test for #57: saveFromTree must not force an inline FontColour
// onto Workspace/plugin cells that have no explicit style, and must not emit
// malformed colour values that ensureAlphaChannel silently turns into white.
import fs from 'fs';
import path from 'path';
import { GridsetProcessor } from '../src/processors/gridsetProcessor';
import { AACTree, AACPage, AACButton } from '../src/core/treeStructure';

describe('GridsetProcessor plugin cell styling (#57)', () => {
  const outPath: string = path.join(__dirname, 'out-workspace-style.gridset');

  const buildTree = (workspaceStyle?: { fontColor: string }): AACTree => {
    const tree = new AACTree();
    const ws = new AACButton({
      id: 'ws',
      label: 'workspace',
      message: '',
      contentType: 'Workspace',
      contentSubType: 'Chat',
      ...(workspaceStyle ? { style: workspaceStyle } : {}),
    });
    const a = new AACButton({ id: 'a', label: 'A', message: 'A' });
    const page = new AACPage({
      id: 'p',
      name: 'P',
      grid: [
        [ws, ws],
        [a, null],
      ],
      buttons: [ws, a],
      parentId: null,
    });
    tree.addPage(page);
    tree.rootId = 'p';
    return tree;
  };

  const readGridXml = async (): Promise<string> => {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(outPath);
    const entry = zip.getEntries().find((e: any) => e.entryName.endsWith('grid.xml'));
    if (!entry) throw new Error('grid.xml not found in output');
    return entry.getData().toString('utf-8');
  };

  afterEach(() => {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  });

  it('does not write an inline FontColour on a Workspace cell without a style', async () => {
    const processor = new GridsetProcessor({ preserveAllButtons: true });
    await processor.saveFromTree(buildTree(), outPath);

    const xml = await readGridXml();
    const workspaceCell = xml.match(
      /<Cell [^>]*>(?:(?!<\/Cell>).)*?<ContentType>Workspace<\/ContentType>(?:(?!<\/Cell>).)*?<\/Cell>/s
    )?.[0];
    expect(workspaceCell).toBeDefined();
    expect(workspaceCell).toContain('<BasedOnStyle>Workspace</BasedOnStyle>');
    expect(workspaceCell).not.toContain('<FontColour>');
  });

  it('keeps an explicitly set FontColour on a Workspace cell', async () => {
    const processor = new GridsetProcessor({ preserveAllButtons: true });
    await processor.saveFromTree(buildTree({ fontColor: '#000000FF' }), outPath);

    const xml = await readGridXml();
    const workspaceCell = xml.match(
      /<Cell [^>]*>(?:(?!<\/Cell>).)*?<ContentType>Workspace<\/ContentType>(?:(?!<\/Cell>).)*?<\/Cell>/s
    )?.[0];
    expect(workspaceCell).toBeDefined();
    expect(workspaceCell).toContain('<FontColour>#000000FF</FontColour>');
  });

  it('never emits malformed (non 8-digit) colour values', async () => {
    const processor = new GridsetProcessor({ preserveAllButtons: true });
    await processor.saveFromTree(buildTree(), outPath);

    const xml = await readGridXml();
    const colours = xml.match(/#(?:[0-9A-Fa-f]+)>/g) ?? [];
    for (const c of colours) {
      const hex = c.slice(1, -1);
      expect([3, 6, 8]).toContain(hex.length);
    }
    expect(xml).not.toContain('#FF000000FF');
    expect(xml).not.toContain('<FontColour>#FFFFFFFF'); // no accidental white overrides
  });
});
