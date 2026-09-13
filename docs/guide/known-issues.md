# Known issues

What does not work yet, or not as it should, and what to do instead. Issues are tracked in the Inbox of [`docs/todo.md`](../todo.md), and each one that app authors meet is listed here until it is fixed.

The ones found while building [`examples/expenses`](../../examples/expenses) and writing this guide were fixed in phase P15 of the todo.

## A cancelled query's request still runs

When TanStack Query cancels a query, because its component unmounted or the page called `cancelQueries`, it stops waiting for the reply. [The React client](react.md) does not pass the query's abort signal on to the request, though, so the request itself runs to the end and its reply is thrown away. Nothing goes wrong, but the server answers a request nobody reads. There is nothing to do instead for now.
