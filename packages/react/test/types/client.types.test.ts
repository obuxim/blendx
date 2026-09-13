/**
 * N.1b: an action's input and data are hc's own, the options fit TanStack Query's hooks, and
 * an action is a query or a mutation by its method. The *TypesOnly functions are only
 * typechecked, never called, so nothing renders and no request is sent.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import { QueryClient, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { hc, type InferRequestType, type InferResponseType } from 'blendx/client';
import { endpoints } from '../../../conformance/fixtures/shop/src/generated/client.gen.ts';
import type { AppType } from '../../../conformance/fixtures/shop/src/generated/routes.gen.ts';
import { createBlendxClient } from '../../src/index.ts';

const client = hc<AppType>('http://localhost');
const api = createBlendxClient(client, endpoints);

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
}

async function fetchedTypesOnly() {
  const quote = await new QueryClient().fetchQuery(
    api.orders.quote.queryOptions({ query: { quantity: '2' } }),
  );
  expectTypeOf(quote).toEqualTypeOf<InferResponseType<Quote, 200>>();
  expectTypeOf(quote).toEqualTypeOf<{ total: string }>();
}

describe('@blendx/react types', () => {
  test('a query takes hc input, optional when hc takes none', () => {
    expectTypeOf(api.orders.show.queryOptions).parameters.toEqualTypeOf<
      [input: InferRequestType<Show>]
    >();
    expectTypeOf(api.orders.index.queryOptions).parameters.toEqualTypeOf<
      [input?: InferRequestType<Index>]
    >();
    // @ts-expect-error show needs the id
    api.orders.show.queryOptions();
  });

  test('the query key carries the data type', () => {
    const options = api.orders.show.queryOptions({ param: { id: '1' } });
    expectTypeOf(new QueryClient().getQueryData(options.queryKey)).toEqualTypeOf<
      InferResponseType<Show, 200> | undefined
    >();
  });

  test('a GET action is a query, any other method a mutation', () => {
    expectTypeOf(api.orders.index).not.toHaveProperty('mutationOptions');
    expectTypeOf(api.orders.quote).not.toHaveProperty('mutationOptions');
    expectTypeOf(api.orders.store).not.toHaveProperty('queryOptions');
    expectTypeOf(api.orders.refund).not.toHaveProperty('queryOptions');
  });

  test('only the actions the blends list', () => {
    expectTypeOf(api.order_notes).toHaveProperty('store');
    expectTypeOf(api.order_notes).not.toHaveProperty('show');
    expectTypeOf(api).not.toHaveProperty('payments');
  });

  test('the options fit useQuery, useSuspenseQuery, useMutation and fetchQuery', () => {
    expectTypeOf(useTypesOnly).toBeFunction();
    expectTypeOf(fetchedTypesOnly).toBeFunction();
  });
});
