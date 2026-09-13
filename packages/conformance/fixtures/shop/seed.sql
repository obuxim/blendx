-- The shop fixture's starting data. reset() truncates every table, restarting identities,
-- then runs these statements: users 1 (Ada) and 2 (Bob), order 1, paid, of user 1, and its
-- three notes.
insert into users (email, password, display_name) values
  ('ada@example.com', 'ada-secret', 'Ada'),
  ('bob@example.com', 'bob-secret', 'Bob');

insert into orders (user_id, total, quantity, status) values (1, '19.00', 2, 'paid');

insert into order_notes (order_id, body) values (1, 'first'), (1, 'second'), (1, 'third');
