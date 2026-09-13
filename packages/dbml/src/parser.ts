/**
 * blendx's DBML parser (D21). It reads the part of DBML that schema.dbml may use
 * (packages/spec/dbml.md) into a small document; parse.ts resolves its names and builds the
 * schema IR. A syntax error throws DbmlSyntaxError with the line and column of the token
 * that broke it.
 */
import type { SourceLocation } from './ir.ts';

export type Relation = '>' | '<' | '-' | '<>';

export interface DbmlDefault {
  kind: 'number' | 'string' | 'boolean' | 'expression' | 'null';
  value: string;
}

export interface DbmlField {
  name: string;
  /** The type as written, arguments and array brackets included: `numeric(10,2)`, `text[]`. */
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
  default?: DbmlDefault;
  note?: string;
  loc: SourceLocation;
}

export interface DbmlIndex {
  columns: { kind: 'column' | 'expression'; value: string; loc: SourceLocation }[];
  pk: boolean;
  unique: boolean;
  name?: string;
  loc: SourceLocation;
}

export interface DbmlTable {
  schema?: string;
  name: string;
  alias?: string;
  note?: string;
  fields: DbmlField[];
  indexes: DbmlIndex[];
  loc: SourceLocation;
}

export interface DbmlEnum {
  schema?: string;
  name: string;
  values: { name: string; loc: SourceLocation }[];
  loc: SourceLocation;
}

export interface DbmlEndpoint {
  schema?: string;
  table: string;
  columns: string[];
  /** Where the table name, then each column name, was written. */
  tableLoc: SourceLocation;
  columnLocs: SourceLocation[];
}

export interface DbmlRef {
  from: DbmlEndpoint;
  relation: Relation;
  to: DbmlEndpoint;
  onDelete?: string;
  onUpdate?: string;
  loc: SourceLocation;
}

export interface DbmlDocument {
  tables: DbmlTable[];
  enums: DbmlEnum[];
  /** Inline and standalone refs, in the order they were written. */
  refs: DbmlRef[];
}

export class DbmlSyntaxError extends Error {
  readonly loc: SourceLocation;

  constructor(message: string, loc: SourceLocation) {
    super(message);
    this.name = 'DbmlSyntaxError';
    this.loc = loc;
  }
}

/** Parses DBML source. Throws DbmlSyntaxError at the first syntax error. */
export function parseDocument(source: string): DbmlDocument {
  return new Parser(tokenize(source)).document();
}

type TokenKind = 'word' | 'quoted' | 'string' | 'expression' | 'number' | 'color' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
  loc: SourceLocation;
  /** Source offsets of the token's first character and of the character after it. */
  start: number;
  end: number;
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /[0-9]+(?:\.[0-9]+)?/y;
const COLOR = /#[0-9A-Fa-f]+/y;
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ',', ':', '.', '>', '<', '-']);
/** Upstream DBML's escapes (`@dbml/parse`, `escapedString`), besides `\uHHHH` and `\ `. */
const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  0: '\0',
  b: '\b',
  v: '\v',
  f: '\f',
};

function matchAt(pattern: RegExp, source: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(source)?.[0];
}

/** A '''...''' string, without its first and last line breaks or their common indentation. */
function dedent(raw: string): string {
  const lines = raw
    .replace(/^[ \t]*\r?\n/, '')
    .replace(/\r?\n[ \t]*$/, '')
    .split(/\r?\n/);
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent)).join('\n');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const here = (): SourceLocation => ({ line, column: i - lineStart + 1 });
  /** Moves to `end`, counting the line breaks passed. */
  const moveTo = (end: number) => {
    for (; i < end; i += 1) {
      if (source[i] === '\n') {
        line += 1;
        lineStart = i + 1;
      }
    }
  };
  /** The escape at `i`, a backslash: `\ ` keeps it, and before any other character it is dropped. */
  const escaped = (): string => {
    const next = source[i + 1] ?? '';
    if (next === 'u') {
      const hex = source.slice(i + 2, i + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
        throw new DbmlSyntaxError('"\\u" needs four hex digits', here());
      }
      i += 6;
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    i += 2;
    return next === ' ' ? '\\ ' : (ESCAPES[next] ?? next);
  };
  /** A '...' string or a "..." name: on one line, with backslash escapes. */
  const quoted = (quote: string, what: string): string => {
    const loc = here();
    let text = '';
    i += 1;
    for (;;) {
      const c = source[i];
      if (c === undefined || c === '\n') throw new DbmlSyntaxError(`unterminated ${what}`, loc);
      if (c === quote) {
        i += 1;
        return text;
      }
      const next = source[i + 1];
      if (c === '\\' && next !== undefined && next !== '\n') {
        text += escaped();
      } else {
        text += c;
        i += 1;
      }
    }
  };
  /** A '''...''' string: it may span lines, takes the escapes of a '...' string, and a `\` at the end of a line joins the next. */
  const block = (): string => {
    const loc = here();
    let text = '';
    i += 3;
    for (;;) {
      if (i >= source.length) throw new DbmlSyntaxError('unterminated string', loc);
      if (source.startsWith("'''", i)) {
        i += 3;
        return dedent(text);
      }
      const c = source[i] ?? '';
      const next = source[i + 1];
      if (c === '\\' && source.startsWith('\n', i + 1)) moveTo(i + 2);
      else if (c === '\\' && source.startsWith('\r\n', i + 1)) moveTo(i + 3);
      else if (c === '\\' && next !== undefined) text += escaped();
      else {
        text += c;
        moveTo(i + 1);
      }
    }
  };
  /** Everything between `open` and `close`, which may span lines. */
  const between = (open: string, close: string, what: string): string => {
    const loc = here();
    const end = source.indexOf(close, i + open.length);
    if (end < 0) throw new DbmlSyntaxError(`unterminated ${what}`, loc);
    const text = source.slice(i + open.length, end);
    moveTo(end + close.length);
    return text;
  };

  while (i < source.length) {
    const c = source[i] ?? '';
    const loc = here();
    const start = i;
    /** Called once `i` is past the token. */
    const push = (kind: TokenKind, text: string) => tokens.push({ kind, text, loc, start, end: i });
    if (c === '\n') {
      moveTo(i + 1);
    } else if (/\s/.test(c)) {
      i += 1;
    } else if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      between('/*', '*/', 'comment');
    } else if (source.startsWith("'''", i)) {
      push('string', block());
    } else if (c === "'") {
      push('string', quoted("'", 'string'));
    } else if (c === '"') {
      push('quoted', quoted('"', 'name'));
    } else if (c === '`') {
      push('expression', between('`', '`', 'expression'));
    } else if (source.startsWith('<>', i)) {
      i += 2;
      push('punct', '<>');
    } else {
      const [kind, text] = ((): [TokenKind, string | undefined] => {
        const word = matchAt(WORD, source, i);
        if (word) return ['word', word];
        const number = matchAt(NUMBER, source, i);
        if (number) return ['number', number];
        if (c === '#') return ['color', matchAt(COLOR, source, i)];
        return ['punct', PUNCTUATION.has(c) ? c : undefined];
      })();
      if (text === undefined) throw new DbmlSyntaxError(`unexpected character "${c}"`, loc);
      i += text.length;
      push(kind, text);
    }
  }
  tokens.push({ kind: 'eof', text: '', loc: here(), start: i, end: i });
  return tokens;
}

type Value =
  | {
      kind: 'string' | 'expression' | 'number' | 'color' | 'words';
      text: string;
      loc: SourceLocation;
    }
  | { kind: 'ref'; relation: Relation; endpoint: DbmlEndpoint; loc: SourceLocation };

interface Setting {
  /** Lowercase, words joined by one space: `not null`, `primary key`. */
  key: string;
  value?: Value;
  loc: SourceLocation;
}

const shown = (token: Token): string => {
  switch (token.kind) {
    case 'eof':
      return 'the end of the file';
    case 'string':
      return 'a string';
    case 'expression':
      return 'an expression';
    default:
      return `"${token.text}"`;
  }
};

function flag(setting: Setting, where: string) {
  if (setting.value) {
    throw new DbmlSyntaxError(
      `${where} setting "${setting.key}" takes no value`,
      setting.value.loc,
    );
  }
}

function stringOf(setting: Setting): string {
  const value = setting.value;
  if (value?.kind !== 'string') {
    throw new DbmlSyntaxError(`${setting.key} needs a string`, value?.loc ?? setting.loc);
  }
  return value.text;
}

function defaultOf(setting: Setting): DbmlDefault {
  const value = setting.value;
  const invalid = () =>
    new DbmlSyntaxError(
      'default needs a number, a string, an expression, true, false or null',
      value?.loc ?? setting.loc,
    );
  if (!value || value.kind === 'ref' || value.kind === 'color') throw invalid();
  if (value.kind !== 'words') return { kind: value.kind, value: value.text };
  const word = value.text.toLowerCase();
  if (word === 'true' || word === 'false') return { kind: 'boolean', value: word };
  if (word === 'null') return { kind: 'null', value: word };
  throw invalid();
}

class Parser {
  private at = 0;
  private readonly doc: DbmlDocument = { tables: [], enums: [], refs: [] };
  private readonly tokens: Token[];
  private readonly eof: Token;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.eof = tokens[tokens.length - 1] ?? {
      kind: 'eof',
      text: '',
      loc: { line: 1, column: 1 },
      start: 0,
      end: 0,
    };
  }

  document(): DbmlDocument {
    while (this.peek().kind !== 'eof') {
      const token = this.peek();
      const keyword = token.kind === 'word' ? token.text.toLowerCase() : '';
      if (keyword === 'table') this.table();
      else if (keyword === 'enum') this.enumBlock();
      else if (keyword === 'ref') this.refDefinition();
      else if (keyword === 'project' || keyword === 'tablegroup' || keyword === 'note') {
        this.skipBlock();
      } else this.fail('Table, Enum, Ref, Project, TableGroup or Note');
    }
    return this.doc;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.at + offset] ?? this.eof;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'eof') this.at += 1;
    return token;
  }

  private isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'punct' && token.text === text;
  }

  private isWord(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'word' && token.text.toLowerCase() === word;
  }

  private isName(offset = 0): boolean {
    const kind = this.peek(offset).kind;
    return kind === 'word' || kind === 'quoted';
  }

  /** Whether the token at `offset` starts where the one before it ends, with no space between. */
  private touches(offset = 0): boolean {
    return this.peek(offset).start === this.peek(offset - 1).end;
  }

  private fail(expected: string): never {
    const token = this.peek();
    throw new DbmlSyntaxError(`expected ${expected} but found ${shown(token)}`, token.loc);
  }

  private expectPunct(text: string, expected = `"${text}"`): Token {
    if (!this.isPunct(text)) this.fail(expected);
    return this.next();
  }

  private name(expected: string): { text: string; loc: SourceLocation } {
    if (!this.isName()) this.fail(expected);
    const token = this.next();
    return { text: token.text, loc: token.loc };
  }

  private string(expected: string): string {
    if (this.peek().kind !== 'string') this.fail(expected);
    return this.next().text;
  }

  /** `name` or `schema.name`. */
  private qualifiedName(expected: string): { schema?: string; name: string } {
    const first = this.name(expected);
    if (!this.isPunct('.')) return { name: first.text };
    this.next();
    return { schema: first.text, name: this.name(expected).text };
  }

  /** Project, TableGroup and sticky notes carry nothing blendx reads: skip the block. */
  private skipBlock() {
    this.next();
    while (!this.isPunct('{')) {
      if (this.peek().kind === 'eof') this.fail('"{"');
      this.next();
    }
    let depth = 0;
    do {
      if (this.peek().kind === 'eof') this.fail('"}"');
      const token = this.next();
      if (token.kind === 'punct' && token.text === '{') depth += 1;
      if (token.kind === 'punct' && token.text === '}') depth -= 1;
    } while (depth > 0);
  }

  private settings(): Setting[] {
    this.expectPunct('[');
    const settings: Setting[] = [];
    for (;;) {
      const first = this.peek();
      if (first.kind !== 'word') this.fail('a setting');
      const words: string[] = [];
      while (this.peek().kind === 'word') words.push(this.next().text.toLowerCase());
      const setting: Setting = { key: words.join(' '), loc: first.loc };
      if (this.isPunct(':')) {
        this.next();
        setting.value = setting.key === 'ref' ? this.refValue() : this.value();
      }
      settings.push(setting);
      if (this.isPunct(']')) {
        this.next();
        return settings;
      }
      this.expectPunct(',', '"," or "]"');
    }
  }

  private value(): Value {
    const token = this.peek();
    switch (token.kind) {
      case 'string':
      case 'expression':
      case 'number':
      case 'color':
        this.next();
        return { kind: token.kind, text: token.text, loc: token.loc };
      case 'word': {
        const words: string[] = [];
        while (this.peek().kind === 'word') words.push(this.next().text);
        return { kind: 'words', text: words.join(' '), loc: token.loc };
      }
    }
    if (this.isPunct('-') && this.peek(1).kind === 'number') {
      this.next();
      return { kind: 'number', text: `-${this.next().text}`, loc: token.loc };
    }
    this.fail('a value');
  }

  private relation(): Relation {
    const token = this.peek();
    if (token.kind === 'punct' && ['>', '<', '-', '<>'].includes(token.text)) {
      this.next();
      return token.text as Relation;
    }
    this.fail('>, <, - or <>');
  }

  private refValue(): Value {
    const loc = this.peek().loc;
    const relation = this.relation();
    return { kind: 'ref', relation, endpoint: this.endpoint(), loc };
  }

  /** `table.column`, `table.(a, b)`, either one after `schema.`. */
  private endpoint(): DbmlEndpoint {
    const parts = [this.name('a table name')];
    let columns: { text: string; loc: SourceLocation }[] = [];
    while (this.isPunct('.') && columns.length === 0) {
      this.next();
      if (this.isPunct('(')) {
        this.next();
        columns.push(this.name('a column name'));
        while (this.isPunct(',')) {
          this.next();
          columns.push(this.name('a column name'));
        }
        this.expectPunct(')', '"," or ")"');
      } else {
        parts.push(this.name('a column name'));
      }
    }
    if (columns.length === 0) {
      const column = parts.length > 1 ? parts.pop() : undefined;
      if (!column) this.fail('"." and a column name');
      columns = [column];
    }
    const [schema, table] = parts.length === 2 ? parts : [undefined, parts[0]];
    if (!table || parts.length > 2) {
      throw new DbmlSyntaxError(
        'a ref names [schema.]table.column',
        parts[0]?.loc ?? this.peek().loc,
      );
    }
    return {
      ...(schema ? { schema: schema.text } : {}),
      table: table.text,
      columns: columns.map((c) => c.text),
      tableLoc: table.loc,
      columnLocs: columns.map((c) => c.loc),
    };
  }

  private table() {
    const keyword = this.next();
    const { schema, name } = this.qualifiedName('a table name');
    const table: DbmlTable = {
      ...(schema ? { schema } : {}),
      name,
      fields: [],
      indexes: [],
      loc: keyword.loc,
    };
    if (this.isWord('as')) {
      this.next();
      table.alias = this.name('an alias').text;
    }
    if (this.isPunct('[')) {
      for (const setting of this.settings()) {
        if (setting.key === 'note') table.note = stringOf(setting);
        else if (setting.key !== 'headercolor') {
          throw new DbmlSyntaxError(`unknown table setting "${setting.key}"`, setting.loc);
        }
      }
    }
    this.expectPunct('{');
    while (!this.isPunct('}')) {
      if (this.isWord('indexes') && this.isPunct('{', 1)) this.indexes(table);
      else if (this.isWord('note') && (this.isPunct(':', 1) || this.isPunct('{', 1))) {
        table.note = this.noteBody();
      } else table.fields.push(this.field(table));
    }
    this.next();
    this.doc.tables.push(table);
  }

  private noteBody(): string {
    this.next();
    if (this.isPunct(':')) {
      this.next();
      return this.string('a note');
    }
    this.expectPunct('{');
    const note = this.string('a note');
    this.expectPunct('}');
    return note;
  }

  private field(table: DbmlTable): DbmlField {
    const name = this.name('a column or "}"');
    const field: DbmlField = {
      name: name.text,
      type: this.columnType(),
      pk: false,
      notNull: false,
      unique: false,
      increment: false,
      loc: name.loc,
    };
    if (this.isPunct('[')) {
      for (const setting of this.settings()) this.columnSetting(table, field, setting);
    }
    return field;
  }

  /** The type as written: `int`, `varchar(255)`, `numeric(10,2)`, `text[]`, `public.mood`. */
  private columnType(): string {
    const first = this.name('a column type');
    let type = first.text;
    if (this.isPunct('.')) {
      this.next();
      const second = this.name('a column type');
      type = first.text === 'public' ? second.text : `${first.text}.${second.text}`;
    }
    if (this.isPunct('(')) {
      this.next();
      const args: string[] = [];
      for (;;) {
        const token = this.peek();
        if (token.kind !== 'number' && token.kind !== 'word') this.fail('a type argument');
        args.push(this.next().text);
        if (!this.isPunct(',')) break;
        this.next();
      }
      this.expectPunct(')', '"," or ")"');
      type += `(${args.join(',')})`;
    }
    // An array only as written, `text[]`: in `text []` or `text [ ]` the bracket opens the settings.
    while (this.isPunct('[') && this.isPunct(']', 1) && this.touches() && this.touches(1)) {
      this.next();
      this.next();
      type += '[]';
    }
    return type;
  }

  private columnSetting(table: DbmlTable, field: DbmlField, setting: Setting) {
    switch (setting.key) {
      case 'pk':
      case 'primary key':
        flag(setting, 'column');
        field.pk = true;
        return;
      case 'not null':
        flag(setting, 'column');
        field.notNull = true;
        return;
      case 'null':
        flag(setting, 'column');
        field.notNull = false;
        return;
      case 'unique':
        flag(setting, 'column');
        field.unique = true;
        return;
      case 'increment':
        flag(setting, 'column');
        field.increment = true;
        return;
      case 'note':
        field.note = stringOf(setting);
        return;
      case 'default':
        field.default = defaultOf(setting);
        return;
      case 'ref': {
        const value = setting.value;
        if (value?.kind !== 'ref') {
          throw new DbmlSyntaxError(
            'ref needs a relation and a column, such as > users.id',
            value?.loc ?? setting.loc,
          );
        }
        this.doc.refs.push({
          from: {
            ...(table.schema ? { schema: table.schema } : {}),
            table: table.name,
            columns: [field.name],
            tableLoc: field.loc,
            columnLocs: [field.loc],
          },
          relation: value.relation,
          to: value.endpoint,
          loc: setting.loc,
        });
        return;
      }
    }
    throw new DbmlSyntaxError(`unknown column setting "${setting.key}"`, setting.loc);
  }

  private indexes(table: DbmlTable) {
    this.next();
    this.expectPunct('{');
    while (!this.isPunct('}')) {
      const loc = this.peek().loc;
      const columns: DbmlIndex['columns'] = [];
      if (this.isPunct('(')) {
        this.next();
        columns.push(this.indexColumn('a column or an expression'));
        while (this.isPunct(',')) {
          this.next();
          columns.push(this.indexColumn('a column or an expression'));
        }
        this.expectPunct(')', '"," or ")"');
      } else {
        columns.push(this.indexColumn('an index or "}"'));
      }
      const index: DbmlIndex = { columns, pk: false, unique: false, loc };
      if (this.isPunct('[')) {
        for (const setting of this.settings()) indexSetting(index, setting);
      }
      table.indexes.push(index);
    }
    this.next();
  }

  private indexColumn(expected: string): DbmlIndex['columns'][number] {
    const token = this.peek();
    if (token.kind === 'expression') {
      this.next();
      return { kind: 'expression', value: token.text, loc: token.loc };
    }
    const name = this.name(expected);
    return { kind: 'column', value: name.text, loc: name.loc };
  }

  private enumBlock() {
    const keyword = this.next();
    const { schema, name } = this.qualifiedName('an enum name');
    const block: DbmlEnum = { ...(schema ? { schema } : {}), name, values: [], loc: keyword.loc };
    this.expectPunct('{');
    while (!this.isPunct('}')) {
      const value = this.name('an enum value or "}"');
      block.values.push({ name: value.text, loc: value.loc });
      if (this.isPunct('[')) {
        for (const setting of this.settings()) {
          if (setting.key !== 'note') {
            throw new DbmlSyntaxError(`unknown enum value setting "${setting.key}"`, setting.loc);
          }
          stringOf(setting);
        }
      }
    }
    this.next();
    this.doc.enums.push(block);
  }

  /** `Ref: a > b`, `Ref name: a > b`, or a `Ref [name] { ... }` block of them. */
  private refDefinition() {
    const keyword = this.next();
    if (this.isName() && (this.isPunct(':', 1) || this.isPunct('{', 1))) this.next();
    if (this.isPunct(':')) {
      this.next();
      this.ref(keyword.loc);
      return;
    }
    this.expectPunct('{', '":" or "{"');
    while (!this.isPunct('}')) {
      if (this.peek().kind === 'eof') this.fail('a ref or "}"');
      this.ref(this.peek().loc);
    }
    this.next();
  }

  private ref(loc: SourceLocation) {
    const from = this.endpoint();
    const relation = this.relation();
    const ref: DbmlRef = { from, relation, to: this.endpoint(), loc };
    if (this.isPunct('[')) {
      for (const setting of this.settings()) {
        if (setting.key === 'delete' || setting.key === 'update') {
          const value = setting.value;
          if (value?.kind !== 'words') {
            throw new DbmlSyntaxError(
              `${setting.key} needs an action, such as cascade or set null`,
              value?.loc ?? setting.loc,
            );
          }
          if (setting.key === 'delete') ref.onDelete = value.text;
          else ref.onUpdate = value.text;
        } else if (setting.key !== 'color') {
          throw new DbmlSyntaxError(`unknown ref setting "${setting.key}"`, setting.loc);
        }
      }
    }
    this.doc.refs.push(ref);
  }
}

function indexSetting(index: DbmlIndex, setting: Setting) {
  switch (setting.key) {
    case 'pk':
      flag(setting, 'index');
      index.pk = true;
      return;
    case 'unique':
      flag(setting, 'index');
      index.unique = true;
      return;
    case 'name':
      index.name = stringOf(setting);
      return;
    case 'note':
      stringOf(setting);
      return;
    case 'type':
      return;
  }
  throw new DbmlSyntaxError(`unknown index setting "${setting.key}"`, setting.loc);
}
