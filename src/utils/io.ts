export type ProcessorInput = string | Buffer | ArrayBuffer | Uint8Array;

export type BinaryOutput = Buffer | Uint8Array;

export interface FileAdapter {
  readBinaryFromInput: (input: ProcessorInput) => Promise<Uint8Array>;
  readTextFromInput: (input: ProcessorInput, encoding?: BufferEncoding) => Promise<string>;
  writeBinaryToPath: (outputPath: string, data: BinaryOutput) => Promise<void>;
  writeTextToPath: (outputPath: string, text: string) => Promise<void>;
  pathExists: (path: string) => Promise<boolean>;
  isDirectory: (path: string) => Promise<boolean>;
  getFileSize: (path: string) => Promise<number>;
  mkDir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  listDir: (path: string) => Promise<string[]>;
  removePath: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  mkTempDir: (prefix: string) => Promise<string>;
  join: (...pathParts: string[]) => string;
  dirname: (path: string) => string;
  basename: (path: string, suffix?: string) => string;
}

let cachedFs: typeof import('node:fs') | null = null;
let cachedPath: typeof import('path') | null = null;
let cachedOs: typeof import('os') | null = null;
let cachedRequire: NodeRequire | null | undefined = undefined;

type NodeRequire = (id: string) => any;

export function getNodeRequire(): NodeRequire {
  if (cachedRequire === undefined) {
    if (typeof require === 'function') {
      cachedRequire = require;
    } else if (typeof globalThis !== 'undefined') {
      const maybeRequire = (globalThis as { require?: unknown }).require;
      cachedRequire = typeof maybeRequire === 'function' ? (maybeRequire as NodeRequire) : null;
    } else {
      cachedRequire = null;
    }
  }
  if (!cachedRequire) {
    throw new Error('File system access is not available in this environment.');
  }
  return cachedRequire;
}

function getFs(): typeof import('node:fs') {
  if (!cachedFs) {
    try {
      const nodeRequire = getNodeRequire();
      const fsModule = 'node:fs';
      cachedFs = nodeRequire(fsModule);
    } catch {
      throw new Error('File system access is not available in this environment.');
    }
  }
  if (!cachedFs) {
    throw new Error('File system access is not available in this environment.');
  }
  return cachedFs;
}

function getPath(): typeof import('path') {
  if (!cachedPath) {
    try {
      const nodeRequire = getNodeRequire();
      const pathModule = 'path';
      cachedPath = nodeRequire(pathModule);
    } catch {
      throw new Error('Path utilities are not available in this environment.');
    }
  }
  if (!cachedPath) {
    throw new Error('Path utilities are not available in this environment.');
  }
  return cachedPath;
}

export function getOs(): typeof import('os') {
  if (!cachedOs) {
    try {
      const nodeRequire = getNodeRequire();
      const osModule = 'os';
      cachedOs = nodeRequire(osModule);
    } catch {
      throw new Error('OS utilities are not available in this environment.');
    }
  }
  if (!cachedOs) {
    throw new Error('OS utilities are not available in this environment.');
  }
  return cachedOs;
}

export function isNodeRuntime(): boolean {
  const browserGlobals = globalThis as { window?: unknown };
  if (browserGlobals.window !== undefined) {
    return false;
  }
  return typeof process !== 'undefined' && !!process.versions?.node;
}

export function getBasename(filePath: string): string {
  const trimmed = filePath.replace(/[/\\]+$/, '') || filePath;
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

export function toUint8Array(input: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input);
}

export function toArrayBuffer(input: Uint8Array | ArrayBuffer | Buffer): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  const view = input instanceof Uint8Array ? input : new Uint8Array(input);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function decodeText(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return input.toString('utf8');
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(input);
}

export function encodeBase64(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return input.toString('base64');
  }
  // Browser fallback using btoa
  let binary = '';
  const len = input.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(input[i]);
  }
  return btoa(binary);
}

export function encodeText(text: string): BinaryOutput {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8');
  }
  return new TextEncoder().encode(text);
}

// extname algorithm from node:path
const splitDeviceRe = /^([a-zA-Z]:|[\\\/]{2}[^\\\/]+[\\\/]+[^\\\/]+)?([\\\/])?([\s\S]*?)$/; //eslint-disable-line
const splitTailRe = /^([\s\S]*?)((?:\.{1,2}|[^\\\/]+?|)(\.[^.\/\\]*|))(?:[\\\/]*)$/; //eslint-disable-line
export function extname(path: string): string {
  const tail = splitDeviceRe.exec(path)?.at(3) ?? '';
  return splitTailRe.exec(tail)?.at(3) ?? '';
}

async function readBinaryFromInput(input: ProcessorInput): Promise<Uint8Array> {
  if (typeof input === 'string') {
    return Promise.resolve(getFs().readFileSync(input));
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return Promise.resolve(input);
  }
  if (input instanceof ArrayBuffer) {
    return Promise.resolve(new Uint8Array(input));
  }
  return Promise.resolve(input);
}

async function readTextFromInput(
  input: ProcessorInput,
  encoding: BufferEncoding = 'utf8'
): Promise<string> {
  if (typeof input === 'string') {
    return Promise.resolve(getFs().readFileSync(input, encoding));
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return Promise.resolve(input.toString(encoding));
  }
  if (input instanceof ArrayBuffer) {
    return Promise.resolve(decodeText(new Uint8Array(input)));
  }
  return Promise.resolve(decodeText(input));
}

async function writeBinaryToPath(outputPath: string, data: BinaryOutput): Promise<void> {
  getFs().writeFileSync(outputPath, data);
  await Promise.resolve();
}

async function writeTextToPath(outputPath: string, text: string): Promise<void> {
  getFs().writeFileSync(outputPath, text, 'utf8');
  await Promise.resolve();
}

async function pathExists(path: string): Promise<boolean> {
  return Promise.resolve(getFs().existsSync(path));
}

async function isDirectory(path: string): Promise<boolean> {
  return Promise.resolve(getFs().statSync(path).isDirectory());
}

async function getFileSize(path: string): Promise<number> {
  return Promise.resolve(getFs().statSync(path).size);
}

async function mkDir(path: string, options?: { recursive?: boolean }): Promise<void> {
  getFs().mkdirSync(path, options);
  await Promise.resolve();
}

async function listDir(path: string): Promise<string[]> {
  return Promise.resolve(getFs().readdirSync(path));
}

async function removePath(
  path: string,
  options?: { recursive?: boolean; force?: boolean }
): Promise<void> {
  getFs().rmSync(path, options);
  await Promise.resolve();
}

async function mkTempDir(prefix: string): Promise<string> {
  const path = join(getOs().tmpdir(), prefix);
  return Promise.resolve(getFs().mkdtempSync(path));
}

function join(...pathParts: string[]): string {
  return getPath().join(...pathParts);
}

export function joinWin32(...pathParts: string[]): string {
  return getPath().win32.join(...pathParts);
}

function dirname(path: string): string {
  return getPath().dirname(path);
}

function basename(path: string, suffix?: string): string {
  return getPath().basename(path, suffix);
}

export const defaultFileAdapter: FileAdapter = {
  readBinaryFromInput,
  readTextFromInput,
  writeBinaryToPath,
  writeTextToPath,
  pathExists,
  isDirectory,
  getFileSize,
  mkDir,
  listDir,
  removePath,
  mkTempDir,
  join,
  dirname,
  basename,
};
