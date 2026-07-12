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
- Per-org settings: `getPluginConfig(orgId, pluginId)` returns your
  declared defaults merged with the workspace's overrides.

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
  handler: async () => { /* bounded, idempotent */ },
})
```

The deployment's scheduler POSTs `/api/plugins/run-jobs` with the
`x-plugin-jobs-secret` header (`PLUGIN_JOBS_SECRET`); due jobs run
error-isolated, and last-run marks persist across cold starts. Keep
handlers bounded (limits, no unbounded scans) — they share the API
process.

## Troubleshooting

- **404 on your route**: path prefix not in `apiPrefixes`, plugin disabled
  for the target workspace, or its release flag is off (staff bearer
  tokens bypass for preview).
- **Webhook signature failures**: you parsed `body` instead of verifying
  `rawBody`.
- **Job never runs**: `PLUGIN_JOBS_SECRET` unset (route 501s) or the
  scheduler isn't POSTing; the route's response lists every registered
  job and what ran.
