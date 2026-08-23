---
sidebar_position: 2
title: Firewall posture
description: Internal runbook — the expected Vercel WAF posture of every project, the PUT that silently deletes managed bot protection, and the safe PATCH that repairs it.
---

# Firewall posture (AGL-2483)

:::warning Aglyn staff only
Internal infrastructure runbook. Requires a Vercel API token scoped to the
Aglyn team. The checker is **read-only** and never writes.
:::

## ⛔ Read this before you touch a firewall config by hand

**`PUT /v1/security/firewall/config` returns HTTP 200 and silently deletes
managed bot protection.**

On 2026-08-21, adding one custom rule to `aglyn-tenant` that way inserted the
rule exactly as asked and turned off bot protection for the entire project.
Every tenant site would have been left unchallenged. Nothing in the response
said so.

The mechanism is a two-step foot-gun:

1. `PUT` is a **whole-document replace** — any key you omit is deleted.
2. You are **forced** to omit `managedRules`. Sending it back verbatim, even
   byte-identical to what the API just returned, is rejected with
   `managedRules.bot_protection should NOT be valid`. The obvious
   read-modify-write loop therefore cannot work: the API refuses the only body
   that would have preserved the setting, then reads the absence it forced on
   you as an instruction to delete.

It reads as success in every way a human checks it. The rule is there, the
status is 200, the response body looks right. Only a read-back of
`managedRules` shows the damage.

### ✅ The safe write — always `PATCH`, one operation at a time

```http
PATCH /v1/security/firewall/config?projectId=<project>&teamId=<team>
Authorization: Bearer <token>

{
  "action": "managedRules.update",
  "id": "bot_protection",
  "value": { "active": true, "action": "challenge" }
}
```

`id` is **required**. Omitting it fails with

> ``Invalid request: `action` should be equal to constant``

which is a complaint about the **body shape**, not about the `action` string —
and it will send you off rewriting a value that was correct all along.

Custom rules use the same PATCH surface (`rules.insert`, `rules.update`,
`rules.remove`), so there is never a reason to reach for `PUT`.

### That same error also means "your description is too long"

`value.description` is capped at **256 characters**, and exceeding it produces
the *identical* ``Invalid request: `action` should be equal to constant`` — no
mention of `description`, and no mention of a length. Measured 2026-08-23: 250
characters validates, 260 does not.

This is very likely why `rules.insert` was written off as "also fails this way"
when the console rules first went in, and why a `PUT` was reached for instead.
`rules.insert` works fine; the description was just too long.

### Validating a rule body without writing anything

Send it as `rules.update` against an id that does not exist. The schema is
checked **before** the lookup:

| Response | Meaning |
| --- | --- |
| `404 Rule not found: …` | the body shape is **valid** |
| ``400 `action` should be equal to constant`` | the body shape is **invalid** |

That is a dry run against the real validator with no chance of leaving a
half-built rule behind — better than inserting a probe rule and deleting it,
because the delete can fail.

## Running the check

```bash
npm run check:firewall-posture             # verify
npm run check:firewall-posture -- --strict # known gaps also fail
npm run check:firewall-posture -- --json   # machine-readable
```

Locally it uses your `vercel` CLI login. In CI it requires the `VERCEL_TOKEN`
repo secret and refuses the CLI fallback, so a CI run can only ever
authenticate with the secret.

**Exit codes:** `0` posture matches · `1` drift · `2` could not check (no
token, an API refusal, or a malformed posture table). There is no
`--fix`: a firewall is not something a scheduled job should reach in and edit,
and the repair above is one line a human should run with the blast radius in
front of them.

`.github/workflows/firewall-drift.yml` runs it daily.

## What is asserted

Expected posture is **declared as data** at the top of
`tools/scripts/lib/firewall-posture.mjs`. Adding a project or a bypass rule is
an edit to that table, never to the logic.

Per project:

| Assertion | Why |
| --- | --- |
| `firewallEnabled` is `true` | otherwise every rule below is inert |
| `managedRules.bot_protection` is `{active: true, action: "challenge"}` | the setting the `PUT` deletes |
| every declared bypass rule is present | a missing probe rule turns uptime-probe.yml into a false outage |
| every declared bypass rule is **still scoped** | see below |
| no **undeclared** bypass rule exists | an undeclared hole is an unreviewed hole |

### Why scope, not just presence

A bypass rule is a hole punched through bot protection. The safety property is
not "the rule is still there" — it is "the rule is still **narrow**".

The plugin job runner rule is the sharp case. It is scoped to the path
`/api/plugins/run-jobs` **and** the presence of the `x-plugin-jobs-secret`
header. Drop the header condition and it decays to path-only, leaving an
unauthenticated job-runner endpoint reachable by anything on the internet —
while still passing any check that merely counts rules by name.

`conditionGroup` entries are **OR'd**. So a rule can be re-opened without
touching the existing group at all, simply by appending a second, looser one.
The checker therefore requires **every** group to carry **every** required
condition.

### Secrets

The probe rule matches on a shared-secret header value, and the API returns
that value in the config. It is asserted as *non-empty*, never literally, and
redacted in all output. This repository is public and Actions logs on a public
repo are world-readable.

## Current posture

Measured 2026-08-23.

| Project | Serves | Posture |
| --- | --- | --- |
| `aglyn-tenant` | every customer site on `*.aglyn.app` + custom domains | ✅ protected — challenge, 3 scoped bypass rules |
| `aglyn-docs` | `docs.aglyn.com` | ✅ protected — challenge, 1 scoped bypass rule |
| `aglyn-console` | `app.aglyn.com` — sign-in, billing, staff surfaces | ✅ protected — challenge, 3 scoped bypass rules |
| `aglyn-plugins` | `plugins.aglyn.com` — plugin loader origin | ⚠️ **no WAF config** — reviewed, deliberate |

### How the console was closed, and why the order mattered

The console had **no WAF config and never had one**: a scripted `User-Agent`
reached sign-in and billing with a plain **200 and no `x-vercel-mitigated`
header**, while the *marketing* site answered the identical request with **429 +
`x-vercel-mitigated: challenge`**. The protection was on backwards.

It was closed on 2026-08-21 in two steps, and the order is the whole lesson:

1. **The bypass rules went in FIRST**, while nothing was being challenged yet —
   the probe header, plus one `Machine traffic bypass` covering Stripe's
   webhook, the ten `CRON_SECRET` jobs and the `/api/health` prefix.
2. **Bot protection was enabled second**, via `PATCH managedRules.update`.

Enabling first would have challenged Stripe's webhook and every scheduled job —
silently breaking billing and re-firing every uptime alert. Because the config
PUT wipes managed rules (see above), doing rules-then-protection is also the
only ordering that does not need a repair step.

Verified in **both** directions rather than one: a request carrying the
machine-traffic path with a deliberately wrong secret reached the app and was
refused **401** (the challenge was bypassed, authentication was not), and an
ordinary console route answered the same client **429**. A single request that
merely succeeds proves only half of that.

### Protecting the console broke the plugin loader

Two days after the console was closed, sandbox-tier plugin rendering was found
broken on every site using a **verified custom domain** — and nothing had
noticed, because the failure surfaces as a blank iframe with the reason only in
a browser console log.

**It was latent, not an active outage**, and the distinction is worth keeping
straight. Checked on 2026-08-23: every *code* plugin with a live install (the
versions carrying `hostAbi`) is `trust: "realm"`, and realm bundles run in the
app realm — they never touch this iframe or its CSP. No published version
declares a `capabilities.network` origin either. So both consequences were
loaded and pointed, with nothing yet standing in front of them: the first
sandbox-tier install on a custom domain, or the first plugin to declare a
network origin, would have hit it — and would have looked like a plugin bug,
not a firewall one.

`tools/plugin-loader/origin/api/load.mjs` builds the sandbox document's CSP
from two **public, unauthenticated, read-only** console endpoints, fetched
**server-side from inside its own serverless function**:

| Endpoint | Feeds |
| --- | --- |
| `/api/marketplace/listing-versions` | the plugin's declared `connect-src` origins |
| `/api/plugin-host-origins/{hostId}` | the framing site's verified custom domain, for `frame-ancestors` |

A function's `fetch` has no browser to solve a challenge, and it must not be
given the probe token — that token is scoped to *our own scripts*, and
production infrastructure should not borrow it. So both calls got a **429
checkpoint**, the loader folded them to `null`, and took its fail-strict path.

Failing closed is the right design, but the second consequence is an **outage,
not a degradation**: with no extra ancestor, `frame-ancestors` omits the
customer's own domain and the browser refuses the iframe outright.

Repaired on 2026-08-23 with a third bypass rule, `Plugin loader control plane
bypass` — one `path eq /api/marketplace/listing-versions` group and one
`path pre /api/plugin-host-origins` group. `eq` on the first is deliberate:
`pre` would also admit `/api/marketplace/listing-versions-*`. Both endpoints
are public and read-only, and the publisher view (`?scope=publisher`) verifies
its own Firebase ID token and **401s** without one — so this bypasses the bot
challenge and nothing else.

Measured before and after on host `DXnRbPH4CQ` (cname `aglyn.com`):

```text
before  frame-ancestors https://app.aglyn.com https://*.aglyn.app
after   frame-ancestors https://app.aglyn.com https://*.aglyn.app https://aglyn.com
```

…and a host id with **no** custom domain still gains nothing, so the difference
is the lookup succeeding rather than a blanket widening. Both directions were
checked: `/api/marketplace/publish`, `/api/marketplace/listing-versions-x` and
an ordinary console route all still answer **429**.

**The general lesson:** when you enable bot protection, enumerate the callers
that are *your own server-side code fetching your own public endpoints*. They
look like third-party bots to the WAF, they cannot solve a challenge, and their
failure is silent.

### How the tenant health checks were unblocked

The same enablement left **four GCP uptime checks at 0% for three days** —
`tenant-health`, `beacon-heartbeat tenant`, `marketing-home` and
`customer-site`, all on `aglyn-tenant`, all answered with a **429 Vercel
Security Checkpoint**. The two existing bypass rules are keyed on headers GCP
cannot be made to send, and the probe token is deliberately scoped to our own
scripts rather than handed to a third-party monitor.

Fixed on 2026-08-23 (AGL-2486) with a third tenant rule, `Health endpoint
bypass` — a single `path pre /api/health` group. A **path-only** bypass is
right here and wrong for the job runner alongside it: `/api/health` and
`/api/health/error-beacon` are public by design, take no auth, read no session
and answer codes rather than messages, so a challenge protects nothing and
breaks the only thing watching. `pre` rather than `eq` because the beacon
heartbeat is a subpath. Needing no shared secret, it also fixes the endpoints
for any monitor chosen later.

Both directions were checked, anonymous `Monitor/1.0`:

```text
/api/health               200   challenge bypassed
/api/health/error-beacon  200   challenge bypassed
/                         429   the page challenge still stands
```

That last line is the point: `marketing-home` and `customer-site` probe **real
pages**, so a path rule does not reach them and the challenge there is still
doing real work. They need Google's checker IP ranges allowlisted
(`gcloud monitoring uptime list-ips`) — see `docs/UPTIME_AND_SLA.md`.

Because `pre` is a prefix, this rule stays exactly as narrow as the
`/api/health` namespace is kept: any privileged route added under it would be
unchallenged from the day it shipped.

### The remaining gap: `aglyn-plugins` — reviewed, and deliberately open

`GET /v1/security/firewall/config/active` still answers **404** for it, and a
404 means *no config has ever been created* — **not** "a default posture
applies". `GET /v1/security/firewall/config` returns
`{"active":null,"draft":null,"versions":[]}`: zero versions, ever.

Reviewed on 2026-08-23. **This is not a confidentiality or integrity exposure.**
The origin serves exactly two things, and `/` is a 404:

- `GET /load` — the sandbox HTML shell plus a per-request CSP. No secrets, no
  user data, no auth, no session; its whole content ships in this repo.
- `GET /artifacts/*` — an edge rewrite to the console's
  `/api/plugin-artifacts/*`, streaming content-addressed plugin bundles.

| Risk | Verdict |
| --- | --- |
| **Confidentiality** | Nothing to leak. Bundles are deliberately public code; a URL needs the exact sha256, and anyone entitled to the listing already has it. |
| **Integrity** | Not a WAF's job here. Every loader re-hashes the bundle against the pinned sha256 before executing a byte, realm bundles carry a platform Ed25519 signature, the iframe owns its own sandbox attribute, and the CSP is per-manifest. The real integrity risk is a malicious plugin being **published**, which review answers. |
| **Cost / availability** | **The real exposure.** `/load` is `Cache-Control: private, no-store`, so every request is a function invocation plus up to two console calls — an unauthenticated, uncacheable ~3× amplifier. That is a bill, not a breach. |

**A challenge is ruled out on the merits, not deferred.** `/load` is fetched by
visitors to customer sites and by the plugin iframe itself — traffic Aglyn
neither controls nor can hand a bypass header. A challenge there breaks live
customer sites, which is far worse than the gap.

If abuse ever appears, in order of proportionality:

1. **Make `/load` cacheable.** It is a pure function of its query string; an
   `s-maxage` would let the CDN absorb a flood for free. Bigger win than any
   firewall rule, and the only one that also cuts steady-state cost.
2. A Vercel **rate-limit** custom rule on `/load` keyed by IP, generous enough
   that a real visitor never meets it.
3. Managed bot protection with action **`log`**, for visibility only.

Never `challenge`, never `deny`.

It stays declared in the posture table as `expect: 'unprotected'` with that
rationale, so it is reported as a loud `GAP` on every run and fails under
`--strict`. It is still asserted: if it quietly *gains* a config, the run
**fails**, so the table can never silently describe a fiction.

## Guarding the guard

`npm run test:firewall-posture` runs 48 cases, each damaging exactly one thing
in a known-good config and asserting the **specific** finding — not merely that
the result is false. A test that only checks `ok === false` passes just as
happily when the detector has collapsed into `return false`.

To exercise the checker end to end against a doctored config **without touching
the real firewall**, hand it a fixture:

```bash
npm run check:firewall-posture -- --fixture=/tmp/doctored.json
```

The fixture is `{ "<project>": <config> | null }`, with `null` modelling "no
config exists". Every project in the table must have an entry, so a fixture
cannot silently skip one.
