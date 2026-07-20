# Local authenticated e2e for the console

Runs the console against the Firebase emulators with a seeded org/host and a
real signed-in session — no staging instance needed. The specs cover the
pages that historically rendered empty under the emulator (the regression
canary for the authenticated read path) plus the July 2026 feature-wave
surfaces: the Marketing hub (rollup, overlay engagement, merge tags,
scheduled sends, experiments), the Logic page's Reference health audit,
workflow/automation Runs logs, the billing page's Stripe portal + cancel
flow, and the notifications feed with category mutes.

## Requirements

- **firebase-tools ≥ 13** for the emulators (the recipe below uses `npx`, so
  the globally installed CLI doesn't matter). **This is the big one**: the
  long-standing "authenticated emulator sessions see empty pages / silent
  permission denials" wall was firebase-tools 11's Firestore emulator
  ignoring the `Authorization` header on the modern firebase-js-sdk v12
  WebChannel handshake — every listen evaluated rules as unauthenticated
  while REST and the Node SDK (gRPC) worked fine. v13 fixes it (v14+ needs
  Java 21; v13 runs on Java 11+).
- Google Chrome installed (the harness drives it via `playwright-core`; no
  browser download).

## Running it

Three terminals (or background the first two):

```bash
# 1. Emulators (dedicated config: auth 9099, firestore 8082, UI disabled)
cd cloud && npx -y firebase-tools@13 emulators:start \
  --config firebase.e2e.json --project aglyn-main --only auth,firestore

# 2. Seed + console dev server with the emulator flags
npm run seed:e2e
npm run serve:console:emulated     # port 4200

# 3. The tests
npm run e2e:console                # E2E_BASE_URL overrides the target
```

## Tenant production-mode smoke (AGL-595) — REQUIRED before deploying tenant changes

```bash
# emulators + seed running (steps 1–2 above); port 4500 free
npm run smoke:tenant:prod
```

Builds apps/tenant for production, starts the real `next start` server
against the emulators, and asserts the seeded routes return 200 with
their content. This is the only local gate that catches
**request-time-only ISR failures** — the class that took every tenant
site down on 2026-07-20 (`useSearchParams()` without a Suspense
boundary → `BAILOUT_TO_CLIENT_SIDE_RENDERING` 500): the dev server
renders dynamically, the console is fully dynamic, and the Vercel build
prerenders nothing, so typecheck, dev-server verification, and a green
build all missed it. Run this for ANY change touching apps/tenant
rendering paths (layouts, providers, shared client components the
tenant mounts).

The harness signs in once through the real `/signin` UI (a synthetic
localStorage session races the app's `connectAuthEmulator` call — don't),
pre-warms each route so dev-server compiles don't eat the navigation
timeout, then asserts seeded content on every page. Failures drop full-page
screenshots into `tmp/e2e-artifacts/`.

## The three bugs this setup fixed (July 2026)

Context for future spelunkers — the "auth-race wall" was actually three
stacked issues:

1. **Emulator dropped auth on modern WebChannel** (firebase-tools 11, above)
   — the root cause of the AGL-217 "browser empty, Node works" mystery.
2. **`useSessionCookie` signed restored sessions out**: the Auth emulator
   doesn't support session cookies, so the cross-subdomain `__session` mint
   always failed, and the hook's restore-validation branch read the missing
   cookie as "signed out elsewhere" → `signOut()` + wiped persistence on
   every fresh page load. Now skipped under `FIREBASE_AUTH_EMULATOR_ENABLED`.
3. **Streaming transport hang + App Check 403s under the emulator** — fixed
   by forcing long-polling / memory cache and skipping `initializeAppCheck`
   when the emulator flags are set (`firebase-services.tsx`).

Also historical: the old `seed-demo-host.mjs` predates the org data model
and wrote docs missing queried fields (Firestore silently drops docs missing
an `orderBy` field; the media root view hides foldered items; contacts/
datasets read org-scoped paths via `hostIndex/{hostId}.orgId`).

## Fixtures

`tools/scripts/seed-e2e.mjs` (idempotent, **refuses to run without both
emulator-host env vars** so it can never touch production):

- Auth user `e2e@aglyn.test` / `E2e-Password-1` (uid `e2e-owner`, `staff`
  claim; the password satisfies the sign-in form's client-side policy).
- Org `e2e-owner` — business plan, active subscription (all entitlements
  unlock), owner member, `users/{uid}/orgs` workspace mirror.
- Auth user `owner@aglyn.test` / `E2e-Password-1` (uid `e2e-nonstaff-owner`,
  **no** `staff` claim) + Org `e2e-nonstaff-owner` (business plan, owner
  member, workspace mirror, no host). Because the primary org's owner is the
  staff account, staff impersonation of _its_ owner always 400s; this org's
  non-staff owner is the only fixture that exercises the impersonation
  success path (AGL-357).
- Auth user `unverified-owner@aglyn.test` / `E2e-Password-1` (uid
  `e2e-unverified-owner`, **`emailVerified: false`**, no `staff` claim) + Org
  `e2e-unverified-owner` (business plan, owner member, workspace mirror, no
  host). Exercises the AGL-480 impersonation exemption from the AGL-479
  email-verify gate: staff impersonating this owner reach a working console
  (the `impersonatedBy` claim is exempt), while a direct sign-in as this owner
  stays gated to `/verify-email`.
- Host `demo` — `orgId`, `memberRoles`, `hostIndex` mirror.
- Org-scoped: `datasets` (Team + records), `contacts`, `lists`.
- Host-scoped: root-level media (with `createdAt`), bookings (with
  `startsAtMs`), a service, a blog collection + entry, variables/functions/
  workflows/actions, an overlay, a sent campaign, a lead.

## Env knobs (all optional)

| Var                          | Default                 | Meaning               |
| ---------------------------- | ----------------------- | --------------------- |
| `E2E_BASE_URL`               | `http://localhost:4200` | Console dev server    |
| `E2E_HOST`                   | `demo`                  | Host under test       |
| `E2E_EMAIL` / `E2E_PASSWORD` | seeded values           | Test account          |
| `E2E_CHROME_PATH`            | system Chrome           | Browser binary        |
| `E2E_TIMEOUT_MS`             | `45000`                 | Per-assertion timeout |
| `E2E_ARTIFACTS_DIR`          | `tmp/e2e-artifacts`     | Failure screenshots   |

## Tenant render + API checks

The same emulator + seed also drive a tenant smoke pass (no separate runner
yet — curl assertions). The e2e firebase config pins `emulators.logging.port`
to 4520 and `hub.port` to 4420 precisely so **port 4500 stays free**: the
tenant middleware's `localhost:4500` case then resolves the seeded host
`demo` natively, with no temporary middleware edits.

```bash
# emulators + seed as above, then:
npm run serve:tenant:emulated      # nx serve tenant --port 4500 + emulator flags
```

What to assert (all against `http://localhost:4500`):

| Check                                            | Expect                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `/blog`, `/blog/three-day-sourdough`, `/search`  | 200, themed, `… – Demo Bakery` titles; the entry page carries a server-rendered `application/ld+json` `Article` |
| `/`                                              | 404 — the seed publishes no ROOT screen, by design                                                              |
| `/home`                                          | 200 — the seeded `seed-home` screen (its `versionId` pointer is what publishes a screen)                        |
| `/robots.txt`, `/sitemap.xml`                    | middleware rewrites into `app/api/robots` / `app/api/sitemap` (text/plain + xml)                                |
| `/api/screen?host=demo`                          | 200 with the `{status, statusCode, data}` JSON envelope                                                         |
| `/api/collections-rss?host=demo&collection=blog` | 200 RSS                                                                                                         |
| `/api/bookings/slots?hostId=demo`                | 200 seeded service — proves the `[...pluginApi]` dispatcher → adapter → unchanged plugin handler chain          |
| `/api/anything-unregistered`                     | 404                                                                                                             |
| `POST /api/analytics/collect`                    | 204                                                                                                             |

## Docs screenshots

`tools/e2e/capture-docs-screenshots.mjs` reuses the same stack to capture
the docs site's console screenshots (1440×900 PNGs straight into
`apps/docs/static/img/…`), stripping the emulator banner and dev overlay.
Re-run it after UI changes so the docs never drift:

```bash
E2E_BASE_URL=http://localhost:4200 node tools/e2e/capture-docs-screenshots.mjs
```

`tools/e2e/capture-docs-shots.mjs` (AGL-554) does the same for the docs
**Guides** section (`apps/docs/static/img/guides/`), but flow-driven: it
seeds guide fixtures on top of `seed:e2e` (a typed survey dataset, a
published survey screen, storefront products across the billing modes,
orders, a site member), then walks the guide flows — including a real
survey submission and member sign-up on the tenant dev server:

```bash
# needs BOTH dev servers: serve:console:emulated (4200) + serve:tenant:emulated (4500)
FIRESTORE_EMULATOR_HOST=localhost:8082 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
  node tools/e2e/capture-docs-shots.mjs   # --only=<out-substring>, --no-seed
```

## Adding specs

Add rows to the `specs` table in `tools/e2e/console.e2e.mjs` — a path plus
the text the seeded fixtures make visible. Keep the invariant when extending
the seeder: **every doc carries the fields the page's queries `orderBy` or
`where` on**, or the page will look empty with zero errors.
