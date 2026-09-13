-- The shop fixture's starting data. reset() truncates every table, restarting identities,
-- then runs these statements: users 1 (Ada) and 2 (Bob), and order 1, paid, of user 1.
insert into users (email, password, display_name) values
  ('ada@example.com', 'ada-secret', 'Ada'),
  ('bob@example.com', 'bob-secret', 'Bob');

insert into orders (user_id, total, quantity, status) values (1, '19.00', 2, 'paid');
