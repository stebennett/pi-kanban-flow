Read templates/lenses/_shared.md first; it binds every lens.

## [security]
**Focus:** The trust boundaries: API input, DB queries, outbound HTTP, secrets, dependencies, and
the container/release surface. A small user base ≠ no threat model — it still ships as a network
service.

**Walk:**
1. Boundary inventory: list every point in the diff where external data enters (endpoints, query
   params, seed/file loads, adapter tool args) and every point where data leaves (DB, httpx, logs,
   filesystem).
2. For each input: what constrains it? Pydantic types must actually bound it (ranges on amounts/
   quantities/dates, enum for category names, max lengths on strings) — `str`/`int` alone is not
   validation. Trace the value to first use: what breaks with 10⁹ line items, a negative amount,
   a 10 MB string?
3. For each query: parameters bound by SQLAlchemy, or string-built? Any raw `text()` with
   interpolation?
4. For each outbound call (adapter-layer httpx): timeout set? URL fixed/allowlisted, or
   attacker-influenced (SSRF)? TLS verification untouched?
5. Sweep for secrets and config: hardcoded tokens/paths in code, compose files, CI, k8s manifests;
   containers running as root; new dependencies (pinned? maintained? why this one?).

**Ask of every hunk:** Where did this value come from, and who checked it? What's the worst input
that reaches this line? What does an attacker on the same network get?

**Red flags:** f-strings/`%`/`+` building SQL or shell commands; `text(f"…")`; `httpx` calls with
no `timeout`; user-supplied path segments reaching `open()`/`Path` without normalization;
`verify=False` anywhere; secrets in envs committed to the repo; `debug=True`/wide-open CORS in
anything that ships; Pydantic models with unconstrained fields on write endpoints; new deps
without pins.

**Don't flag:** theoretical attacks the spec explicitly scopes out (e.g. multi-tenant isolation in
a single-tenant system with no other tenants), unless the code pretends to have that boundary and
gets it wrong; hardening already handled at a different layer (verify the layer exists, then stay
silent).

**Example finding.** Diff in `adapter/src/client.py`:
```python
resp = httpx.get(f"{base_url}/orders/{order_id}")
```
Finding: `[security] blocking — Two issues at this call: no timeout (a hung API blocks the adapter
service indefinitely — httpx has no default timeout), and order_id is interpolated into the path
unchecked — a value like "1/../../admin" changes the target route. Use the typed client with a
timeout and params, and validate order_id as int in the tool schema before it gets here:`
```suggestion
resp = client.get(f"/orders/{int(order_id)}", timeout=10.0)
```

