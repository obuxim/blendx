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

/** A direct inline hook as written in its app or blend module. */
export interface HookSource {
  source: string;
}

/** Custom authorize/save hooks grouped by cascade level, then blend file and action where needed. */
export interface StageHookSources {
  app: ReadonlyMap<string, HookSource>;
  resource: ReadonlyMap<string, ReadonlyMap<string, HookSource>>;
  action: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, HookSource>>>;
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

/** One program over the app and blend files: `blendx review` builds it once and reads every hook from it. */
export const reviewProgram = (files: readonly string[]): ts.Program =>
  ts.createProgram([...files], OPTIONS);

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

/** Only functions declared directly in the object can give a reviewer readable behavior. */
function inlineHookOf(spec: ts.Expression | undefined, name: string): ts.Node | undefined {
  const hook = hookOf(spec, name);
  return hook &&
    (ts.isArrowFunction(hook) || ts.isFunctionExpression(hook) || ts.isMethodDeclaration(hook))
    ? hook
    : undefined;
}

/** An object's `hooks` block, when it is written directly beside the blend or app definition. */
function hooksOf(spec: ts.Expression | undefined): ts.Expression | undefined {
  const hooks = hookOf(spec, 'hooks');
  return hooks && ts.isExpression(hooks) ? hooks : undefined;
}

/** The object argument of a direct `defineApp({...})` or `blend(model, {...})` call. */
function callSpec(node: ts.Node, name: string, index: number): ts.Expression | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== name
  ) {
    return undefined;
  }
  return node.arguments[index];
}

function directSources(
  spec: ts.Expression | undefined,
  names: readonly string[],
  source: ts.SourceFile,
): Map<string, HookSource> {
  const found = new Map<string, HookSource>();
  const hooks = hooksOf(spec);
  for (const name of names) {
    const hook = inlineHookOf(hooks, name);
    if (hook) found.set(name, { source: hook.getText(source) });
  }
  return found;
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
  program: ts.Program = reviewProgram(files),
): Map<string, Map<string, Map<string, CalculateSource>>> {
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

/**
 * Read direct custom pipeline hooks for review. A named, imported, or spread hook is deliberately
 * absent: the emitter retains its file and explains that the reviewer must read it there.
 */
export function extractStageHooks(
  appFile: string,
  blendFiles: readonly string[],
  names: readonly string[],
  program: ts.Program = reviewProgram([appFile, ...blendFiles]),
): StageHookSources {
  const app = program.getSourceFile(appFile);
  if (!app) throw new Error(`${appFile} is not in the review program`);

  const appHooks = new Map<string, HookSource>();
  const findApp = (node: ts.Node) => {
    const spec = callSpec(node, 'defineApp', 0);
    if (spec) {
      for (const [name, hook] of directSources(spec, names, app)) appHooks.set(name, hook);
    }
    ts.forEachChild(node, findApp);
  };
  findApp(app);

  const resource = new Map<string, ReadonlyMap<string, HookSource>>();
  const action = new Map<string, ReadonlyMap<string, ReadonlyMap<string, HookSource>>>();
  for (const file of blendFiles) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`${file} is not in the review program`);
    const resourceHooks = new Map<string, HookSource>();
    const actionHooks = new Map<string, ReadonlyMap<string, HookSource>>();
    const visit = (node: ts.Node) => {
      const spec = callSpec(node, 'blend', 1);
      if (spec) {
        for (const [name, hook] of directSources(spec, names, source))
          resourceHooks.set(name, hook);
      }
      const call = actionCall(node);
      if (call) {
        const found = new Map<string, HookSource>();
        for (const name of names) {
          const hook = inlineHookOf(call.spec, name);
          if (hook) found.set(name, { source: hook.getText(source) });
        }
        if (found.size > 0) actionHooks.set(call.action, found);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    resource.set(file, resourceHooks);
    action.set(file, actionHooks);
  }
  return { app: appHooks, resource, action };
}
