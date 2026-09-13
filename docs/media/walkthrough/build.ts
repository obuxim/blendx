/**
 * Builds the narrated walkthrough of the examples. It runs every command and request the
 * steps show against the real examples, reads their code excerpts, voices each narration
 * with Piper, and writes data.js and audio/<step>.mp3 for index.html:
 *
 *   PIPER=<piper binary> PIPER_VOICE=<en_US-ljspeech-medium.onnx> bun docs/media/walkthrough/build.ts
 *
 * Only steps whose narration changed are voiced again (audio/narration.json keeps a hash of
 * each). Without PIPER, the audio already there is kept, and a changed step has none. It
 * resets examples/expenses/.data, and needs ffmpeg and ffprobe.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { CHAPTERS, type Panel, SPOKEN, STEPS } from './script.ts';

const here = import.meta.dir;
const root = resolve(here, '..', '..', '..');
const addition = join(root, 'examples', 'addition');
const expenses = join(root, 'examples', 'expenses');

interface Exchange {
  method: string;
  path: string;
  /** Who sends it, for the reader: 'Ada', or 'no token'. */
  as?: string;
  body?: unknown;
  status: number;
  reply: unknown;
}

interface ShellEntry {
  command: string;
  output: string;
}

type Capture =
  | { kind: 'http'; app: string; exchanges: Exchange[] }
  | { kind: 'shell'; cwd: string; entries: ShellEntry[] };

const captures = new Map<string, Capture>();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Runs a command and keeps what it printed, both streams, without colour codes. */
function shell(cwd: string, command: string[], keep?: (line: string) => boolean): ShellEntry {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env.DATABASE_URL;
  const run = Bun.spawnSync(command, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const text = `${run.stdout.toString()}${run.stderr.toString()}`.replace(ANSI, '').trimEnd();
  const lines = text === '' ? [] : text.split('\n');
  return { command: command.join(' '), output: (keep ? lines.filter(keep) : lines).join('\n') };
}

interface Opened {
  close: () => Promise<void>;
  send: (
    method: string,
    path: string,
    options?: { as?: string; token?: string; body?: unknown },
  ) => Promise<Exchange>;
}

/** Serves an example in-process, on its committed migrations: the same app server.ts serves. */
async function open(app: string, databaseUrl?: string): Promise<Opened> {
  const { createDatabase, createServer } = await import('blendx');
  const appModule = (await import(join(app, 'src', 'app.ts'))).default;
  const { routes } = await import(join(app, 'src', 'generated', 'routes.gen.ts'));
  const database = await createDatabase({ database: { driver: 'pglite', url: databaseUrl } });
  await database.migrate(join(app, 'drizzle'));
  const server = createServer({ app: appModule, db: database.db, routes });
  return {
    close: () => database.close(),
    async send(method, path, options = {}) {
      const res = await server.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const text = await res.text();
      return {
        method,
        path,
        ...(options.as ? { as: options.as } : {}),
        ...(options.body === undefined ? {} : { body: options.body }),
        status: res.status,
        reply: text === '' ? null : JSON.parse(text),
      };
    },
  };
}

const http = (app: string, exchanges: Exchange[]): Capture => ({
  kind: 'http',
  app: relative(root, app),
  exchanges,
});

async function captureAddition() {
  // A fresh copy without its generated files, so generate writes every one of them.
  const copy = join(root, '.tmp', 'walkthrough', 'addition');
  rmSync(copy, { recursive: true, force: true });
  cpSync(addition, copy, {
    recursive: true,
    filter: (source) => !/(^|\/)(node_modules|\.data|generated)$/.test(relative(addition, source)),
  });
  captures.set('addition.generate', {
    kind: 'shell',
    cwd: 'examples/addition',
    entries: [shell(copy, ['bunx', 'blendx', 'generate'])],
  });
  rmSync(copy, { recursive: true, force: true });

  const app = await open(addition);
  const path = '/addition_results';
  captures.set(
    'addition.store',
    http(addition, [await app.send('POST', path, { body: { a: 4, b: 3 } })]),
  );
  captures.set(
    'addition.invalid',
    http(addition, [await app.send('POST', path, { body: { a: 4, b: 'three', c: 1 } })]),
  );
  captures.set(
    'addition.soft-delete',
    http(addition, [
      await app.send('DELETE', `${path}/1`),
      await app.send('GET', `${path}/1`),
      await app.send('POST', `${path}/1/restore`),
    ]),
  );
  await app.close();
}

async function captureExpenses() {
  // The data folder of blendx.config.ts, so that scripts/make-approver.ts sees the same rows.
  const data = join(expenses, '.data');
  rmSync(data, { recursive: true, force: true });
  let app = await open(expenses, data);

  const signUp = (name: string, extra: object = {}) =>
    app.send('POST', '/users', {
      as: 'no token',
      body: { email: `${name.toLowerCase()}@example.com`, name, ...extra },
    });
  const ada = await signUp('Ada');
  const bob = await signUp('Bob');
  const cy = await signUp('Cy');
  const eve = await signUp('Eve', { is_approver: true });
  captures.set('expenses.signup', http(expenses, [ada, eve]));
  const token = (exchange: Exchange) => (exchange.reply as { api_token: string }).api_token;
  const as = {
    Ada: { as: 'Ada', token: token(ada) },
    Bob: { as: 'Bob', token: token(bob) },
    Cy: { as: 'Cy', token: token(cy) },
  };
  const bobId = (bob.reply as { id: number }).id;

  const lunch = {
    description: 'Team lunch',
    category: 'meals',
    amount: '40.00',
    spent_on: '2026-09-01',
  };
  captures.set(
    'expenses.file',
    http(expenses, [
      await app.send('POST', '/expenses', { as: 'no token', body: lunch }),
      await app.send('POST', '/expenses', { ...as.Ada, body: lunch }),
    ]),
  );
  captures.set(
    'expenses.smuggle',
    http(expenses, [
      await app.send('POST', '/expenses', {
        ...as.Ada,
        body: { ...lunch, description: 'Taxi', category: 'travel', amount: 12.5, total: '1.00' },
      }),
    ]),
  );
  captures.set(
    'expenses.scope',
    http(expenses, [
      await app.send('GET', '/expenses/1', as.Bob),
      await app.send('GET', '/expenses', as.Ada),
      await app.send('GET', `/expenses?user_id=${bobId}`, as.Ada),
    ]),
  );
  captures.set(
    'expenses.draft',
    http(expenses, [
      await app.send('PATCH', '/expenses/1', { ...as.Ada, body: { amount: '50.00' } }),
    ]),
  );
  await app.close();

  // PGlite opens its folder from one process at a time, so the script runs while it is closed.
  captures.set('expenses.approver', {
    kind: 'shell',
    cwd: 'examples/expenses',
    entries: [shell(expenses, ['bun', 'scripts/make-approver.ts', 'cy@example.com'])],
  });

  app = await open(expenses, data);
  captures.set(
    'expenses.review',
    http(expenses, [
      await app.send('POST', '/expenses/1/submit', as.Ada),
      await app.send('PATCH', '/expenses/1', { ...as.Ada, body: { amount: '1.00' } }),
      await app.send('GET', '/expenses?status=submitted', as.Cy),
      await app.send('POST', '/expenses/1/approve', as.Cy),
      await app.send('POST', '/expenses/1/approve', as.Cy),
    ]),
  );
  captures.set(
    'expenses.quote',
    http(expenses, [
      await app.send('GET', '/expenses/quote?amount=10&category=office', as.Ada),
      await app.send('GET', '/expenses/quote?amount=10&category=food', as.Ada),
    ]),
  );
  await app.close();
  rmSync(data, { recursive: true, force: true });

  const summary = (line: string) => /^\s*\d+ (pass|fail)$|^Ran \d+ tests/.test(line);
  captures.set('expenses.checks', {
    kind: 'shell',
    cwd: 'examples/expenses',
    entries: [
      shell(expenses, ['bunx', 'blendx', 'generate', '--check']),
      shell(expenses, ['bunx', 'blendx', 'review', '--check']),
      shell(expenses, ['bunx', 'tsc', '--noEmit']),
      shell(expenses, ['bun', 'test'], summary),
    ],
  });
}

const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.dbml': 'dbml',
  '.yaml': 'yaml',
};

/** The lines of a file a step shows, and which of them it highlights. */
function excerpt(panel: Extract<Panel, { kind: 'file' }>) {
  const lines = readFileSync(join(root, panel.path), 'utf8').replace(/\n$/, '').split('\n');
  const fail = (what: string): never => {
    throw new Error(`${panel.path}: ${what}`);
  };
  const start = panel.from ? lines.findIndex((line) => line.includes(panel.from ?? '')) : 0;
  if (start < 0) fail(`no line contains ${JSON.stringify(panel.from)}`);
  let end = lines.length - 1;
  if (panel.until !== undefined || panel.untilIncludes !== undefined) {
    let seen = 0;
    end = -1;
    for (let at = start + 1; at < lines.length; at++) {
      const line = lines[at] ?? '';
      const found =
        panel.until !== undefined ? line === panel.until : line.includes(panel.untilIncludes ?? '');
      if (found && ++seen === (panel.nth ?? 1)) {
        end = at;
        break;
      }
    }
    if (end < 0) fail(`no end of the excerpt after ${JSON.stringify(panel.from)}`);
  }
  const shown = lines.slice(start, end + 1);
  const highlight = shown.flatMap((line, at) =>
    (panel.highlight ?? []).some((text) => line.includes(text)) ? [start + at + 1] : [],
  );
  return {
    kind: 'file' as const,
    path: panel.path,
    language: LANGUAGES[extname(panel.path)] ?? 'plaintext',
    start: start + 1,
    code: shown.join('\n'),
    highlight,
  };
}

const spoken = (text: string) =>
  SPOKEN.reduce((said, [pattern, replacement]) => said.replace(pattern, replacement), text);

function duration(file: string): number {
  const probe = Bun.spawnSync(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { stdout: 'pipe' },
  );
  return Math.round(Number(probe.stdout.toString().trim()) * 10) / 10;
}

/** Voices each step whose narration changed; returns each step's audio and its length. */
function voice(): Map<string, { audio: string; duration: number }> {
  const audioDir = join(here, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const manifestFile = join(audioDir, 'narration.json');
  const manifest: Record<string, string> = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : {};
  const piper = process.env.PIPER;
  const model = process.env.PIPER_VOICE;
  const scratch = join(root, '.tmp', 'walkthrough');
  mkdirSync(scratch, { recursive: true });

  const voiced = new Map<string, { audio: string; duration: number }>();
  for (const step of STEPS) {
    const said = spoken(step.narration);
    const hash = createHash('sha256').update(said).digest('hex').slice(0, 16);
    const file = join(audioDir, `${step.id}.mp3`);
    if (piper && model && (manifest[step.id] !== hash || !existsSync(file))) {
      const wav = join(scratch, `${step.id}.wav`);
      const speak = Bun.spawnSync([piper, '-m', model, '-f', wav, '--sentence-silence', '0.3'], {
        stdin: Buffer.from(said),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (speak.exitCode !== 0) throw new Error(`piper: ${speak.stderr.toString()}`);
      const encode = Bun.spawnSync(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', '40k', file],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      if (encode.exitCode !== 0) throw new Error(`ffmpeg: ${encode.stderr.toString()}`);
      manifest[step.id] = hash;
    }
    if (manifest[step.id] === hash && existsSync(file)) {
      voiced.set(step.id, { audio: `audio/${step.id}.mp3`, duration: duration(file) });
    }
  }

  const ids = new Set(STEPS.map((step) => step.id));
  for (const name of readdirSync(audioDir)) {
    if (name.endsWith('.mp3') && !ids.has(basename(name, '.mp3'))) rmSync(join(audioDir, name));
  }
  const kept = Object.fromEntries(
    Object.entries(manifest)
      .filter(([id]) => ids.has(id))
      .sort(),
  );
  writeFileSync(manifestFile, `${JSON.stringify(kept, null, 2)}\n`);
  return voiced;
}

await captureAddition();
await captureExpenses();
const voiced = voice();

const steps = STEPS.map((step) => {
  const panel =
    step.panel.kind === 'file'
      ? excerpt(step.panel)
      : (captures.get(step.panel.capture) ??
        (() => {
          throw new Error(`${step.id}: no capture named ${step.panel.capture}`);
        })());
  const audio = voiced.get(step.id);
  return {
    id: step.id,
    chapter: step.chapter,
    title: step.title,
    stages: step.stages,
    narration: step.narration,
    audio: audio?.audio ?? null,
    duration: audio?.duration ?? null,
    panel,
  };
});

const data = {
  captured: new Date().toISOString().slice(0, 10),
  voice: 'Piper, with the en_US LJSpeech voice (public domain)',
  chapters: CHAPTERS,
  steps,
};
writeFileSync(
  join(here, 'data.js'),
  `// Generated by build.ts from script.ts. Do not edit; run build.ts.\nwindow.WALKTHROUGH = ${JSON.stringify(data, null, 1)};\n`,
);
console.log(
  `wrote data.js: ${steps.length} steps, ${voiced.size} voiced, ${Math.round(
    [...voiced.values()].reduce((sum, { duration: seconds }) => sum + seconds, 0),
  )} seconds of narration`,
);
