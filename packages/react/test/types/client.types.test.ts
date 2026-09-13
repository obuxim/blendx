/**
 * N.1b: an action's input and data are hc's own, the options fit TanStack Query's hooks, and
 * an action is a query or a mutation by its method. The *TypesOnly functions are only
 * typechecked, never called, so nothing renders and no request is sent.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import {
  type InfiniteData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { hc, type InferRequestType, type InferResponseType } from 'blendx/client';
import { tables } from '../../../conformance/fixtures/shop/src/generated/client.gen.ts';
import type { AppType } from '../../../conformance/fixtures/shop/src/generated/routes.gen.ts';
import { createBlendxClient } from '../../src/index.ts';

const client = hc<AppType>('http://localhost');
const api = createBlendxClient(client, tables);

type Client = typeof client;
type Index = Client['orders']['$get'];
type Show = Client['orders'][':id']['$get'];
type Store = Client['orders']['$post'];
type Destroy = Client['orders'][':id']['$delete'];
type Quote = Client['orders']['quote']['$get'];

function useTypesOnly() {
  const page = useQuery(api.orders.index.queryOptions());
  expectTypeOf(page.data).toEqualTypeOf<InferResponseType<Index, 200> | undefined>();

  const order = useSuspenseQuery(api.orders.show.queryOptions({ param: { id: '1' } }));
  expectTypeOf(order.data).toEqualTypeOf<InferResponseType<Show, 200>>();

  const store = useMutation(api.orders.store.mutationOptions());
  expectTypeOf(store.data).toEqualTypeOf<InferResponseType<Store, 201> | undefined>();
  expectTypeOf(store.variables).toEqualTypeOf<InferRequestType<Store> | undefined>();

  const destroy = useMutation(api.orders.destroy.mutationOptions());
  expectTypeOf(destroy.data).toEqualTypeOf<InferResponseType<Destroy, 204> | undefined>();
  expectTypeOf(destroy.data).toEqualTypeOf<null | undefined>();

  // N.9: an infinite index holds pages of what index replies. The hooks type the page params
  // as unknown, whatever the options say; fetchInfiniteQuery keeps them as numbers.
  type Page = InferResponseType<Index, 200>;
  const scrolled = useInfiniteQuery(
    api.orders.index.infiniteQueryOptions({ query: { per_page: '20' } }),
  );
  expectTypeOf(scrolled.data).toEqualTypeOf<InfiniteData<Page> | undefined>();
  expectTypeOf(scrolled.data?.pages).toEqualTypeOf<Page[] | undefined>();
  expectTypeOf(scrolled.fetchNextPage).toBeFunction();
  const suspended = useSuspenseInfiniteQuery(api.orders.index.infiniteQueryOptions());
  expectTypeOf(suspended.data).toEqualTypeOf<InfiniteData<Page>>();
  expectTypeOf(suspended.data.pages).toEqualTypeOf<Page[]>();
}

async function fetchedTypesOnly() {
  const quote = await new QueryClient().fetchQuery(
    api.orders.quote.queryOptions({ query: { quantity: '2' } }),
  );
  expectTypeOf(quote).toEqualTypeOf<InferResponseType<Quote, 200>>();
  expectTypeOf(quote).toEqualTypeOf<{ total: string }>();

  const pages = await new QueryClient().fetchInfiniteQuery(api.orders.index.infiniteQueryOptions());
  expectTypeOf(pages).toEqualTypeOf<InfiniteData<InferResponseType<Index, 200>, number>>();
}

describe('@blendx/react types', () => {
  test('a query takes hc input, optional when hc takes none', () => {
    // orders declares includes, so hc's show takes `query: { include?: string }`; the adapter
    // lets a part with nothing required be left out, as it does for index's query (N.8).
    expectTypeOf(api.orders.show.queryOptions).parameters.toEqualTypeOf<
      [input: { param: { id: string }; query?: { include?: string } }]
    >();
    expectTypeOf<InferRequestType<Show>['query']>().toEqualTypeOf<{ include?: string }>();
    expectTypeOf<InferRequestType<Show>>().toHaveProperty('query');
    expectTypeOf(api.users.show.queryOptions).parameters.toEqualTypeOf<
      [input: InferRequestType<Client['users'][':id']['$get']>]
    >();
    expectTypeOf(api.orders.index.queryOptions).parameters.toEqualTypeOf<
      [input?: { query?: InferRequestType<Index>['query'] }]
    >();
    // @ts-expect-error show needs the id
    api.orders.show.queryOptions();
    // @ts-expect-error users has no includes, so its show takes no query
    api.users.show.queryOptions({ param: { id: '1' }, query: { include: 'orders' } });
  });

  test('the query key carries the data type', () => {
    const options = api.orders.show.queryOptions({ param: { id: '1' } });
    expectTypeOf(new QueryClient().getQueryData(options.queryKey)).toEqualTypeOf<
      InferResponseType<Show, 200> | undefined
    >();
  });

  test('only index has infiniteQueryOptions, and its input takes no page (N.9)', () => {
    expectTypeOf(api.orders.index).toHaveProperty('infiniteQueryOptions');
    expectTypeOf(api.orders.show).not.toHaveProperty('infiniteQueryOptions');
    expectTypeOf(api.orders.quote).not.toHaveProperty('infiniteQueryOptions');
    expectTypeOf(api.orders.store).not.toHaveProperty('infiniteQueryOptions');
    api.orders.index.infiniteQueryOptions();
    api.orders.index.infiniteQueryOptions({
      query: { per_page: '20', sort: '-id', status: 'paid' },
    });
    // @ts-expect-error the pages come from fetchNextPage
    api.orders.index.infiniteQueryOptions({ query: { page: '2' } });
  });

  test('a GET action is a query, any other method a mutation', () => {
    expectTypeOf(api.orders.index).not.toHaveProperty('mutationOptions');
    expectTypeOf(api.orders.quote).not.toHaveProperty('mutationOptions');
    expectTypeOf(api.orders.store).not.toHaveProperty('queryOptions');
    expectTypeOf(api.orders.refund).not.toHaveProperty('queryOptions');
  });

  test('a mutation may name the other tables it changes, by their names in the map', () => {
    type Options = NonNullable<Parameters<typeof api.orders.refund.mutationOptions>[0]>;
    expectTypeOf<Options['invalidates']>().toEqualTypeOf<
      readonly ('order_notes' | 'orders' | 'users')[] | undefined
    >();
    // @ts-expect-error not a table of the app
    api.orders.refund.mutationOptions({ invalidates: ['payments'] });
  });

  test('optimistic: true on update, destroy and purge; a function of the row on other member actions (D30)', () => {
    type Row = InferResponseType<Show, 200>;
    api.orders.update.mutationOptions({ optimistic: true });
    api.orders.destroy.mutationOptions({ optimistic: true });
    api.orders.purge.mutationOptions({ optimistic: true });
    api.orders.refund.mutationOptions({
      optimistic: (row, input) => {
        expectTypeOf(row).toEqualTypeOf<Row>();
        expectTypeOf(input.json.reason).toEqualTypeOf<string>();
        return { ...row, status: 'refunded' };
      },
    });
    api.orders.restore.mutationOptions({ optimistic: (row) => ({ ...row, deleted_at: null }) });
    // @ts-expect-error update merges its body: no function
    api.orders.update.mutationOptions({ optimistic: (row: Row) => row });
    // @ts-expect-error a member action needs the function
    api.orders.refund.mutationOptions({ optimistic: true });
    // @ts-expect-error the function returns a row of the table
    api.orders.refund.mutationOptions({ optimistic: () => ({ status: 'refunded' }) });
    // @ts-expect-error store has no optimistic yet (N.11)
    api.orders.store.mutationOptions({ optimistic: true });
    // @ts-expect-error a collection action has no row
    api.orders.estimate?.mutationOptions({ optimistic: true });
    // @ts-expect-error order_notes has no show, so its row comes from index; a page is not a row
    api.order_notes.store.mutationOptions({ optimistic: (row: Row) => row });
  });

  test("field errors are keyed by the fields of the action's input", () => {
    type Fields<T extends { fieldErrors: (error: unknown) => object }> = keyof ReturnType<
      T['fieldErrors']
    >;
    expectTypeOf<Fields<typeof api.orders.refund>>().toEqualTypeOf<'reason'>();
    expectTypeOf<Fields<typeof api.orders.quote>>().toEqualTypeOf<'quantity'>();
    expectTypeOf<'total' | 'user_id' | `tags.${number}`>().toExtend<
      Fields<typeof api.orders.store>
    >();
    // index filters by any column, so any name may come back.
    expectTypeOf<'status'>().toExtend<Fields<typeof api.orders.index>>();

    const errors = api.orders.refund.fieldErrors(null);
    expectTypeOf(errors.reason).toEqualTypeOf<string | undefined>();
    expectTypeOf(errors).not.toHaveProperty('reasn');
  });

  test('only the actions the blends list', () => {
    expectTypeOf(api.order_notes).toHaveProperty('store');
    expectTypeOf(api.order_notes).not.toHaveProperty('show');
    expectTypeOf(api).not.toHaveProperty('payments');
  });

  test('the options fit useQuery, useSuspenseQuery, useMutation, fetchQuery and the infinite ones', () => {
    expectTypeOf(useTypesOnly).toBeFunction();
    expectTypeOf(fetchedTypesOnly).toBeFunction();
  });
});
