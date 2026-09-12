/**
 * P1.7 spike, kept as a regression test.
 *
 * `blendx review` shows each action's `calculate` as literal source plus the columns it
 * writes, derived from its return type (docs/decisions.md D5, D9). TS 7.0 has no
 * compiler API yet, so this uses @typescript/typescript6. It proves the extraction works
 * under Bun for the shapes that matter: object literal, spread, conditional, and a
 * method with several returns. `writes` is the union of keys across all return shapes.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import ts from '@typescript/typescript6';

type Extracted = { action: string; source: string; writes: string[] };

function extractCalculates(file: string): Extracted[] {
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`not in program: ${file}`);

  const signatureOf = (fn: ts.Node) =>
    ts.isFunctionLike(fn)
      ? checker.getSignatureFromDeclaration(fn)
      : checker.getSignaturesOfType(checker.getTypeAtLocation(fn), ts.SignatureKind.Call)[0];

  const writesOf = (fn: ts.Node) => {
    const signature = signatureOf(fn);
    if (!signature) return [];
    const returned = checker.getReturnTypeOfSignature(signature);
    const shapes = returned.isUnion() ? returned.types : [returned];
    const keys = shapes.flatMap((shape) => checker.getPropertiesOfType(shape).map((p) => p.name));
    return [...new Set(keys)].sort();
  };

  const found: Extracted[] = [];
  const visit = (node: ts.Node) => {
    const isCalculate =
      (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'calculate';
    if (isCalculate) {
      const fn = ts.isPropertyAssignment(node) ? node.initializer : node;
      const owner = node.parent.parent;
      const action =
        ts.isPropertyAssignment(owner) && ts.isIdentifier(owner.name) ? owner.name.text : '?';
      found.push({ action, source: fn.getText(source), writes: writesOf(fn) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const fixture = join(import.meta.dir, 'fixtures', 'p1-7-calculate.ts');

describe('P1.7 calculate source and writes via the TypeScript 6 API', () => {
  const started = performance.now();
  const extracted = extractCalculates(fixture);
  const elapsedMs = performance.now() - started;

  test('runs the TypeScript 6 compiler API under Bun', () => {
    expect(ts.version.startsWith('6.')).toBe(true);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  test('writes are the union of keys across every return shape', () => {
    expect(extracted.map(({ action, writes }) => ({ action, writes }))).toEqual([
      { action: 'store', writes: ['result'] },
      { action: 'update', writes: ['note', 'status', 'total'] },
      { action: 'pay', writes: ['paid_at', 'status'] },
      { action: 'refund', writes: ['note', 'status', 'total'] },
    ]);
  });

  test('source is the literal hook text', () => {
    expect(extracted[0]?.source).toBe(
      '({ input }: { input: { a: number; b: number } }) => ({\n        result: input.a + input.b,\n      })',
    );
    expect(extracted[3]?.source.startsWith('calculate({ record }: { record: Order }) {')).toBe(
      true,
    );
  });
});
