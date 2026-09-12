/**
 * P7.3: the CLI shell. main() parses argv with util.parseArgs, prints help, runs a command
 * and turns the outcome into an exit code: 0 ok, 1 failed, 2 usage error.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BlendxConfigError } from '@blendx/core';
import { CliError, type Command, main } from '../src/main.ts';

const calls: { values: Record<string, unknown>; positionals: string[]; cwd: string }[] = [];

const greet: Command = {
  name: 'greet',
  summary: 'Say hello',
  options: {
    loud: { type: 'boolean', description: 'Shout' },
    name: { type: 'string', placeholder: 'who', description: 'Who to greet' },
  },
  async run({ values, positionals, cwd, io }) {
    calls.push({ values, positionals, cwd });
    io.out(values.loud ? 'HELLO\n' : 'hello\n');
    return 0;
  },
};

const commands: Command[] = [
  greet,
  {
    name: 'invalid',
    summary: 'Fails on a bad config',
    async run() {
      throw new BlendxConfigError('config.schema must be a non-empty path');
    },
  },
  {
    name: 'drift',
    summary: 'Fails with its own exit code',
    async run() {
      throw new CliError('src/generated is out of date', 1);
    },
  },
  {
    name: 'crash',
    summary: 'Hits a bug',
    async run() {
      throw new Error('boom');
    },
  },
];

async function cli(...argv: string[]) {
  let out = '';
  let err = '';
  const io = {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd: '/app',
  };
  const code = await main(argv, { commands, io });
  return { code, out, err };
}

describe('help and version', () => {
  test('--help lists the commands and global options on stdout', async () => {
    for (const flag of ['--help', '-h']) {
      const { code, out, err } = await cli(flag);
      expect(code).toBe(0);
      expect(err).toBe('');
      expect(out).toContain('Usage: blendx <command> [options]');
      expect(out).toMatch(/greet +Say hello/);
      expect(out).toMatch(/--cwd <dir> +/);
    }
  });

  test('no command: help on stderr, usage error', async () => {
    const { code, out, err } = await cli();
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toContain('Usage: blendx <command> [options]');
  });

  test('--version prints the CLI version', async () => {
    const { code, out } = await cli('--version');
    expect(code).toBe(0);
    expect(out).toMatch(/^blendx \d+\.\d+\.\d+\n$/);
  });

  test('<command> --help shows its options', async () => {
    const { code, out } = await cli('greet', '--help');
    expect(code).toBe(0);
    expect(out).toContain('Usage: blendx greet [options]');
    expect(out).toMatch(/--loud +Shout/);
    expect(out).toMatch(/--name <who> +Who to greet/);
    expect(calls).toHaveLength(0);
  });
});

describe('running a command', () => {
  test('options and positionals reach the command; cwd defaults to the current folder', async () => {
    const { code, out } = await cli('greet', '--loud', '--name', 'Ada', 'extra');
    expect(code).toBe(0);
    expect(out).toBe('HELLO\n');
    expect(calls.at(-1)).toEqual({
      values: { loud: true, name: 'Ada' },
      positionals: ['extra'],
      cwd: '/app',
    });
  });

  test('--cwd resolves against the current folder', async () => {
    await cli('greet', '--cwd', 'examples/addition');
    expect(calls.at(-1)?.cwd).toBe(join('/app', 'examples/addition'));
  });
});

describe('exit codes', () => {
  test('an unknown command is a usage error', async () => {
    const { code, err } = await cli('nope');
    expect(code).toBe(2);
    expect(err).toContain('unknown command "nope"');
    expect(err).toContain('blendx --help');
  });

  test('an unknown option is a usage error that points at the command help', async () => {
    const { code, err } = await cli('greet', '--nope');
    expect(code).toBe(2);
    expect(err).toContain('--nope');
    expect(err).toContain('blendx greet --help');
  });

  test('a config or definition error prints its message only and exits 1', async () => {
    const { code, err } = await cli('invalid');
    expect(code).toBe(1);
    expect(err).toBe('config.schema must be a non-empty path\n');
  });

  test('CliError chooses the exit code', async () => {
    const { code, err } = await cli('drift');
    expect(code).toBe(1);
    expect(err).toBe('src/generated is out of date\n');
  });

  test('an unexpected error prints the stack and exits 1', async () => {
    const { code, err } = await cli('crash');
    expect(code).toBe(1);
    expect(err).toContain('Error: boom');
    expect(err).toContain('main.test.ts');
  });
});

describe('bin', () => {
  const bin = join(import.meta.dir, '..', 'src', 'bin.ts');

  test('blendx --help exits 0', () => {
    const run = Bun.spawnSync([process.execPath, bin, '--help']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain('Usage: blendx <command> [options]');
  });

  test('blendx with an unknown command exits 2', () => {
    const run = Bun.spawnSync([process.execPath, bin, 'nope']);
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain('unknown command "nope"');
  });
});
