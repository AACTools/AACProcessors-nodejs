import { isNodeRuntime } from '../../src/utils/io';

describe('isNodeRuntime', () => {
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('returns true in a plain Node environment', () => {
    expect(isNodeRuntime()).toBe(true);
  });

  it('returns false when browser globals are present even if process is shimmed', () => {
    (globalThis as any).window = {};
    (globalThis as any).document = {};
    expect(isNodeRuntime()).toBe(false);
  });
});
