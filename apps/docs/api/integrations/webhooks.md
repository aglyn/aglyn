---
sidebar_position: 1
title: Webhooks
description: Receive events from Aglyn, or trigger Aglyn workflows from your own systems.
---

# Webhooks

Where the [REST API](/api) is for reading and writing data on demand,
webhooks are for **events** — Aglyn calling your system when something happens,
or your system calling Aglyn to run a workflow. Both are configured under a
site's [Automation](/marketing-and-automation/workflows-and-actions/webhooks),
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

### Events and payloads

`event` is the name of the event the step's action was triggered on, and `payload` is
that event's payload, verbatim — the same keys a filter or a condition on the action can
read. Every value is a string, a number or a boolean, and every optional key is present
(empty rather than missing), so a receiver can branch on a key without first checking
whether it exists.

The CRM events, and the capture event that precedes them:

| `event` | Fires when | `payload` keys |
| --- | --- | --- |
| `lead` | A site captures a lead — a member sign-up. | `email` · `source` · `leadId` — the id to read the lead back with, over [`/v1/leads/{leadId}`](../resources/leads.md) (empty when the address could not be keyed). |
| `contactCreated` | A capture makes a **new** contact; a repeat visit by somebody already on the list does not fire it. | `contactId` · `email` · `name` · `source` · `hostId` · `lifecycleStage` · `campaignIds` (present only when the capture came through a campaign) |
| `contactStageChanged` | A contact's lifecycle stage is moved — from the console, a `PATCH` on [`/v1/contacts`](../resources/contacts.md), or an automation step. | `contactId` · `email` · `lifecycleStage` · `previousStage` |
| `dealStageChanged` | A [deal](../resources/deals.md) moves between open stages, or is reopened. | `dealId` · `title` · `amountCents` · `currency` · `stageId` · `previousStageId` · `ownerUid` · `contactId` · `companyId` |
| `dealWon` | A deal is marked won. | The same keys as `dealStageChanged`. |
| `dealLost` | A deal is marked lost. | The same keys as `dealStageChanged`, plus `lostReason`. |
| `taskCompleted` | A [task](../resources/tasks.md) is marked done; reopening fires nothing. | `taskId` · `title` · `kind` · `priority` · `dueAtMs` · `completedAtMs` · `completedByUid` · `assigneeUid` · `createdByUid` · `contactId` · `companyId` · `dealId` · `taskHostId` |

Every event reaches the webhook step the same way — nothing filters by name on the way
there — so an action on any of these with a webhook step delivers it. The ids are the
ones the REST API takes: follow `contactId`, `dealId`, `taskId` or `leadId` to the
matching resource to read the full record. The complete table, including the
non-CRM events (`formSubmission`, `booking`, `memberSignUp`, `pageView`) and what an
action can do with each, is on the
[actions builder](/marketing-and-automation/workflows-and-actions/actions-builder) page.

```json
{
  "event": "dealWon",
  "payload": {
    "dealId": "d_3c9a",
    "title": "Acme — first order",
    "amountCents": 12500,
    "currency": "usd",
    "stageId": "won",
    "previousStageId": "negotiation",
    "ownerUid": "u_9f1c",
    "contactId": "k7d2b9f104",
    "companyId": "co_8b1e"
  },
  "sentAt": "2026-09-05T18:00:00.000Z"
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
  your site (a form submission, a booking, a new member, a lead, a deal won).
- Reach for **inbound webhooks** to let an external system kick off an Aglyn
  workflow.
