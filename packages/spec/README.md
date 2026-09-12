# blendx spec

The language-agnostic definition of blendx. Every runtime (the TypeScript reference runtime today, others later) must behave as described here and pass `packages/conformance`.

Documents, added as the matching todo items land:

| Document | Covers | Todo |
|---|---|---|
| `pipeline.md` | Stage order, what each stage receives and returns, error precedence | P12.1 |
| `cascade.md` | schema → app → resource → action composition, `prev` vs `runDefault` | P12.1 |
| `derivation-rules.md` | Every schema → default rule, each with a test id | P4.2 |
| `errors.md` | RFC 9457 Problem Details shapes and status mapping | P12.1 |
| `review-format.md` | `review/*.yaml` and `*.examples.yaml` format | P12.1 |
| `conformance.md` | Conformance case format and matchers | P11.1 |
