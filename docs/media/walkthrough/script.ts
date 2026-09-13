/**
 * The walkthrough's script: its chapters and steps, with what each step shows and what the
 * narrator says. build.ts turns it into data.js and audio/, which index.html plays.
 */

export type Stage =
  | 'authenticate'
  | 'validate'
  | 'load'
  | 'authorize'
  | 'calculate'
  | 'save'
  | 'respond';

/** What a step shows: an excerpt of a file, commands in a terminal, or requests to the app. */
export type Panel =
  | {
      kind: 'file';
      /** Relative to the repository root. */
      path: string;
      /** The first line of the excerpt: the first line containing this text. */
      from?: string;
      /** The last line: the nth line after `from` that equals this text exactly. */
      until?: string;
      nth?: number;
      /** Or the first line after `from` that contains this text. */
      untilIncludes?: string;
      /** Lines containing any of these are highlighted. */
      highlight?: string[];
    }
  | { kind: 'shell'; capture: string }
  | { kind: 'http'; capture: string };

export interface Step {
  /** Stable: it names the step's audio file and its link. */
  id: string;
  chapter: 'addition' | 'expenses';
  title: string;
  /** The pipeline stages the step shows. */
  stages: Stage[];
  panel: Panel;
  narration: string;
}

export const CHAPTERS = [
  {
    id: 'addition',
    title: 'Addition',
    app: 'examples/addition',
    summary: 'One table and one blend: the smallest blendx app.',
  },
  {
    id: 'expenses',
    title: 'Expenses',
    app: 'examples/expenses',
    summary: 'Sign-up with a token, priced claims, drafts, approvers and a quote.',
  },
] as const;

const REPLY: Stage[] = ['validate', 'calculate', 'save', 'respond'];

export const STEPS: Step[] = [
  {
    id: 'addition-schema',
    chapter: 'addition',
    title: 'One table',
    stages: [],
    panel: {
      kind: 'file',
      path: 'examples/addition/schema.dbml',
      highlight: ['id int', 'deleted_at'],
    },
    narration:
      'This is the addition example, the smallest blendx app. It has one table. The id, the two timestamps and deleted_at are conventions: blendx fills them in, and never accepts them as input. Because deleted_at is there, deletes are soft.',
  },
  {
    id: 'addition-blend',
    chapter: 'addition',
    title: 'The only logic',
    stages: ['validate', 'calculate'],
    panel: {
      kind: 'file',
      path: 'examples/addition/blends/addition_results.ts',
      highlight: ['rules:', 'calculate:'],
    },
    narration:
      "The blend is the only logic in the app. The policy lets anyone in, and the five listed actions are the only routes. Store swaps the default rules for two numbers, and calculate turns them into the result column. Rules come first, because calculate's input type comes from them.",
  },
  {
    id: 'addition-generate',
    chapter: 'addition',
    title: 'Generate the rest',
    stages: [],
    panel: { kind: 'shell', capture: 'addition.generate' },
    narration:
      'blendx generate reads the schema and the blend, and writes everything else: the Drizzle schema, the routes, the types for the client, the migration config, and an OpenAPI document. Nobody edits these files; they are written again after every change.',
  },
  {
    id: 'addition-store',
    chapter: 'addition',
    title: 'Store answers 201',
    stages: REPLY,
    panel: { kind: 'http', capture: 'addition.store' },
    narration:
      'Posting four and three runs the whole pipeline. The input is validated, calculate adds the numbers, save inserts the row and stamps both timestamps, and the reply is the saved record, with status 201.',
  },
  {
    id: 'addition-invalid',
    chapter: 'addition',
    title: 'Strict input',
    stages: ['validate'],
    panel: { kind: 'http', capture: 'addition.invalid' },
    narration:
      'A wrong type and an unknown key are refused together, in one reply. Input is strict, so a client can never set a column it was not meant to. Every error is Problem Details, with a pointer to each field.',
  },
  {
    id: 'addition-soft-delete',
    chapter: 'addition',
    title: 'Soft delete and restore',
    stages: ['load', 'save', 'respond'],
    panel: { kind: 'http', capture: 'addition.soft-delete' },
    narration:
      'Destroy sets deleted_at instead of removing the row, and answers 204, with no body. After that, show no longer finds the row. Restore clears deleted_at, and brings it back.',
  },
  {
    id: 'addition-review',
    chapter: 'addition',
    title: 'A file for the reviewer',
    stages: [],
    panel: {
      kind: 'file',
      path: 'examples/addition/review/addition_results.yaml',
      from: '  store:',
      until: '      body: the record',
      highlight: ['calculate:', 'writes:'],
    },
    narration:
      'blendx review writes this file for a person to check. For each action it says what is accepted and what every stage does, and it shows calculate exactly as written. A reviewer who wants a change edits this file, and the check fails until the blend does what they wrote.',
  },
  {
    id: 'expenses-schema',
    chapter: 'expenses',
    title: 'Claims and users',
    stages: [],
    panel: {
      kind: 'file',
      path: 'examples/expenses/schema.dbml',
      highlight: ['gen_random_uuid', 'numeric(10,2)', 'status expense_status', 'indexes'],
    },
    narration:
      "The expenses app files expense claims and gets them approved. The database makes each user's API token. Money is numeric, so it travels as strings and loses nothing to rounding. The status enum and the two indexes give the listing its filters.",
  },
  {
    id: 'expenses-identity',
    chapter: 'expenses',
    title: 'Who is asking',
    stages: ['authenticate'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/src/app.ts',
      highlight: ['auth: async', 'return user ?? null'],
    },
    narration:
      'The identity is the user whose API token is the bearer token of the request. The auth function answers who is asking, and nothing else. Its return type becomes the type of auth in every policy and hook.',
  },
  {
    id: 'expenses-users',
    chapter: 'expenses',
    title: 'Sign-up',
    stages: ['validate', 'respond'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/users.ts',
      highlight: ["hidden: ['api_token']", "reveal: ['api_token']", 'prev.pick'],
    },
    narration:
      'Signing up takes only an email and a name; pick drops every other column, so nobody can make themselves an approver. The token is hidden, and only the sign-up reply reveals it. That is how a user gets their token, once.',
  },
  {
    id: 'expenses-signup',
    chapter: 'expenses',
    title: 'Signed up',
    stages: REPLY,
    panel: { kind: 'http', capture: 'expenses.signup' },
    narration:
      'Ada signs up, and gets her token in the reply. Eve tries to sign up as an approver, and gets a 422 that points at the field.',
  },
  {
    id: 'expenses-pricing',
    chapter: 'expenses',
    title: 'The business rule',
    stages: ['calculate'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: 'type Category',
      untilIncludes: 'const amount = ',
      highlight: ['TAX_RATES: Record', 'Math.round(cents'],
    },
    narration:
      'Pricing is a plain function in the blend. Meals carry ten percent tax, office supplies twenty. The sums run in cents. The rates are typed by the enum, so a new category in the schema needs a rate before the app compiles.',
  },
  {
    id: 'expenses-store',
    chapter: 'expenses',
    title: 'Filing a claim',
    stages: ['validate', 'calculate', 'save'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: '    a.store({',
      until: '    }),',
      highlight: ['rules:', 'calculate:', 'save:'],
    },
    narration:
      'Three hooks, one for each stage that differs. Rules take four fields. Calculate adds tax and total from the price function, and stays pure. Save sets the claimant from the identity, which calculate never sees.',
  },
  {
    id: 'expenses-filed',
    chapter: 'expenses',
    title: 'Filed and priced',
    stages: ['authenticate', ...REPLY],
    panel: { kind: 'http', capture: 'expenses.file' },
    narration:
      "Without a token, the request stops at once, with 401, before its body is read. With Ada's token, the claim comes back priced: forty, plus four of tax, filed as a draft in her name.",
  },
  {
    id: 'expenses-strict',
    chapter: 'expenses',
    title: 'What a client cannot send',
    stages: ['validate'],
    panel: { kind: 'http', capture: 'expenses.smuggle' },
    narration:
      'A client that sends the total itself, or an amount as a number, gets every mistake back at once. Tax and total are calculated, never sent.',
  },
  {
    id: 'expenses-policy',
    chapter: 'expenses',
    title: 'Who sees what',
    stages: ['load', 'authorize'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: '  policy: {',
      until: '    }),',
      highlight: ["default: allow.owner('user_id')", 'scope:'],
    },
    narration:
      "A claim belongs to its claimant, and approvers see everyone's. The listing uses a scope: approvers get every claim, anyone else only their own. Pages and totals count only the rows in scope.",
  },
  {
    id: 'expenses-scoped',
    chapter: 'expenses',
    title: 'A scoped listing',
    stages: ['load', 'authorize', 'respond'],
    panel: { kind: 'http', capture: 'expenses.scope' },
    narration:
      "Bob cannot see Ada's claim. Ada's listing holds only her own claim, and asking for Bob's claims gives her an empty page, not his claims.",
  },
  {
    id: 'expenses-drafts',
    chapter: 'expenses',
    title: 'Only drafts change',
    stages: ['authorize', 'calculate'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: '    a.update({',
      until: '    }),',
      highlight: ["record.status === 'draft'", 'input.amount ?? record.amount'],
    },
    narration:
      'An authorize hook adds a rule on top of the owner policy: only a draft changes. It can look at the record, because load runs first. A new amount or category is priced again, with the rest taken from the record.',
  },
  {
    id: 'expenses-repriced',
    chapter: 'expenses',
    title: 'Repriced',
    stages: ['load', 'authorize', 'calculate', 'save', 'respond'],
    panel: { kind: 'http', capture: 'expenses.draft' },
    narration:
      'Changing the amount to fifty prices the claim again: five of tax, fifty five in total.',
  },
  {
    id: 'expenses-review-rules',
    chapter: 'expenses',
    title: 'Submit, approve, reject',
    stages: ['authorize', 'calculate', 'save'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: "    a.member('submit', {",
      until: '    }),',
      nth: 3,
      highlight: ['reviewable(record, auth)', "status: 'rejected'"],
    },
    narration:
      'Three member actions move a claim along. Submit needs a draft. Approve and reject need an approver, a submitted claim, and a reviewer who did not file it. Reject also takes a note.',
  },
  {
    id: 'expenses-approver',
    chapter: 'expenses',
    title: 'Making an approver',
    stages: [],
    panel: { kind: 'shell', capture: 'expenses.approver' },
    narration:
      'Approvers are made outside the API, with a small script that uses the same config and the same generated models as the app.',
  },
  {
    id: 'expenses-approved',
    chapter: 'expenses',
    title: 'Approved, once',
    stages: ['load', 'authorize', 'save', 'respond'],
    panel: { kind: 'http', capture: 'expenses.review' },
    narration:
      'Ada submits, and her claim is locked. Cy, the approver, finds it among the submitted claims, and approves it. Approving it again is refused, because it is no longer waiting for review.',
  },
  {
    id: 'expenses-quote-code',
    chapter: 'expenses',
    title: 'A quote',
    stages: ['validate', 'calculate', 'respond'],
    panel: {
      kind: 'file',
      path: 'examples/expenses/blends/expenses.ts',
      from: "    a.collection('quote', {",
      until: '    }),',
      highlight: ['calculate:', 'reply:'],
    },
    narration:
      'Clients want the total before a claim is filed. A collection action loads and saves nothing: what calculate returns is the reply, and reply declares its shape for OpenAPI. The same price function serves store, update and quote, so they never disagree.',
  },
  {
    id: 'expenses-quoted',
    chapter: 'expenses',
    title: 'Quoted',
    stages: ['validate', 'calculate', 'respond'],
    panel: { kind: 'http', capture: 'expenses.quote' },
    narration:
      'Ten of office supplies quotes two of tax, twelve in total. A category that does not exist is refused, and the error names the query parameter.',
  },
  {
    id: 'expenses-review',
    chapter: 'expenses',
    title: 'The review',
    stages: [],
    panel: {
      kind: 'file',
      path: 'examples/expenses/review/expenses.yaml',
      from: '  approve:',
      until: '      body: the record',
      highlight: ['authorize: an approver', 'writes: [status]'],
    },
    narration:
      'Someone who does not read TypeScript can check this file: approvers review only what was submitted, and approving writes the status and nothing else. The from comments mark every stage the blend changed.',
  },
  {
    id: 'expenses-examples',
    chapter: 'expenses',
    title: 'Examples a person owns',
    stages: [],
    panel: {
      kind: 'file',
      path: 'examples/expenses/review/expenses.examples.yaml',
      from: 'store:',
      untilIncludes: "total: '1.19'",
      highlight: ['writes:', '- name:'],
    },
    narration:
      'The people who own the rules write examples like these: meals carry ten percent tax, and tax is rounded to the cent. The review check runs every one, without a database. To ask for twelve percent on meals, a reviewer changes the example, and the check fails until the blend agrees.',
  },
  {
    id: 'expenses-done',
    chapter: 'expenses',
    title: 'Done means four checks',
    stages: [],
    panel: { kind: 'shell', capture: 'expenses.checks' },
    narration:
      'Done means these four pass: the generated files match, the review files match and every example holds, the types check, and the tests pass. The app is about 175 lines of schema, identity and blends. blendx wrote the rest.',
  },
];

/** How the narrator says what the page spells: names, codes and statuses. */
export const SPOKEN: readonly (readonly [RegExp, string])[] = [
  [/\bblendx\b/g, 'blend ex'],
  [/\bOpenAPI\b/g, 'open A P I'],
  [/\bAPI\b/g, 'A P I'],
  [/\bDBML\b/g, 'D B M L'],
  [/\bdeleted_at\b/g, 'deleted at'],
  [/\bid\b/g, 'I D'],
  [/\b201\b/g, 'two oh one'],
  [/\b204\b/g, 'two oh four'],
  [/\b401\b/g, 'four oh one'],
  [/\b422\b/g, 'four twenty two'],
];
