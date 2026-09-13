import { describe, expect, test } from 'bun:test';
import { DbmlError, loadSchema, parseDbml, validateSchema } from '@blendx/dbml';

const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}`).text();
const problemsIn = async (source: string) => validateSchema(await parseDbml(source));

describe('validateSchema', () => {
  test('the addition fixture is valid', async () => {
    expect(await problemsIn(await fixture('addition.dbml'))).toEqual([]);
  });

  test('a table without a primary key is rejected', async () => {
    expect(await problemsIn('Table logs {\n  message text\n}\n')).toEqual([
      { message: 'table logs has no primary key', line: 1, column: 1 },
    ]);
  });

  test('a composite primary key is accepted (kitchen-sink order_items, D33)', async () => {
    expect(await problemsIn(await fixture('kitchen-sink.dbml'))).toEqual([]);
  });

  test('columns cannot use the query parameter names the index action reserves', async () => {
    expect(await problemsIn('Table posts {\n  id int [pk]\n  page int\n  sort text\n}\n')).toEqual([
      {
        message: 'column posts.page uses the reserved query parameter name "page"',
        line: 3,
        column: 3,
      },
      {
        message: 'column posts.sort uses the reserved query parameter name "sort"',
        line: 4,
        column: 3,
      },
    ]);
  });

  test('table and enum names must be free identifiers in generated code', async () => {
    const source = [
      'Enum status {\n  open\n}',
      'Table status {\n  id int [pk]\n}',
      'Table models {\n  id int [pk]\n}',
      'Table "order items" {\n  id int [pk]\n}',
    ].join('\n');
    expect((await problemsIn(source)).map((p) => p.message)).toEqual([
      'table "status" collides with the enum of the same name',
      'table name "models" is reserved in generated code',
      'table name "order items" is not a valid identifier (letters, digits and _ only)',
    ]);
  });

  test('foreign keys must reference a primary key or a unique column', async () => {
    const source = [
      'Table users {\n  id int [pk]\n  email text [unique]\n  name text\n}',
      'Table posts {\n  id int [pk]\n  author_email text [ref: > users.email]\n  author_name text [ref: > users.name]\n}',
    ].join('\n');
    expect(await problemsIn(source)).toEqual([
      {
        message:
          'posts.author_name references users.name, which is neither a primary key nor unique',
        line: 9,
        column: 3,
      },
    ]);
  });
});

describe('loadSchema', () => {
  test('returns the IR when schema.dbml is valid', async () => {
    const schema = await loadSchema(await fixture('addition.dbml'));
    expect(schema.tables.map((t) => t.name)).toEqual(['addition_results']);
  });

  test('throws one DbmlError listing every validation problem', async () => {
    const error = await loadSchema(
      'Table logs {\n  message text\n}\nTable posts {\n  id int [pk]\n  page int\n}\n',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbmlError);
    expect((error as DbmlError).message).toBe(
      [
        'schema.dbml:1:1 table logs has no primary key',
        'schema.dbml:6:3 column posts.page uses the reserved query parameter name "page"',
      ].join('\n'),
    );
  });
});
