/** What a CLI command is, and how it reports an expected failure. */

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
