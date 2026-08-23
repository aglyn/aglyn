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

Measured 2026-08-21, after the console was closed (see below).

| Project | Serves | Posture |
| --- | --- | --- |
| `aglyn-tenant` | every customer site on `*.aglyn.app` + custom domains | ✅ protected — challenge, 2 scoped bypass rules |
| `aglyn-docs` | `docs.aglyn.com` | ✅ protected — challenge, 1 scoped bypass rule |
| `aglyn-console` | `app.aglyn.com` — sign-in, billing, staff surfaces | ✅ protected — challenge, 2 scoped bypass rules |
| `aglyn-plugins` | `plugins.aglyn.com` — plugin loader origin | ⚠️ **no WAF config, and never has had one** |

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

### The remaining gap: `aglyn-plugins`

`GET /v1/security/firewall/config/active` still answers **404** for it, and a
404 means *no config has ever been created* — **not** "a default posture
applies". `GET /v1/security/firewall/config` returns
`{"active":null,"draft":null,"versions":[]}`: zero versions, ever.

It is deliberately still open. `plugins.aglyn.com` is the plugin loader origin,
fetched by **customer sites and by the plugin iframe itself** — traffic Aglyn
does not control and cannot hand a bypass header to. A challenge there has to
be reconciled with that first.

It is declared in the posture table as `expect: 'unprotected'` with a written
rationale, so it is reported as a loud `GAP` on every run and fails under
`--strict`. It is still asserted: if it quietly *gains* a config, the run
**fails**, so the table can never silently describe a fiction.

## Guarding the guard

`npm run test:firewall-posture` runs 42 cases, each damaging exactly one thing
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
