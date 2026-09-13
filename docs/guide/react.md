# The React client

`@blendx/react` turns a blendx API into [TanStack Query](https://tanstack.com/query) options for a React app: every action, by its table and name, typed by the API itself. The code on this page comes from [`examples/addition/web`](../../examples/addition/web), a page that adds two numbers, and from the adapter's [tests](../../packages/react/test/client.test.ts), which run against the conformance suite's shop app.

## Setting up

The page lives next to the API, as a package of its own in the same repository, because it imports the API's types. [`examples/addition/web`](../../examples/addition/web/package.json) depends on `@blendx/react`, `blendx`, `@tanstack/react-query`, `react` and `react-dom`, and is built with Vite.

One file creates the client. From [`src/api.ts`](../../examples/addition/web/src/api.ts):

```ts
import { createBlendxClient } from '@blendx/react';
import { hc } from 'blendx/client';
import type { AppType } from '../../server.ts';
import { tables } from '../../src/generated/client.gen.ts';

export const api = createBlendxClient(hc<AppType>('/api'), tables);
```

- `hc<AppType>` is the typed client of [the HTTP API](http.md#the-typed-client). It carries the base URL, and whatever else every request needs, such as `headers: { authorization: ... }`.
- `tables` comes from `src/generated/client.gen.ts`, which `blendx generate` writes ([The CLI](cli.md#blendx-generate)): every table's actions, each as its method and path, and what the table includes. It imports nothing.
- `AppType` is a type-only import, so no server code reaches the page's bundle.

The page provides a QueryClient, as any TanStack Query app does. From [`src/main.tsx`](../../examples/addition/web/src/main.tsx):

```tsx
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

In development Vite serves the page and sends `/api` to the API, which `bun server.ts` serves on port 3000. From [`vite.config.ts`](../../examples/addition/web/vite.config.ts):

```ts
server: {
  proxy: { '/api': { target: api, rewrite: (path) => path.replace(/^\/api/, '') } },
},
```

## Queries and mutations

An action whose method is GET gives `queryOptions(input)`: index, show, and custom actions with `method: 'get'`. Every other action gives `mutationOptions()`. Hand them to TanStack Query's hooks. From [`src/App.tsx`](../../examples/addition/web/src/App.tsx):

```tsx
const { addition_results } = api;

export function App() {
  const results = useQuery(addition_results.index.queryOptions());
  const add = useMutation(addition_results.store.mutationOptions());
```

and, when the form is submitted:

```tsx
add.mutate({ json: { a: numberIn(form, 'a'), b: numberIn(form, 'b') } });
```

- **Input** is what `hc` takes: `json` for a body, `param` for a member action's id, `query` for a GET action's input. A part with nothing required may be left out, where `hc` itself would take `query: {}`: the whole input for index, as above, or show's `query` when its blend declares includes. Show needs its id: `api.orders.show.queryOptions({ param: { id: '1' } })`, or with an include, `{ param: { id: '1' }, query: { include: 'user' } }`.
- **Data** is the body of the action's success reply, typed as `hc` types it: a page for index (the example lists `results.data.data`), the record for store, show, update, restore and member actions, what calculate returns for a collection action, and `null` for the 204 of destroy and purge.
- The options are plain objects, so they work wherever TanStack Query takes options: `useQuery`, `useSuspenseQuery`, `queryClient.fetchQuery`, `prefetchQuery`, `ensureQueryData`, a router's loader. The adapter wraps none of them.
- A query hands TanStack's abort signal to its request, so a query that TanStack cancels (its component unmounted, or the page called `cancelQueries`) aborts its request too. The signal goes in the call's `init`, which `hc` merges into the client's own `init` key by key. So give the client no `init.signal` of its own: an AbortSignal does not survive that merge.
- Only the actions the blends list are on `api`; any other is a type error.

## Keys and invalidation

A query's key is `[table, action, input]`, with `{}` for no input, and a mutation's key is `[table, action]`. From the tests:

```ts
expect([...api.orders.index.queryOptions().queryKey]).toEqual(['orders', 'index', {}]);
expect(apiFor().orders.store.mutationOptions().mutationKey).toEqual(['orders', 'store']);
```

When a mutation succeeds, it invalidates every query of its table, and it resolves once the queries on screen have refetched. That is how the example's list shows a new result without a reload. A failed mutation invalidates nothing: the server rolled its transaction back.

A reply holds only rows of its own table, so an action changes another table only through a hook, which the client cannot see. Such a mutation names the other tables, and `invalidates` takes only table names of the API:

```ts
const naming = api.orders.refund.mutationOptions({ invalidates: ['users'] });
```

A query with `?include=` holds rows of another table ([Blends](blends.md#includes)), so a write to that table follows the include: after `users.update`, an orders query that asked for `include: 'user'` refetches, and one that did not keeps its data. The generated `tables` says which tables each table includes, and the tables a mutation names are followed the same way. From the tests:

```ts
const withUser = api.orders.index.queryOptions({ query: { include: 'user' } });
```

The invalidation runs inside the mutation function, not in `onSuccess`, so the page's own options can be spread over the adapter's without losing it:

```ts
const options = {
  ...api.orders.refund.mutationOptions(),
  onSuccess: () => {
    succeeded = true;
  },
};
```

## Pages

An index replies with one page, `{ data, meta: { page, per_page, total } }`, and takes `page` and `per_page` in its query ([The HTTP API](http.md#listing)). There are two ways to show more than one.

### Infinite scroll

Every index also has `infiniteQueryOptions(input)`, the same listing page by page, for `useInfiniteQuery`, `useSuspenseInfiniteQuery` and `queryClient.fetchInfiniteQuery`. Its input is index's without `page`: the first page is 1, and `fetchNextPage` asks for the next one while the pages seen so far do not reach `total`. From the tests:

```ts
const options = apiFor().orders.index.infiniteQueryOptions({ query: { per_page: '2' } });
```

```ts
while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
```

- The data is TanStack's `InfiniteData`: `pages`, each a reply of index, and `pageParams`, the page numbers. A list is `data.pages.flatMap((page) => page.data)`.
- Its key is the plain query's with `'infinite'` added, `['orders', 'index', input, 'infinite']`: TanStack says not to share a key between a query and an infinite query, and the `[table]` prefix keeps it under the table, so a mutation invalidates it as it does any other query, every loaded page refetched. An include it asked for is followed too.

### Numbered pages

For a pager, keep the plain query and put the page in its input: `api.orders.index.queryOptions({ query: { page: String(page) } })`. Each page is a query of its own, so moving to a page that is not cached shows nothing until it arrives; TanStack's `placeholderData: keepPreviousData`, spread over the options, keeps the last page on screen meanwhile:

```ts
useQuery({ ...api.orders.index.queryOptions({ query: { page: String(page) } }), placeholderData: keepPreviousData });
```

Both ways page by offset. In a list sorted newest first, a row inserted while the reader is on page 1 pushes the others down, so page 2 repeats the last row of page 1; a row removed skips one. A list sorted oldest first, or by a value that does not move, has neither.

## Errors

A reply that is not a success rejects with a `ProblemDetailsError`, exported by `@blendx/react`. It has the reply's `status`, its `problem` (the Problem Details of [the HTTP API](http.md#errors)) and a `message`, the problem's `detail` or else its `title`. A reply without Problem Details, such as a proxy's 502, gets one made from its status: `{ type: 'about:blank', title: 'Bad Gateway', status: 502 }`. A request that never gets a reply rejects with `fetch`'s own error.

### Field errors

Every action has `fieldErrors(error)`: the first message for each field of its input that a refusal names. From [`src/App.tsx`](../../examples/addition/web/src/App.tsx):

```tsx
const errors = addition_results.store.fieldErrors(add.error);
```

and, in the form, each field shows its message:

```tsx
<Field name="a" error={errors.a} />
<Field name="b" error={errors.b} />
```

- A body field is named by its path with dots: `total`, or `tags.0` for the first tag. A query parameter keeps its name.
- It reads the errors of any refusal: a 422 names the fields that are invalid, and a 409 names the unique column whose value is taken, such as `email`.
- The keys are typed by the action's input, so `errors.reasn` is a type error.
- A field gets one message, the first. `error.problem.errors` has them all.
- Anything else, such as a 403, a network error or no error at all, gives `{}`.

The example reads each field with `Number.parseFloat`, so an empty field is `NaN`, which JSON sends as `null`. The API refuses it, and its message appears next to the field.

## Testing

The options run without React: a QueryClient runs them the way the hooks do. From the adapter's [tests](../../packages/react/test/client.test.ts), where `apiFor` builds the client over `server.request`, as [Testing](testing.md) does for `hc`:

```ts
const options = apiFor().orders.quote.queryOptions({ query: { quantity: '2' } });
expect(await queryClient().fetchQuery(options)).toEqual({ total: '19.00' });
```

```ts
const refund = new MutationObserver(queryClient(), apiFor(1).orders.refund.mutationOptions());
const order = await refund.mutate({ param: { id: '1' }, json: { reason: 'damaged' } });
```

The page itself is tested in a browser. [`examples/addition/web/e2e`](../../examples/addition/web/e2e) runs Playwright in Chromium against the app's routes on in-memory PGlite, so every run starts from an empty table: `bun run e2e` in `web/`, after `bun run e2e:install` once for the browser.
