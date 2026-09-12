import type { SourceLocation } from './ir.ts';

export interface DbmlDiagnostic extends SourceLocation {
  message: string;
}

/** Every problem found in schema.dbml, each with its line and column. */
export class DbmlError extends Error {
  readonly filename: string;
  readonly diagnostics: DbmlDiagnostic[];

  constructor(filename: string, diagnostics: DbmlDiagnostic[]) {
    super(diagnostics.map((d) => `${filename}:${d.line}:${d.column} ${d.message}`).join('\n'));
    this.name = 'DbmlError';
    this.filename = filename;
    this.diagnostics = diagnostics;
  }
}
