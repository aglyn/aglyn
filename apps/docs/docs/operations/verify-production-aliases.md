---
sidebar_position: 1
title: Verify production aliases
description: Post-release runbook — confirm app.aglyn.com and the *.aglyn.app wildcard point at the newest Ready deployment, and repair a stale alias with one command.
---

# Verify production aliases (AGL-542)

:::warning Aglyn staff only
Internal deployment runbook. Requires a `vercel` CLI login with access to the
Aglyn team scope; the script never reads or stores secrets itself.
:::

After a production promote on Vercel, the tenant wildcard domain (`*.aglyn.app`)
has repeatedly stayed aliased to a **stale** deployment instead of advancing to
the newly built one — customer sites keep serving the previous release while
`app.aglyn.com` looks fine. `tools/deploy/verify-production-aliases.mjs` makes
the check (and the repair) a single command.

**Run it after every production promote.**

```bash
node tools/deploy/verify-production-aliases.mjs          # verify only
node tools/deploy/verify-production-aliases.mjs --fix    # promote when stale
node tools/deploy/verify-production-aliases.mjs --json   # machine-readable output
```

## What it checks

| Project | Domain(s) checked |
| --- | --- |
| `aglyn-console` (console) | `app.aglyn.com` |
| `aglyn-tenant` (tenant) | `northwind-coffee.aglyn.app` (wildcard probe), `aglyn.com` (the marketing apex) |
| `aglyn-docs` (docs) | `docs.aglyn.com` |

`aglyn.com` is checked under `aglyn-tenant` because the marketing site runs on the tenant runtime —
the apex is host `aglyn-marketing` with `cname: aglyn.com`, resolved by the `default:` custom-domain
branch of the tenant middleware. It was probed against the retired `www-aglyn-io` project until
AGL-1607, which also made it structurally impossible to fail (see below). `aglyn.io` and `aglyn.app`
redirect to the apex, so probing those would test the redirect rather than the alias.

For each project it finds the newest **Ready** production deployment
(`vercel ls <project> --prod`, confirmed via `vercel inspect` — scanning past
the run of Canceled deployments the ignore-step produces on non-production
pushes), inspects each domain to see which deployment actually serves it, and
prints a verdict table: `current` or `STALE`. With `--fix` it runs
`vercel promote <newest-ready-url>` and re-verifies.

Exit codes: `0` all current, `1` at least one stale (after the fix attempt when
`--fix`), `2` operational error (CLI missing/unauthenticated, unparseable
output).

## The `repo.json` gotcha (why staleness happens)

The repo-root `.vercel/repo.json` maps **every** directory in the monorepo to
the console project `aglyn-console`, and `apps/tenant` has no link files of its
own — so any `vercel` command that relies on the *directory link* to pick the
project silently operates on the **console** project: the promote "succeeds",
but `*.aglyn.app` never moves.

The script therefore never uses directory links at all:

1. Deployments are listed by explicit project name
   (`vercel ls aglyn-tenant --prod`), which works from any directory.
2. Promotes target an explicit deployment URL, which pins the project by
   itself.
3. Every `vercel inspect` result must report the expected project `name` —
   any mismatch aborts with exit code `2` rather than trusting the wrong
   project.

The same rule applies when running `vercel` by hand: **always pass the project
name or a full deployment URL**; never trust the directory link in this repo.

## A check that could not fail (AGL-1607)

Until 2026-08-14 the apex was probed against `www-aglyn-io` with
`alwaysBuilds: false`. That combination disabled **both** guards on the one
domain carrying the whole public marketing site and every legal page:

- **The commit guard** was suppressed outright — `alwaysBuilds: false` means
  "report the SHA, never fail on it".
- **The alias guard was tautological.** When a project had no Ready deployment
  to use as a baseline (all of `www-aglyn-io`'s are Canceled), the script fell
  back to *whatever that project's own first domain was currently serving* —
  and then compared the domain against that same value. `NEWEST READY` and
  `SERVING` were the same lookup, so the rows always matched.

Measured A/B on the same deliberately-stale alias: the old script printed
`current` and exited `0`; the fixed script prints `STALE` and exits `1`.

The lesson generalises past this one entry: **`alwaysBuilds: false` must only
ever relax the commit check.** If it is ever reintroduced, it must not be able
to supply a baseline derived from the domain being checked. A verification that
returns green whether or not the thing it checks is broken is worse than no
verification, because it is trusted.

## Reading the output

```text
PROJECT        DOMAIN                      NEWEST READY            SERVING                 VERDICT
-------------  --------------------------  ----------------------  ----------------------  -------
aglyn-console  app.aglyn.com                app-aglyn-xxxx…         app-aglyn-xxxx…         current
aglyn-tenant   northwind-coffee.aglyn.app  tenant-aglyn-new…       tenant-aglyn-old…       STALE
```

A `STALE` row means the domain still serves an older deployment: re-run with
`--fix`, or run `vercel promote <newest-ready-url>` manually. `--json` prints the same
result as structured JSON on stdout (progress goes to stderr), so it can gate
CI or release automation.

Related repo docs: `docs/VERCEL_DEPLOYMENTS.md` (which branches deploy, and
why only `production` builds).
