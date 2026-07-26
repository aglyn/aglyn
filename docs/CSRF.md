# CSRF protection (`apps/www`)

Scope: the **marketing site only**. `apps/www` serves public, unauthenticated forms
(contact, signup interest), so it uses a double-submit CSRF token. The **console and
tenant apps do not use CSRF** — they authenticate with Firebase session cookies and
API keys, and their endpoints check those instead.

## `CSRF_SECRET`

| | |
| -- | -- |
| Required by | `apps/www` (all deployments, including preview) |
| Not used by | `apps/console`, `apps/tenant` |
| Generate | `openssl rand -hex 32` |
| Local | `apps/www/.env.development.local` (see the `.example`) |
| Production | Vercel env on the www project |

### It fails closed (AGL-795)

With `CSRF_SECRET` unset, `appCsrfCheck` returns **500** and `CsrfApiMiddleware`
throws, with one explanatory log per process. This is deliberate.

The original implementation was `const CSRF_SECRET = process.env.CSRF_SECRET || ''`,
which failed **open**: an unset secret meant every token was signed with the empty
string, so every token was forgeable and the protection silently did nothing. Failing
closed makes a misconfigured deploy loud.

The check happens at **use**, not at import, so a missing secret breaks the form
endpoints rather than taking the whole site down at boot.

If www returns 500 on form posts after a fresh deploy or a new environment, this
variable is the first thing to check.

## Rotation

Rotating is cheap: it invalidates only **in-flight** form tokens. A visitor who loaded
a page before the rotation and submits after it gets one rejection and succeeds on
retry. There is no stored state keyed to the secret, so nothing needs migrating.

Set the new value in the Vercel env for www and redeploy.

### Outstanding: rotate after the log exposure (AGL-792)

**Status: NOT DONE as of 2026-07-26. Owner: Zach.**

`with-aglyn.nextjs.config.js` printed the *value* of `CSRF_SECRET` at every build and
every server start — for console, tenant, **and** www — so it was written into
retained Vercel build and runtime logs for as long as that line existed. AGL-792
changed the line to print `[set]` / `[unset]` instead, which stops new exposure but
does nothing about logs already retained.

The secret should therefore be treated as **exposed to anyone with access to those
logs** and rotated. Because rotation is low-impact (above), the only reason this is
still open is that it needs someone to do it deliberately rather than as a side effect
of another change.

When it's done, update this section with the date instead of deleting it — the
exposure window is worth keeping on the record.

## Related

- `libs/shared/util/rest-api/src/lib/csrf-app.ts` — the implementation.
- `libs/shared/util/rest-api/src/lib/csrf-app.spec.ts` — covers the fail-closed path.
- [`docs/RATE_LIMITING.md`](RATE_LIMITING.md) — the other half of the AGL-794/795
  public-endpoint hardening, and the model for how status is tracked here.
