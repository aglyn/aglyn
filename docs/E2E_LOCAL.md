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
# 1. Emulators (dedicated config: auth 9099, firestore 8082, storage 9199, UI disabled)
cd cloud && npx -y firebase-tools@13 emulators:start \
  --config firebase.e2e.json --project aglyn-main --only auth,firestore,storage

# 2. Seed + console dev server with the emulator flags
npm run seed:e2e
npm run serve:console:emulated     # port 4200

# 3. The tests
npm run e2e:console                # E2E_BASE_URL overrides the target
```

Storage is emulated too, and has to be. Both `serve:*:emulated` scripts set
`FIREBASE_STORAGE_EMULATOR_HOST` (`localhost:9199` unless the caller exports
another), which is the only variable firebase-admin reads to find a Storage
emulator; without it every media upload, replace, delete and CDN read from an
"emulated" server goes to the real bucket named in `.env.development.local`,
with the real service account beside it. Start the emulators with `storage` in
`--only`, as above, or media calls fail with a refused connection, which is the
failure you want.

No production credentials either (AGL-2828). The scripts do not serve through
`nx serve`: its task runner loads the env files through dotenv-expand, which
reads an empty variable as unset and writes the file's value over it, so a key
blanked in the script or in your shell still reaches the server. They run
`tools/scripts/serve-emulated.mjs <app>` instead. It loads the env files nx
would (the app's, then the workspace root's), sets every credential for a
service the emulators do not stand in for to an empty value, runs the
`clean-next-cache` prune, and starts `next dev` with that environment. That
covers Stripe, Vercel, Resend and the GA4 API secret, and by default any new
`*_API_KEY`, `*_TOKEN` or `*_SECRET`. Next never replaces an inherited
variable, even an empty one, so a flow that reaches billing, email or domains
fails closed instead of calling the real service. The startup line names what
was blanked. What stays, and why, is `KEPT_CREDENTIALS` in
`tools/scripts/lib/emulated-env.mjs`: the Firebase service account (the Admin
SDK does not start without it) and the secrets the app uses only to sign and
verify its own requests. A port passes through as before:
`npm run serve:console:emulated -- --port 4210`. The emulator hosts a script
sets, and the `NEXT_PUBLIC_` twins the page reads (below), reach `next dev`
unchanged: `serve-emulated.mjs` keeps every variable it inherits and empties
only credential-shaped names.

## A private port set (AGL-2834)

Several sessions share this machine, and one of them usually holds the default
emulator ports. Every part of the stack finds the emulators through the same
four variables, so a whole stack — emulators, seed, console, tenant and
harness — runs beside another one once those variables name other ports:

```bash
# 1. Every port the e2e config pins, moved by an offset, and the variables to match
eval "$(node tools/scripts/emulator-config.mjs --offset=10000)"
npx -y firebase-tools@13 emulators:start --config "$FIREBASE_EMULATOR_CONFIG" \
  --project aglyn-main --only auth,firestore,storage,database

# 2. In every other terminal on that stack, the same `eval` first, then:
npm run seed:e2e
npm run serve:console:emulated -- --port 4310
E2E_BASE_URL=http://localhost:4310 npm run e2e:crm:reports
```

- `emulator-config.mjs` writes `cloud/firebase.e2e.offset-<N>.json`, beside
  the config it copies, where git ignores it. It has to be there, because
  firebase-tools resolves every rules and indexes path against the directory
  of the config it was started with, and refuses a path that leads out of that
  directory (AGL-2858). The four emulators move, and so do the hub, logging
  and Firestore websocket ports, because each of those collides with a second
  stack too. An offset whose ports are taken is refused. It prints `export`
  lines for `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`,
  `FIREBASE_STORAGE_EMULATOR_HOST`, `FIREBASE_DATABASE_EMULATOR_HOST` and
  `FIREBASE_EMULATOR_CONFIG`.
- firebase-tools does not refuse a rules file it cannot find. The Firestore and
  Realtime Database emulators log `rules file … does not exist` and start
  anyway, and Firestore then allows every read and write, so a spec that
  expects the rules to refuse a write passes or fails for the wrong reason.
  Read the start log for that line.
- `seed:e2e`, both `serve:*:emulated` scripts and `require-emulator.mjs` read
  those variables, and fall back to the default ports when they are unset. The
  serve scripts also hand them to the page. A browser bundle only sees
  `NEXT_PUBLIC_*`, so each host the page connects to is mirrored into
  `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST`,
  `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` and, for the console's presence
  session, `NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST`. Before those twins,
  the page always connected to 8082 and 9099, so its reads and writes landed in
  whichever stack held them.
- The harness reads `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`
  as well (`tools/e2e/lib/console-session.mjs`).
- The console dev server takes any free port. The tenant dev server does not:
  its middleware routes `localhost:4500` and `*.localhost:4500` only, so one
  tenant dev server runs at a time, whichever stack it points at.
- Two stacks for one project id share a hub locator file in the system temp
  directory, which is what firebase-tools' warning about multiple instances
  refers to. Commands that look a running hub up, such as `emulators:export`,
  find only one of them.

⚠️ Serve from a worktree only if `npm run worktree:new` made it (AGL-2860).
"A second checkout, when the main one is busy" below says what it does and why
each step is there. A worktree from a bare `git worktree add` has a
`node_modules` SYMLINK, which Turbopack refuses outright, and none of the
gitignored env files, which costs the sign-in page its Firebase key and every
spec a 45-second `page.fill` timeout that looks like a slow compile.
`serve-emulated.mjs` refuses to start on the symlink and prints the clone; the
missing env files announce themselves only in the browser console. Reaching for
`--webpack` gets past neither — it follows the link and then fails on a Node
builtin the server externals no longer cover, and switching bundlers leaves
`apps/console/.next` mixed, after which every route answers 404 until it is
deleted.

To confirm a run landed where you meant it to, ask the emulators rather than
the harness. The Auth emulator lists each account's `lastLoginAt`, which the UI
sign-in moves:

```bash
curl -s -X POST -H 'Authorization: Bearer owner' -H 'Content-Type: application/json' \
  -d '{}' "http://$FIREBASE_AUTH_EMULATOR_HOST/identitytoolkit.googleapis.com/v1/projects/aglyn-main/accounts:query"
```

The Firestore emulator counts rule evaluations, which only a client SDK causes;
the Admin SDK in the seed and the harness bypasses the rules:

```bash
curl -s "http://$FIRESTORE_EMULATOR_HOST/emulator/v1/projects/aglyn-main:ruleCoverage"
```

Stop the emulators with Ctrl-C, and delete the config when you are done, with
`rm "$FIREBASE_EMULATOR_CONFIG"`.

## The CRM specs (AGL-2610)

Eight browser-driven scripts under `tools/e2e/crm-*.e2e.mjs`: seven, one per
surface the v2 arc shipped, and one for the plan gate on a Free workspace. Each
signs in through `/signin`, drives the console as a person does, and asserts on
the page AND on the document behind it through the emulator-side Admin SDK:

```bash
E2E_BASE_URL=http://localhost:4210 npm run e2e:crm          # all eight, in order
npm run e2e:crm:bulk-bar        # tick two rows → tag, stage, owner, audience, CSV, remove
npm run e2e:crm:reports         # /crm/reports (dashes until read) + the two dashboard cards
npm run e2e:crm:leads           # status, owner, convert from the row menu, already-converted, unqualify (+ Convert… disabled), Inbox → CRM
npm run e2e:crm:automation      # Contact created / Contact changed stage → tag on the facet, Runs
npm run e2e:crm:contact-record  # custom field, audience, Properties save, phone search, delete
npm run e2e:crm:deals           # board → move → won (the contact floored at customer) → table; Pipelines dialog, switcher, line items, forecast
npm run e2e:crm:org-hub         # /{org}/contacts → /{org}/crm/contacts, bare /crm, Known by, a create stamped with the picked site, the lead-surfaces note grouped by site, a lead's site address, a deal moved from the org board + its org activity line, an organization task (no site) filed and completed, the two CRM cards on the org's sites page, a recipe installed from org Settings → stamped on the site, refused twice, shown on the site's Actions page
```

```bash
npm run e2e:crm:free-plan       # a Free workspace, where the CRM is locked: a bare /crm stays on the CRM notice beside a rail with all eight sections locked, Leads included, on both hubs, and every section, a lead's page and a contact's page draw the same notice and no person; crm/contact-email-history, contacts-create (staff too) and lead-convert 403 plan_required, the companies export refused; a lead's status change and a company's writes refused by the rules; Settings → Privacy downloads every contact and lead and erases a contact with no lead by address; the same acts admitted on Starter
```

The seven surface specs drive the primary org, which is on Business, so the
whole CRM is open to them and none of them can see the gate (AGL-2787,
AGL-2801, AGL-2851). `crm-free-plan` signs in as the non-staff owner of a
second workspace that is always on Free, where the CRM is locked, and its
route, rules and hub steps run again on Starter as the control: the same acts,
admitted.

They share `tools/e2e/lib/console-session.mjs` (Chrome, the UI sign-in, the
three-verdict tally, MUI gestures) and re-seed their own fixtures first, so
each is re-runnable on its own. Set `E2E_SHOTS_DIR` to a directory and every
script also drops staged captures of its surface there at 1840×1160 — the
frame the docs and the press kit use — with the emulator banner, the dev
indicator and the staff-only release-flag chrome stripped. Run them one at a
time: they share one fixture and each resets it.

## The DAM spec (AGL-2782)

`tools/e2e/dam-replace-and-video.e2e.mjs` drives the media library and a
published page together, so it needs BOTH dev servers and the Storage
emulator:

```bash
# emulators with storage (step 1), seed (step 2), then:
npm run serve:console:emulated                      # console on 4200
REVALIDATE_SECRET=local npm run serve:tenant:emulated   # tenant on 4500
E2E_STORAGE_BUCKET=<NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET of those servers> \
  E2E_REVALIDATE_SECRET=local npm run e2e:dam
```

The tenant caches a host's routing map for an hour and a publish busts it
through `/api/revalidate`, so the spec publishes its screens the way the
console does: documents first, then that call. Without a matching
`REVALIDATE_SECRET` a freshly published screen is a 404 for the hour, and the
spec refuses to start rather than report the page as broken.

It uploads an image, a PDF, a film and a CSV through the library's own input
(so the browser video probe runs as it does for a person), publishes a page
placing each one, and asserts the published HTML, the VideoObject, every media
CDN representation (poster, missing poster, `?r=`, `?r=auto`, ranges), the
lightbox as a visitor uses it (no dialog code or film bytes before it is
approached; Enter, Space and click to open; a named dialog that holds focus;
Escape and the close button; focus returned), a replace of every family
through the card menu followed to every reference on the page, the old
content-hashed URL's redirect, and the storage band at signed-replace mint.

⛔ Before it writes anything, even to the emulator, it refuses a server that
holds a credential for Stripe, Vercel, Resend or any other service the
emulators do not stand in for (AGL-2828). It finds the process listening on each port and reads its
environment with `ps eww`, printing names only. Next's dev server retitles
itself, which hides its environment from `ps`, so that is read from the
`next dev` parent that forked it. Every such credential an env file defines has
to be present and empty there. Absent does not pass, because a server fills an
undefined variable from its env files after `ps` has looked. A server started
with `nx serve` or with a bare `next dev` fails this preflight.

⛔ It then refuses to upload anything until both servers have served an object that
exists ONLY in the Storage emulator. A server started without
`FIREBASE_STORAGE_EMULATOR_HOST` fails that preflight instead of writing test
files into a real bucket. The two films it uploads are committed under
`tools/e2e/fixtures/`; every other fixture is generated per run, and every
name carries the run id, so it is re-runnable without a re-seed.

Video uploads ship paused behind `release_video_uploads` (AGL-2830), so the
films are accepted only for an org holding that flag's per-org override.
`seed:e2e` grants it to the primary e2e org and to no other
(`tools/scripts/lib/e2e-release-flags.mjs`). An emulator seeded without the
grant refuses both films with `403 video_uploads_paused`: re-run the seed, and
allow a running console up to a minute, which is how long its server caches an
org's overrides.

The lightbox's player draws its own controls (AGL-2802), because Chrome's
native ones keep Escape from the page: from inside them no key event reaches it
in any phase. The spec reads the dialog's tab order, reaches each stop with Tab,
checks it draws a focus ring, presses Escape, and checks the dialog closed and
focus went back to the trigger. It then presses the player's own keys in Chrome
(K, M, the arrows, and F with Escape leaving full screen first). A stop that
stays open is closed with its button, so the rest of the run is unaffected.

What it cannot see: Vercel's edge. A replaced image can stay edge-cached under
its stable URL for up to `s-maxage`. A page never names the content-hashed URL,
which an edge keeps for a year (AGL-2798), and the spec checks that it does
not. Locally there is no edge, so the spec proves the origin half only.
The player's play beacon is gated to production surfaces and sends nothing
from a loopback page; `video-playback-beacon.spec.tsx` covers it.

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

## Launch smoke — the whole first-customer path (AGL-1514)

```bash
# emulators + a console dev server with the emulator flags (any port,
# default 4300) + a tenant server on 4500
FIRESTORE_EMULATOR_HOST=localhost:8082 \
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
  node tools/e2e/launch-smoke.e2e.mjs
```

`tools/e2e/launch-smoke.e2e.mjs` walks SIGN UP → ORG → HOST → PUBLISH →
served on the local stand-in for `*.aglyn.app`, which is the
`*.localhost:4500` branch of `apps/tenant/middleware.ts` — the same
string-strip as the `.aglyn.app` branch one case above it. Like
`seed-e2e.mjs` it refuses to run without both emulator-host vars, so it can
never be pointed at production.

Every step first breaks its own precondition and asserts the matching
refusal, so a step that quietly stopped enforcing anything goes red rather
than staying green. Results are recorded in three states — a step that could
not be run reports `INCONCLUSIVE`, never `PASS`. That matters for the ISR
assertions in particular: under `next dev` there is no incremental cache at
all, so the MISS/HIT pair only means something against a production build,
and the harness marks those inconclusive when it finds a dev server.

What it cannot exercise locally, and does not claim to: Vercel's edge,
wildcard DNS, wildcard TLS. Knobs: `SMOKE_CONSOLE_URL`, `SMOKE_TENANT_PORT`,
`SMOKE_TIMEOUT_MS`, `SMOKE_RUN_ID`, `E2E_CHROME_PATH`.

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
- The CRM (AGL-2610), from `tools/scripts/lib/crm-fixtures.mjs`: a bakery's
  wholesale book — six contacts under the `demo` facet (one with a phone
  number, custom-field values, an order history), a company, a Sales
  pipeline with a card in every open stage and a won one, a Renewals
  pipeline with one open deal, a catalog product on the host, a task due
  yesterday and one due next week, two logged activities, two custom fields,
  a dynamic audience, two unworked leads on the host, and the host's two
  forms — the wholesale inquiry that routes leads and the catering inquiry
  that could. Written with plain `set` rather than
  merge, because the CRM specs mutate these and re-seed them; the owner's
  legal acceptance (`users/{uid}/legalAcceptances/v1`) is seeded beside them
  so no page opens under the re-acceptance banner.
- A workspace on Free (AGL-2809), from
  `tools/scripts/lib/crm-free-plan-fixtures.mjs`: auth user
  `e2e-free-owner@aglyn.test` / `E2e-Password-1` (uid `e2e-free-owner`,
  **no** `staff` claim), org `e2e-free-owner` (slug `e2e-free`,
  `plan: 'free'`, no subscription), site `free-demo`, three captured contacts
  and one company. Written with plain `set` and re-written by
  `crm-free-plan.e2e.mjs`, which also withdraws the erasure request it files.

## Env knobs (all optional)

| Var                          | Default                 | Meaning               |
| ---------------------------- | ----------------------- | --------------------- |
| `E2E_BASE_URL`               | `http://localhost:4200` | Console dev server    |
| `E2E_HOST`                   | `demo`                  | Host under test       |
| `E2E_EMAIL` / `E2E_PASSWORD` | seeded values           | Test account          |
| `E2E_CHROME_PATH`            | system Chrome           | Browser binary        |
| `E2E_TIMEOUT_MS`             | `45000`                 | Per-assertion timeout |
| `E2E_ARTIFACTS_DIR`          | `tmp/e2e-artifacts`     | Failure screenshots   |
| `E2E_SHOTS_DIR`              | unset                   | Staged captures (CRM) |

## Tenant render + API checks

The same emulator + seed also drive a tenant smoke pass (no separate runner
yet — curl assertions). Both firebase configs pin `emulators.logging.port`
to 4520 and `hub.port` to 4420 precisely so **port 4500 stays free**: the
tenant middleware's `localhost:4500` case then resolves the seeded host
`demo` natively, with no temporary middleware edits.

`cloud/firebase.json` — the config behind `npm run firebase:emulate`, which
is what `require-emulator.mjs` tells you to start — did not pin them until
AGL-1626, so firebase-tools' defaults (hub 4400, **logging 4500**) took the
one port the tenant needs. Nothing errored: `serve:tenant:emulated` and
`smoke:tenant:prod` came up on a port the middleware does not recognize, and
every page 307'd to `https://app.aglyn.com` via the `default` branch. If you
ever see that redirect locally, check what owns 4500 before anything else.

```bash
# emulators + seed as above, then:
npm run serve:tenant:emulated      # next dev on 4500 + emulator flags, no outbound credentials
```

What to assert (all against `http://localhost:4500`):

| Check                                            | Expect                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `/blog`, `/blog/three-day-sourdough`, `/search`  | 200, themed, `… – Demo Bakery` titles; the entry page carries a server-rendered `application/ld+json` `Article` |
| `/`                                              | 404 — the seed publishes no ROOT screen, by design                                                              |
| `/home`                                          | 200 — the seeded `seed-home` screen (its `versionId` pointer is what publishes a screen)                        |
| `/robots.txt`, `/sitemap.xml`                    | middleware rewrites into `app/api/robots` / `app/api/sitemap` (text/plain + xml)                                |
| `/api/screen?host=demo`                          | 200 with the `{status, statusCode, data}` JSON envelope                                                         |
| `/api/collections-rss?host=demo&collection=blog` | 200 RSS — `host` also accepts `demo.aglyn.app` / a custom domain (AGL-1385)                                      |
| `/blog/rss.xml`                                  | 200 RSS — middleware rewrites into `app/api/collections-rss` with the resolved host (AGL-1385)                   |
| `/api/bookings/slots?hostId=demo`                | 200 seeded service — proves the `[...pluginApi]` dispatcher → adapter → unchanged plugin handler chain          |
| `/api/anything-unregistered`                     | 404                                                                                                             |
| `POST /api/analytics/collect`                    | 204                                                                                                             |

## A second checkout, when the main one is busy (AGL-931)

The console dev server binds one port and one `.next`, so capturing screenshots or running
emulator e2e while the main checkout is already serving needs a second checkout rather than a
second server in the same one. Two dev servers sharing `apps/console/.next` fight over it.

```bash
node tools/scripts/new-worktree.mjs shots            # → ../aglyn-wt-shots, console on 4300
node tools/scripts/new-worktree.mjs api --app=tenant # → ../aglyn-wt-api, tenant on 4600
```

It creates the worktree, clones `node_modules`, copies the gitignored env files, regenerates
`tsconfig.next.json`, and prunes the main checkout's Next cache first. Each of those is a step
somebody had already got wrong:

- `node_modules` is **cloned with `cp -Rc`, never symlinked** — a symlink breaks turbopack's
  module resolution and surfaces as unrelated build errors. On APFS the clone is copy-on-write.
- The **env files are gitignored**, so `git worktree add` does not bring them. Without them the
  worktree boots and then throws `FirebaseError: Firebase: Error (auth/invalid-api-key)` at the
  sign-in page, which reads like bad credentials rather than a missing file.
- `tsconfig.next.json` is generated, not committed.

**Serve with `nx serve` or a `serve:*:emulated` script, never a bare `next dev`.** Both carry the
cache prune (`docs/BUILD_PERFORMANCE.md`), and a bare `npx next dev` is how the last worktree
quietly grew a 6 GB cache nothing was ever going to clean. The script prints the right commands
when it finishes.

Against the emulators, serve from the worktree with
`npm run serve:console:emulated -- --port 4210`. It starts `next dev` itself rather than through
nx, so the second-instance refusal `nx serve` gives while the main checkout is serving does not
apply, and it holds no production credential. A bare `npx next dev apps/console -p 4210` holds
every key the env files carry, and the DAM spec refuses it. The script runs on **turbopack, not
`--webpack`**, the only bundler that works here: the webpack build follows `instrumentation.ts`'s
deferred import into the edge bundle and dies on `import 'crypto'`, so every page 500s with
`Module not found: Can't resolve 'crypto'`. Turbopack, in turn, refuses a `node_modules` that is a
symlink out of the project root (`Symlink [project]/node_modules is invalid`), which is the clone
rule above with an error message attached.

Tear down with `git worktree remove --force <path>` — worktrees are cheap to recreate and a
stale one keeps a whole `node_modules` and `.next` on disk.

## Docs screenshots

`tools/e2e/capture-docs-screenshots.mjs` reuses the same stack to capture
the docs site's console screenshots (1440×900 PNGs straight into
`apps/docs/static/img/…`), stripping the emulator banner and dev overlay.
Re-run it after UI changes so the docs never drift:

```bash
E2E_BASE_URL=http://localhost:4200 node tools/e2e/capture-docs-screenshots.mjs
```

A shot whose surface ships behind a release flag that is off by default names
that flag in `orgReleaseFlags`, and the harness writes it as a per-org override
on the seeded org for that one shot, then restores the org. That is a Firestore
write, so such a shot also needs `FIRESTORE_EMULATOR_HOST` — and
`FIREBASE_PROJECT_ID`, if the seed was given one — set to what the seed ran
with, which is not the defaults whenever `emulator-config.mjs` moved the ports.

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

## Clearing the service worker (AGL-1053)

The console registers `/sw.js` **in production builds only** — `next dev` skips
it deliberately. So you will only meet this after running `console-prod` /
`console-prod-alt`, and it is worth knowing before it confuses you.

A registered worker **outlives the server that registered it**. It is scoped to
the origin, not the project, so one registered on `localhost:4200` stays
registered against whatever you serve on that port next — including a different
app entirely.

Today's worker caches nothing and has no `fetch` handler, so a stale one is
harmless. That stops being true at AGL-1054, which is exactly why the teardown
belongs here now rather than after the first confusing afternoon.

From the page's console:

```js
// Unregister every worker for this origin, then hard-reload.
const regs = await navigator.serviceWorker.getRegistrations()
await Promise.all(regs.map((r) => r.unregister()))
// Caches are separate from registration — a worker can go while its caches stay.
const keys = await caches.keys()
await Promise.all(keys.map((k) => caches.delete(k)))
location.reload()
```

Or in DevTools: **Application → Service workers → Unregister**, then
**Application → Storage → Clear site data**. The Clear-site-data button covers
caches and IndexedDB too — note that also drops the Firebase auth session, so
you will be signed out.

To confirm you are clean, `navigator.serviceWorker.getRegistrations()` should
resolve to `[]`.
