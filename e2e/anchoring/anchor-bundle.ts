import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/core/anchor.ts');

let cached: string | null = null;

/** The anchor module as a classic script exposing `window.PageAnchorAnchoring`, so it runs unchanged inside any browser engine. */
export function anchorBundle(): string {
  if (cached) return cached;
  const { outputText } = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  cached = `(() => { const exports = {}; const module = { exports }; ${outputText}\nwindow.PageAnchorAnchoring = module.exports; })();`;
  return cached;
}
