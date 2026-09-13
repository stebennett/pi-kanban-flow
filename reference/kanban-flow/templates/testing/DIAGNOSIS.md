# Failure diagnosis — prove it before you touch it

Read by `card-tester` (classifying blockers) and `card-implementer` in rework mode (acting on
them). The untrained default when a test fails is "make the test pass". This file inverts it:
**prove which of the four it is before changing anything.**

## The four classes

| class | it is | the proof | the fix |
|---|---|---|---|
| `product` | the code is wrong | the test's expected value traces to the spec/design (worked example, cited section) and the code disagrees | fix the code, test-first; the test is untouchable |
| `test` | the test is wrong | the expected value does NOT trace to spec/design — it mirrors an old implementation, asserts internals, or contradicts a cited spec line | fix the test, citing the spec line that makes the old expectation wrong |
| `environment` | the harness/infra failed | the failure names the environment (connection refused, readiness timeout, missing tool) and reproduces with no code involvement | report it naming the environment; never "fix" code for an env failure |
| `flake` | non-deterministic | failed, then passed, with no relevant change — ambient clock/ids, ordering, shared state | report with BOTH outputs; never re-run to green and move on — a flaky test is a failing test |

## The procedure

1. Reproduce with the exact failing command. No repro → say so with both outputs; do not fix blind.
2. Trace the expected value: where does it come from? Spec arithmetic → `product`. The code's own
   formula or a stale snapshot → `test`. Neither, and infra is in the trace → `environment`.
3. Only then change something — and only the thing the class prescribes.

Changing a test to match the code without a spec citation is the named anti-pattern of this whole
system. If you believe a test is wrong, the burden is a citation, not a green run.
