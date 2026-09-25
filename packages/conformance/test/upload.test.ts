/** P17.16: a typed multipart app action streams a bounded form into its transaction. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { type Shop, startShop } from '../harness/shop.ts';

let shop: Shop;
beforeEach(async () => {
  shop = await startShop();
  await shop.reset();
});
afterEach(async () => shop.close());

const upload = (file: File) => {
  const form = new FormData();
  form.set('file', file);
  return new Request('http://shop.test/users/1/avatar', {
    method: 'POST',
    headers: { 'x-user-id': '1' },
    body: form,
  });
};

test('multipart upload validates a native File and persists its safe metadata', async () => {
  const response = await shop.fetch(
    upload(new File(['png bytes'], 'avatar.png', { type: 'image/png' })),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: 1, byte_length: 9 });
});

test('multipart upload rejects a mismatched file and a bounded request body', async () => {
  const wrongType = await shop.fetch(
    upload(new File(['text'], 'avatar.txt', { type: 'text/plain' })),
  );
  expect(wrongType.status).toBe(422);
  const tooLarge = await shop.fetch(
    upload(new File([new Uint8Array(512 * 1024)], 'avatar.png', { type: 'image/png' })),
  );
  expect(tooLarge.status).toBe(413);
});

test('multipart upload rejects a non-multipart media type', async () => {
  const response = await shop.fetch(
    new Request('http://shop.test/users/1/avatar', {
      method: 'POST',
      headers: { 'x-user-id': '1', 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(response.status).toBe(400);
});

test('a missing identity answers before multipart parsing', async () => {
  const response = await shop.fetch(
    new Request('http://shop.test/users/1/avatar', {
      method: 'POST',
      body: 'not a multipart body',
    }),
  );
  expect(response.status).toBe(401);
});
