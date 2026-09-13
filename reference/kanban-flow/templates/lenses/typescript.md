Read templates/lenses/_shared.md first; it binds every lens.

## [typescript]
*This lens assumes a React/Vite stack — project-specific rules belong in
`<board_dir>/PROTOCOL-ADDENDUM.md`.*

**Focus:** Language-expert review of `*.ts`/`*.tsx` changes — type safety, React correctness, and
this stack's specifics (Vite, Tailwind design tokens, Recharts, API-data-only rendering).

**Walk:**
1. Type-safety pass: `grep -n 'any\|as \|!' ` over the diff — every `any`, assertion cast, and
   non-null `!` needs a justification the code makes visible; API response types should come from
   one shared source, not be redeclared per component.
2. Hooks pass: for each `useEffect`/`useMemo`/`useCallback` — deps complete and stable? cleanup
   returned where it subscribes/schedules? Is the effect necessary at all (derived data belongs in
   render or `useMemo`, not `useState`+effect mirrors)?
3. Data-flow pass: every fetch has loading and error states rendered (not just the happy path);
   no pricing/totals arithmetic recomputed client-side — the API's figures are the truth
   (project invariant); list keys stable and identity-based (never array index for reorderable
   data).
4. Design-system pass: colors/fonts via the project's design tokens (e.g. primary/secondary/
   surface/text, accent), not hex literals; figures/stats in the mono font per the design bundle;
   interactive elements are semantic elements (`button`, labels tied to inputs).
5. Build hygiene: nothing secret in client code (`import.meta.env` only exposes `VITE_*` — check
   nothing sensitive is named into exposure); heavy chart data memoized before Recharts.

**Ask of every hunk:** What does the compiler no longer check because of this line? What happens
on the render *before* the data arrives? Does this state duplicate something derivable?

**Red flags:** `as unknown as T` / double casts; `useEffect` with an incomplete dep array
"because it loops" (fix the dependency identity instead); state mirrored from props;
`key={index}` on order/line-item lists; unhandled promise in an event handler; hex color literals
where a token exists; a component reimplementing `PriceCell` markings instead of reusing it;
`fetch` scattered per-component instead of the shared API client.

**Don't flag:** prettier/eslint-enforced formatting; explicit types where inference would work
(verbose ≠ wrong); missing tests (that's `[tests]`'s lane — you flag *untypeable* or *untestable*
component design only).

**Example finding.** Diff in `web/src/components/OrderSummary.tsx`:
```tsx
const [total, setTotal] = useState(0);
useEffect(() => { setTotal(lines.reduce((s, l) => s + l.amount, 0)); }, [lines]);
```
Finding: `[typescript] advisory — total is derived data mirrored into state via an effect — it
renders one frame stale after lines changes and adds a render cycle. Derive it in render (or
useMemo if lines is large). Also note the summed total must come from the API's per-line figures,
never be recomputed from unit prices client-side:`
```suggestion
const total = lines.reduce((s, l) => s + l.amount, 0);
```
