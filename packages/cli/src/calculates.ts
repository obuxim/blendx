/**
 * calculate's source and the keys it returns, read with the TypeScript 6 compiler API
 * (docs/decisions.md D5: TS 7 has no programmatic API yet). `blendx review` shows them next
 * to each action (P10.2). One program covers every blend file, so imported types resolve
 * as the app's own tsc sees them, and a spread like `...prev` yields its real keys.
 */
import ts from '@typescript/typescript6';

export interface CalculateSource {
  /** The hook as written. */
  source: string;
  /** Keys of every object calculate can return, sorted: the columns it writes. */
  keys: string[];
}

const BUILTINS: ReadonlySet<string> = new Set([
  'index',
  'show',
  'store',
  'update',
  'replace',
  'destroy',
  'restore',
  'purge',
]);

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

/** The action a builder call declares, with its spec: `a.store({...})`, `a.member('pay', {...})`. */
function actionCall(
  node: ts.Node,
): { action: string; spec: ts.Expression | undefined } | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const method = node.expression.name.text;
  const [first, second] = node.arguments;
  if (BUILTINS.has(method)) return { action: method, spec: first };
  if ((method === 'member' || method === 'collection') && first && ts.isStringLiteral(first)) {
    return { action: first.text, spec: second };
  }
  return undefined;
}

/** A hook of a spec object, by name: a property holding a function, or a method. */
function hookOf(spec: ts.Expression | undefined, name: string): ts.Node | undefined {
  if (!spec || !ts.isObjectLiteralExpression(spec)) return undefined;
  for (const property of spec.properties) {
    const named = property.name && ts.isIdentifier(property.name) && property.name.text;
    if (named !== name) continue;
    if (ts.isMethodDeclaration(property)) return property;
    if (ts.isPropertyAssignment(property)) return property.initializer;
  }
  return undefined;
}

function keysOf(checker: ts.TypeChecker, fn: ts.Node): string[] {
  const signature = ts.isFunctionLike(fn)
    ? checker.getSignatureFromDeclaration(fn)
    : checker.getSignaturesOfType(checker.getTypeAtLocation(fn), ts.SignatureKind.Call)[0];
  if (!signature) return [];
  const returned = checker.getReturnTypeOfSignature(signature);
  const shapes = returned.isUnion() ? returned.types : [returned];
  const keys = shapes.flatMap((shape) => checker.getPropertiesOfType(shape).map((p) => p.name));
  return [...new Set(keys)].sort();
}

/**
 * For each blend file, the named hooks of its actions, such as calculate and an index's
 * scope (D22): by file, then hook name, then action. One program reads them all.
 */
export function extractHooks(
  files: readonly string[],
  names: readonly string[],
): Map<string, Map<string, Map<string, CalculateSource>>> {
  const program = ts.createProgram([...files], OPTIONS);
  const checker = program.getTypeChecker();
  const byFile = new Map<string, Map<string, Map<string, CalculateSource>>>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`${file} is not in the review program`);
    const byHook = new Map(names.map((name) => [name, new Map<string, CalculateSource>()]));
    const visit = (node: ts.Node) => {
      const call = actionCall(node);
      for (const [name, found] of byHook) {
        const hook = call && hookOf(call.spec, name);
        if (call && hook) {
          found.set(call.action, { source: hook.getText(source), keys: keysOf(checker, hook) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    byFile.set(file, byHook);
  }
  return byFile;
}

/** For each blend file, its actions' calculate hooks by action name. */
export function extractCalculates(
  files: readonly string[],
): Map<string, Map<string, CalculateSource>> {
  const hooks = extractHooks(files, ['calculate']);
  return new Map([...hooks].map(([file, byHook]) => [file, byHook.get('calculate') ?? new Map()]));
}
