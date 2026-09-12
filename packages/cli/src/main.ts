/**
 * The blendx CLI shell. It parses argv with util.parseArgs, prints help, runs a command and
 * maps the outcome to an exit code: 0 ok, 1 failed, 2 usage error. Commands join COMMANDS
 * as their todo items land (generate, review, migrate).
 */
import { resolve } from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { BlendxConfigError, BlendxDefinitionError } from '@blendx/core';
import pkg from '../package.json' with { type: 'json' };

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** The folder that --cwd resolves against. */
  cwd: string;
}

export interface CommandOption {
  type: 'boolean' | 'string';
  short?: string;
  /** Shown as `--name <placeholder>` for string options. Defaults to "value". */
  placeholder?: string;
  description: string;
}

export interface CommandContext {
  /** The command's own options; --cwd and --help are handled by the shell. */
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
  /** The app folder: --cwd resolved against the current folder. */
  cwd: string;
  io: Io;
}

export interface Command {
  name: string;
  /** One line for the command list. */
  summary: string;
  options?: Record<string, CommandOption>;
  /** Resolves to the exit code. Throw CliError for an expected failure. */
  run(context: CommandContext): Promise<number>;
}

/** An expected failure: the message is printed without a stack, and it picks the exit code. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** The commands `blendx` ships. */
export const COMMANDS: readonly Command[] = [];

/** Options every command accepts. */
const COMMON: Record<string, CommandOption> = {
  cwd: { type: 'string', placeholder: 'dir', description: 'Run in this app folder' },
  help: { type: 'boolean', short: 'h', description: 'Show help' },
};

/** Options without a command. */
const TOP: Record<string, CommandOption> = {
  help: { type: 'boolean', short: 'h', description: 'Show help' },
  version: { type: 'boolean', short: 'v', description: 'Show the version' },
};

const processIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  cwd: process.cwd(),
};

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, text]) => `  ${label.padEnd(width)}  ${text}`);
}

function optionRows(options: Record<string, CommandOption>): string[] {
  return table(
    Object.entries(options).map(([name, option]) => {
      const flag = `${option.short ? `-${option.short}, ` : '    '}--${name}`;
      const value = option.type === 'string' ? ` <${option.placeholder ?? 'value'}>` : '';
      return [`${flag}${value}`, option.description] as const;
    }),
  );
}

function topHelp(commands: readonly Command[]): string {
  const lines = [`blendx ${pkg.version}: an API derived from schema.dbml and blends/`, ''];
  lines.push('Usage: blendx <command> [options]');
  if (commands.length > 0) {
    lines.push('', 'Commands:', ...table(commands.map((c) => [c.name, c.summary] as const)));
  }
  lines.push('', 'Options:', ...optionRows(TOP));
  lines.push('', 'Every command accepts:', ...optionRows(COMMON));
  return `${lines.join('\n')}\n`;
}

function commandHelp(command: Command): string {
  const lines = [`Usage: blendx ${command.name} [options]`, '', command.summary, ''];
  lines.push('Options:', ...optionRows({ ...command.options, ...COMMON }));
  return `${lines.join('\n')}\n`;
}

function parseConfig(options: Record<string, CommandOption>): ParseArgsConfig['options'] {
  return Object.fromEntries(
    Object.entries(options).map(([name, { type, short }]) => [
      name,
      short === undefined ? { type } : { type, short },
    ]),
  );
}

const isParseError = (error: unknown) =>
  error instanceof Error && String((error as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS');

function usageError(io: Io, error: unknown, help: string): number {
  if (!isParseError(error)) throw error;
  io.err(`blendx: ${(error as Error).message}\nRun \`${help}\` for usage.\n`);
  return 2;
}

function failure(io: Io, error: unknown): number {
  if (error instanceof CliError) {
    io.err(`${error.message}\n`);
    return error.exitCode;
  }
  if (error instanceof BlendxConfigError || error instanceof BlendxDefinitionError) {
    io.err(`${error.message}\n`);
    return 1;
  }
  io.err(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  return 1;
}

/** Runs the CLI and resolves to the exit code. */
export async function main(
  argv: readonly string[],
  { commands = COMMANDS, io = processIo }: { commands?: readonly Command[]; io?: Io } = {},
): Promise<number> {
  const [name, ...rest] = argv;

  if (name === undefined || name.startsWith('-')) {
    let values: { help?: boolean | undefined; version?: boolean | undefined };
    try {
      ({ values } = parseArgs({ args: [...argv], options: parseConfig(TOP), strict: true }) as {
        values: typeof values;
      });
    } catch (error) {
      return usageError(io, error, 'blendx --help');
    }
    if (values.version) {
      io.out(`blendx ${pkg.version}\n`);
      return 0;
    }
    if (values.help) {
      io.out(topHelp(commands));
      return 0;
    }
    io.err(topHelp(commands));
    return 2;
  }

  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    io.err(`blendx: unknown command "${name}". Run \`blendx --help\` for the list.\n`);
    return 2;
  }

  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      options: parseConfig({ ...command.options, ...COMMON }),
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    return usageError(io, error, `blendx ${command.name} --help`);
  }

  const { help, cwd, ...values } = parsed.values;
  if (help) {
    io.out(commandHelp(command));
    return 0;
  }

  try {
    return await command.run({
      values: values as CommandContext['values'],
      positionals: parsed.positionals,
      cwd: resolve(io.cwd, typeof cwd === 'string' ? cwd : '.'),
      io,
    });
  } catch (error) {
    return failure(io, error);
  }
}
