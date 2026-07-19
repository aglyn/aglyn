# Vercel deployments

Four Vercel projects on the `zach-govers-projects` (Hobby) team deploy from this repo, all connected
to the `zgover/core` fork:

| Project | Root directory | App |
| --- | --- | --- |
| `app-aglyn-io` | `.` (repo root) | `apps/console` |
| `tenant-aglyn-app` | `.` (repo root) | `apps/tenant` |
| `www-aglyn-io` | `.` (repo root) | `apps/www` |
| `docs-aglyn-io` | `apps/docs` | `apps/docs` |

## Only the `production` branch deploys (AGL-522)

Deployments are created **only for pushes to `production`**. Every other branch — `main` included —
creates no Vercel deployment at all.

This is enforced with `git.deploymentEnabled` in `vercel.json` (root `/vercel.json` for
console/tenant/www, `apps/docs/vercel.json` for docs). The rules use minimatch patterns; a branch
matching any `true` rule deploys:

```json
{
  "git": {
    "deploymentEnabled": {
      "production": true,
      "**": false,
      "*": false,
      "*/**": false
    }
  }
}
```

Why not the dashboard "Ignored Build Step": it cancels builds *after* the deployment is created, and
created-then-canceled deployments still count toward the Hobby plan's **100 deployments/day** limit.
With 4 projects, ~25 pushes exhausted the cap and blocked real production deploys, which is what
prompted AGL-522. `git.deploymentEnabled` is evaluated from the pushed commit's `vercel.json` before
a deployment is created, so skipped branches cost nothing.

Notes:

- The config is read from the pushed commit, so branches cut before this landed still create
  (and cancel) deployments until they rebase onto a main that has it. The dashboard Ignored Build
  Step is kept as a backstop for those.
- To deploy: merge `main` → `production` (only when explicitly releasing). A push to `production`
  builds all four projects as production deployments.
- One-off deploys without a push: create a deployment from a Git reference in the Vercel dashboard
  (Deployments → Create Deployment), or `vercel deploy` from the CLI.

## After every production promote: verify the aliases (AGL-542)

The tenant wildcard (`*.aglyn.app`) has repeatedly stayed aliased to a stale deployment after a
promote — usually because a tenant-scoped `vercel` command ran outside `apps/tenant` and the root
`.vercel/repo.json` (which maps every directory to `app-aglyn-io`) silently redirected it to the
console project. Verify (and repair) with:

```bash
node tools/deploy/verify-production-aliases.mjs        # verify; exit 1 if any domain is stale
node tools/deploy/verify-production-aliases.mjs --fix  # promote the newest Ready deploy when stale
```

Full runbook: `apps/docs/docs/operations/verify-production-aliases.md`.
