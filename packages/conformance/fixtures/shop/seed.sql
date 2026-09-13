-- The shop fixture's starting data. reset() truncates every table, restarting identities,
-- then runs these statements: users 1 (Ada) and 2 (Bob), order 1, paid, of user 1, and its
-- three notes: Ada wrote the first, nobody the second, Bob the third; and its two lines.
insert into users (email, password, display_name) values
  ('ada@example.com', 'ada-secret', 'Ada'),
  ('bob@example.com', 'bob-secret', 'Bob');

insert into orders (user_id, total, quantity, status) values (1, '19.00', 2, 'paid');

insert into order_notes (order_id, author_id, body) values
  (1, 1, 'first'),
  (1, null, 'second'),
  (1, 2, 'third');

insert into order_items (order_id, line, sku, quantity) values
  (1, 1, 'A-1', 2),
  (1, 2, 'B-2', 1);
