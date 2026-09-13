# Known issues

What does not work yet, or not as it should, and what to do instead. Each was found while building [`examples/expenses`](../../examples/expenses) and writing this guide, and each is planned for a fix in phase P15 of [`docs/todo.md`](../todo.md). When one is fixed, its entry leaves this page.

| Issue | Affects | Fixed by |
|---|---|---|
| [A column cannot be shown once and hidden elsewhere](#a-column-cannot-be-shown-once-and-hidden-elsewhere) | `hidden` | P15.8 |

## A column cannot be shown once and hidden elsewhere

**What happens.** `hidden` applies to every reply of a resource, and a respond hook sees only the public record. A value that one reply must carry and every other reply must hide, such as an API token returned once at sign-up, has no way to say so.

**What to do.** Leave the column visible and expose the table only through actions whose replies may carry it. The expenses app's `users` blend has only sign-up and a show that is for the user themselves, so no reply shows a token to anyone else. [Tutorial, step 4](tutorial.md#4-sign-up).
