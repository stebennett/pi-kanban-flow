Read templates/lenses/_shared.md first; it binds every lens.

## [experience]
**Focus:** Will a user meet a broken, inaccessible, or half-rendered state? You review what static
reading can judge — rendered states, selectors, keyboard paths, accessibility structure. Runtime
measurement (axe scans, Core Web Vitals budgets) is CI's job at the PR, not yours.

**Walk:**
1. **State coverage.** For every component the diff touches, enumerate the states it can render —
   empty, loading, error, partial, populated — and confirm each exists in the code AND has a test
   rendering it. A state that cannot be rendered from the component's inputs is `na`, not a gap;
   an unreachable error branch is a finding for `[functionality]`, not you.
2. **Selector discipline.** Every selector the diff adds follows the project's
   `selector_convention` (in your dispatch, e.g. `data-testid`) — no CSS paths, no nth-child
   chains, no text-content selectors on translatable copy.
3. **Keyboard and focus.** Where the diff adds or changes interaction: reachable by keyboard,
   visible focus state, focus moved sanely on open/close (dialogs return focus), no positive
   `tabindex`.
4. **Accessibility structure (static).** Interactive elements are real controls (`button`, `a`,
   not clickable `div`s); images/icons carry alt or are marked decorative; form fields have
   labels; heading levels don't skip; colour is not the only signal in anything the diff styles.

**Ask of every hunk:** What does the user see when this is empty, slow, or failing? Can they reach
it without a mouse?

**Red flags:** a component with a data dependency and no loading or error render; a `div` with an
onClick; a form field whose label is a placeholder; a selector like `.card > div:nth-child(2)`; a
modal that never returns focus; state coverage tested only via the populated happy path.

**Don't flag:** runtime metrics (axe violation counts, LCP/CLS budgets — CI owns them at the PR);
visual taste (spacing, colour choices — unless colour is the only signal); states the component's
inputs cannot produce; anything `[tests]` already flagged as an untested branch (stay in your
lane: you flag the missing *render state*, they flag the missing *assertion*).

**Example finding.** Diff adds `web/components/UsageTable.tsx` fetching usage rows with renders
for populated and empty, and a test for populated only.
Finding: `[experience] blocking — web/components/UsageTable.tsx:18: the fetch can reject but the
component has no error render — a failed request leaves the user a permanent spinner. Add an error
state with a retry affordance, a test rendering it, and (per state coverage) a test for the
existing empty render.`
