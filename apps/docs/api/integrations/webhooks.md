---
sidebar_position: 1
title: Webhooks
description: Receive events from Aglyn, or trigger Aglyn workflows from your own systems.
---

# Webhooks

Where the [REST API](/api) is for reading and writing data on demand,
webhooks are for **events** — Aglyn calling your system when something happens,
or your system calling Aglyn to run a workflow. Both are configured under a
site's [Workflows & Actions](/marketing-and-automation/workflows-and-actions/webhooks),
and both are a **Business**-plan feature.

## Outbound (Aglyn → your system)

A workflow or action's **webhook** step sends a `POST` to a URL you configure:

```http
POST https://your-server.example.com/hooks/aglyn
Content-Type: application/json
X-Aglyn-Signature: <hex HMAC-SHA256 of the raw body>

{ "event": "formSubmission", "payload": { … }, "sentAt": "2026-07-20T18:00:00.000Z" }
```

- If you set a signing secret, Aglyn adds an **`X-Aglyn-Signature`** header —
  the HMAC-SHA256 of the raw request body, hex-encoded. Verify it before
  trusting the payload.
- Delivery is retried up to 3 times with backoff; each attempt times out after
  5 seconds. Only `https` URLs are allowed.

### Verifying the signature

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, signature, secret) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

## Inbound (your system → Aglyn)

An **inbound** webhook gives you a URL that runs one of your site's workflows
when called:

```http
POST https://{your-site}/api/hooks/{hostId}/{hookId}
x-aglyn-secret: <the shared secret you configured>
Content-Type: application/json

{ "orderId": "1234", "status": "paid" }
```

- Authenticate with the **`x-aglyn-secret`** header (a shared secret set when
  you create the hook). A mismatch returns `401`.
- Top-level JSON values (strings, numbers, booleans) become variables in the
  workflow's scope, so your workflow steps can reference them.
- The console shows each inbound hook's full URL under the site's webhooks card.

## When to use which

- Reach for the **REST API** to fetch or change data yourself, on your schedule.
- Reach for **outbound webhooks** to be notified the moment something happens on
  your site (a form submission, a booking, a new member).
- Reach for **inbound webhooks** to let an external system kick off an Aglyn
  workflow.
