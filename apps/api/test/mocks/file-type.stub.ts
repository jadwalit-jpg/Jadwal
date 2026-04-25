/**
 * CJS stub used only by Jest.
 *
 * The real `file-type` package is ESM-only and Jest's resolver (without
 * extra ESM transform config) can't load the `"import"`-only export map.
 * Tests that care about file-type always call `jest.mock('file-type', ...)`
 * to replace its behaviour, so the real module is never executed — we just
 * need SOMETHING resolvable at `file-type` that satisfies the compiler and
 * passes through the jest.mock replacement.
 *
 * Keep the exported names in lock-step with the real v18+ API so the
 * production TypeScript `import { fileTypeFromBuffer } from 'file-type'`
 * typechecks cleanly under ts-jest.
 */

export async function fileTypeFromBuffer(_buf: Buffer | Uint8Array): Promise<undefined | { mime: string; ext: string }> {
  return undefined;
}
export async function fileTypeFromFile(_path: string): Promise<undefined | { mime: string; ext: string }> {
  return undefined;
}
export async function fileTypeFromStream(_stream: NodeJS.ReadableStream): Promise<undefined | { mime: string; ext: string }> {
  return undefined;
}
