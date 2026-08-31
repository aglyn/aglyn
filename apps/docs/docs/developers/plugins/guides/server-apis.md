---
sidebar_position: 3
title: "Guide: server APIs, webhooks & jobs"
description: Plugin API routes behind the dispatchers, Stripe/Svix signature verification, billing hooks, and scheduled jobs.
---

# Server APIs, webhooks & jobs

Everything here lives on your plugin's **`/server` entry** and runs inside
the apps' `[...pluginApi]` dispatchers.

## An API route

```ts
import { registerPluginApiRoute } from '@aglyn/aglyn/server'

export function registerMyPluginApi(): void {
  registerPluginApiRoute('my-plugin/ping', async (req, res) =>
    res.status(200).json({ ok: true }),
  )
}
```

- Served at `/api/my-plugin/ping` on the app(s) whose manifest lists your
  register fn (`tenantApi`, `consoleApi`, or both). Declare
  `apiPrefixes: ["my-plugin"]` in `plugins.config.json`.
- **Gating is automatic**: requests carrying a `hostId` (query or JSON
  body) 404 when the target workspace has your plugin disabled or its
  release flag is off. Handlers still self-check entitlements
  (`checkEntitlement`/`checkQuota` with the org doc) for plan gating.
- Settings: `getPluginConfig(orgId, pluginId, { hostId })` returns your
  declared defaults merged with the workspace's values and then the site's
  overrides. **Pass `hostId` whenever the request has one** — without it the
  site's override is silently ignored while the console still shows it. See
  [Plugin configuration](../reference/plugin-config.md).

## Webhooks with signature verification

`PluginApiRequest.rawBody` carries the unparsed payload:

```ts
registerPluginApiRoute('my-plugin/webhook', async (req, res) => {
  const event = verifySignature(req.rawBody ?? '', req.headers)
  // …
})
```

## Platform billing events

```ts
registerBillingWebhookHandler('checkout.session', async (event) => { … })
```

Your handler receives the platform's Stripe events (with `requestHost`
for callback URLs). **Throwing propagates to a 500 and Stripe redelivers**
— write idempotent handlers.

## Scheduled jobs

```ts
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'nightly-cleanup',
  intervalMinutes: 24 * 60,
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    for (const row of await dueRows()) {
      // Skip a locked site — and leave its row untouched.
      if (await gate.isLocked(row.hostId)) continue
      /* bounded, idempotent */
    }
  },
})
```

The deployment's scheduler POSTs `/api/plugins/run-jobs` with the
`x-plugin-jobs-secret` header (`PLUGIN_JOBS_SECRET`); due jobs run
error-isolated, and last-run marks persist across cold starts. Keep
handlers bounded (limits, no unbounded scans) — they share the API
process.

### Lockdown — `lockdown` is required

A job runs on **platform credentials** with no visitor, no session and no
org, so none of the gates that cover the request paths are anywhere near
it. A site can be locked for maintenance, non-payment, abuse or a legal
takedown, and a beat that kept emailing its customers or moving its stock
would be acting for a site the platform has taken off the air.

So every registration declares what it touches, and the runner injects the
verdict:

| `lockdown` | Means | The runner hands your handler |
| -- | -- | -- |
| `{ scope: 'per-host' }` | The job acts for sites. | A working gate — **ask it for every host you touch**. |
| `{ scope: 'platform', reason: '…' }` | Nothing a lock could be about. | A gate that **throws** if asked, so a wrong declaration fails loudly. |

Two rules the platform's own jobs follow, and yours should:

- **Take the gate you are given.** Calling `pluginJobHostGate()` yourself
  works at runtime but is refused by the coverage guard: a job free to mint
  its own gate is free to declare `platform` and never meet the check that
  the declaration is true. (The `x-cron-secret` doors that drive a pass by
  hand are the exception — they have no runner to hand them one.)
- **Skip, do not drop.** A lockdown is a pause, not a cancellation. Leave
  the row exactly as it was — unstamped, undeleted, its retry count
  untouched — so the work lands on the first beat after the lift.

## Troubleshooting

- **404 on your route**: path prefix not in `apiPrefixes`, plugin disabled
  for the target workspace, or its release flag is off (staff bearer
  tokens bypass for preview).
- **Webhook signature failures**: you parsed `body` instead of verifying
  `rawBody`.
- **Job never runs**: `PLUGIN_JOBS_SECRET` unset (route 501s) or the
  scheduler isn't POSTing; the route's response lists every registered
  job and what ran.
