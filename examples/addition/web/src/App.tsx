/**
 * Add two numbers and see every result so far. The form is the store action's mutation, the
 * list is the index query, which a store invalidates, and a field the API refuses shows the
 * API's message next to it.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { api } from './api.ts';

const { addition_results } = api;

/** A field's number. An empty or unreadable one is NaN, which JSON sends as null: the API refuses it. */
const numberIn = (form: FormData, name: string) => Number.parseFloat(String(form.get(name)));

export function App() {
  const results = useQuery(addition_results.index.queryOptions());
  const add = useMutation(addition_results.store.mutationOptions());
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
      {add.data && add.variables && (
        <p role="status">
          {add.variables.json.a} + {add.variables.json.b} = {add.data.result}
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
            <li key={row.id}>{row.result}</li>
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
