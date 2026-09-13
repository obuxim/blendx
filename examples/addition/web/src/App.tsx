/**
 * Add two numbers and see every result so far. The form is the store action's mutation, the
 * list is the index query, which a store invalidates, and a field the API refuses shows the
 * API's message next to it. The store is optimistic: the new row is in the list before the
 * API replies, with the sum the page works out itself, and the server's row replaces it.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { api } from './api.ts';

const { addition_results } = api;

/** A field's number. An empty or unreadable one is NaN, which JSON sends as null: the API refuses it. */
const numberIn = (form: FormData, name: string) => Number.parseFloat(String(form.get(name)));

export function App() {
  const results = useQuery(addition_results.index.queryOptions());
  const add = useMutation(
    addition_results.store.mutationOptions({
      // The row the list shows before the reply: the input, and what calculate would fill.
      optimistic: ({ json }) => ({ result: json.a + json.b }),
    }),
  );
  const errors = addition_results.store.fieldErrors(add.error);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    add.mutate({ json: { a: numberIn(form, 'a'), b: numberIn(form, 'b') } });
  };

  return (
    <main>
      <h1>Addition</h1>
      <form onSubmit={submit}>
        <Field name="a" error={errors.a} />
        <Field name="b" error={errors.b} />
        <button type="submit" disabled={add.isPending}>
          Add
        </button>
      </form>
      {add.variables && !add.isError && (
        <p role="status">
          {`${add.variables.json.a} + ${add.variables.json.b} = ${add.data ? add.data.result : '…'}`}
        </p>
      )}

      <h2>Results</h2>
      {results.isPending ? (
        <p>Loading…</p>
      ) : results.isError ? (
        <p role="alert">{results.error.message}</p>
      ) : results.data.data.length === 0 ? (
        <p>No results yet.</p>
      ) : (
        <ol aria-label="Results">
          {results.data.data.map((row) => (
            // A temporary key is negative: the row is not saved yet. Its result is the page's
            // own sum, or NaN from a field it could not read, which the API is about to refuse.
            <li key={row.id} aria-busy={row.id < 0 || undefined}>
              {Number.isFinite(row.result) ? row.result : '…'}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Field({ name, error }: { name: string; error: string | undefined }) {
  const hint = `${name}-error`;
  return (
    <p>
      <label>
        {name}{' '}
        <input
          name={name}
          inputMode="decimal"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? hint : undefined}
        />
      </label>
      {error && (
        <span id={hint} role="alert">
          {error}
        </span>
      )}
    </p>
  );
}
