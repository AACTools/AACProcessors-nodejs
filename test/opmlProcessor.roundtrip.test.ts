import fs from 'fs';
import path from 'path';
import { OpmlProcessor } from '../src/processors/opmlProcessor';
import { AACTree, AACPage, AACButton } from '../src/core/treeStructure';
const outPath = path.join(__dirname, 'out.opml');

describe('OpmlProcessor round-trip', () => {
  const opmlPath = path.join(__dirname, 'assets/opml/example.opml');
  afterAll(async () => {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  });
  it('round-trips OPML file without losing pages', async () => {
    const processor = new OpmlProcessor();
    const tree1 = await processor.loadIntoTree(opmlPath);
    await processor.saveFromTree(tree1, outPath);
    const tree2 = await processor.loadIntoTree(outPath);
    // Compare set of page names (labels)
    const filterArtificial = (arr: any[]) =>
      arr.filter((n: any) => n !== 'Super Root' && n !== 'Root').sort();
    const names1 = filterArtificial(Object.values(tree1.pages).map((p) => p.name));
    const names2 = filterArtificial(Object.values(tree2.pages).map((p) => p.name));
    expect(names2).toEqual(names1);
    // Compare root names
    if (tree2.rootId && tree1.rootId) {
      expect(tree2.getPage(tree2.rootId)?.name).toEqual(tree1.getPage(tree1.rootId)?.name);
    }
  });

  it('does not lose pages whose name sanitizes to a dangerous object key', async () => {
    const tree = new AACTree();
    tree.addPage(
      new AACPage({
        id: 'a',
        name: ': proto :',
        grid: [],
        buttons: [],
        parentId: null,
      })
    );
    const out = path.join(__dirname, 'out-proto.opml');
    const processor = new OpmlProcessor();
    await processor.saveFromTree(tree, out);
    try {
      const reloaded = await processor.loadIntoTree(out);
      expect(Object.keys(reloaded.pages)).toContain('___proto__');
      expect(Object.keys(reloaded.pages).length).toBeGreaterThan(0);
    } finally {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    }
  });

  it('creates navigation buttons whose targetPageId resolves for names with non-alphanumeric characters', async () => {
    const tree = new AACTree();
    const parent = new AACPage({
      id: 'parent',
      name: 'parent',
      grid: [],
      buttons: [],
      parentId: null,
    });
    parent.addButton(
      new AACButton({
        id: 'nav1',
        label: ': proto :',
        message: '',
        type: 'NAVIGATE',
        targetPageId: 'a',
      })
    );
    tree.addPage(parent);
    tree.addPage(
      new AACPage({ id: 'a', name: ': proto :', grid: [], buttons: [], parentId: 'parent' })
    );
    tree.rootId = 'parent';

    const out = path.join(__dirname, 'out-nav-resolve.opml');
    const processor = new OpmlProcessor();
    await processor.saveFromTree(tree, out);
    try {
      const reloaded = await processor.loadIntoTree(out);
      const reloadedParent = Object.values(reloaded.pages).find((p) => p.name === 'parent');
      expect(reloadedParent).toBeDefined();
      const navButton = reloadedParent?.buttons[0];
      expect(navButton?.targetPageId).toBe('___proto__');
      expect(reloaded.getPage(navButton!.targetPageId!)).toBeDefined();
    } finally {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    }
  });

  it('round-trips a NAVIGATE button targeting its own page (CI counterexample)', async () => {
    const tree = new AACTree();
    const home = new AACPage({
      id: 'a',
      name: ': proto :',
      grid: [],
      buttons: [],
      parentId: 'A',
    });
    const upper = new AACPage({ id: 'A', name: '!', grid: [], buttons: [], parentId: null });
    upper.addButton(
      new AACButton({ id: 'a', label: '!', message: '', type: 'NAVIGATE', targetPageId: 'A' })
    );
    tree.addPage(home);
    tree.addPage(upper);
    tree.rootId = 'a';

    const out = path.join(__dirname, 'out-counterexample.opml');
    const processor = new OpmlProcessor();
    await processor.saveFromTree(tree, out);
    try {
      const reloaded = await processor.loadIntoTree(out);
      expect(Object.keys(reloaded.pages).length).toBeGreaterThan(0);
    } finally {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    }
  });
});
