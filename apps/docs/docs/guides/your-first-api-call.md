---
sidebar_position: 7
title: Your first API call
description: Create an API key in the console, make your first request, read the response, handle the four errors you will actually hit, and page through a whole dataset.
---

# Your first API call

By the end of this page you'll have made a real request to your own data and
handled the errors properly. It assumes **nothing** — if you've never used an API
before, start at the top and follow along; if you have, skip to
[Step 3](#step-3-your-first-request) and then read
[the API reference](/api/) instead of the rest of this.

Everything here uses `curl`, which is already installed on macOS and Linux and ships
with Windows 10 and later. There's a JavaScript version of each step underneath.

:::info What you need
- An organization on a plan that **includes API access** (Business or Advanced).
- Permission to manage the organization — only **owners and admins** can create keys.
- A terminal.
:::

## Step 1 — Create an API key {#step-1-create-a-key}

1. Open the console and switch to the organization you want to use.
2. Go to **Organization → Settings**, and find the **API keys** card.
3. Choose **Create API key**.
4. Give it a **name** that says what it's for — `zapier-orders-sync`, not `key 1`. The
   name is what you'll be looking at in six months deciding whether it's safe to
   revoke.
5. Select its **scopes**. A scope is one permission. Grant the fewest that do the job:
   for this walkthrough, tick **Datasets — read**.
6. Choose **Create**.

**Copy the key now.** It's shown exactly once. Aglyn stores only a hash of it and
genuinely cannot show it to you again — if you lose it, the fix is to revoke it and
make a new one, which costs you nothing but a minute.

A key looks like this:

```
aglyn_sk_live_9dK2x...
```

:::danger Treat it like a password
The key carries your **organization's** access, not your personal login. Anyone
holding it can do everything its scopes allow.

- Never commit it to git. Put it in an environment variable or a secrets manager.
- Never put it in a web page, a mobile app, or anything a browser downloads — a key in
  client-side JavaScript is a public key.
- Use **one key per integration**, so you can revoke one without breaking the others.
:::

Store it in your shell for the rest of this page:

```bash
export AGLYN_API_KEY="aglyn_sk_live_9dK2x..."
```

## Step 2 — Check that the key works {#step-2-check-the-key}

Before writing anything real, confirm the key is valid and see what it can do:

```bash
curl https://app.aglyn.com/api/v1/me \
  -H "Authorization: Bearer $AGLYN_API_KEY"
```

```json
{
  "object": "api_key",
  "org": "org_abc123",
  "scopes": ["datasets:read"]
}
```

That's the whole handshake. `Authorization: Bearer <key>` is how **every** request
authenticates — there is no login step, no token exchange, no session.

If you get something else, jump to [errors](#the-four-errors-you-will-hit).

:::tip Do this at startup in real code
`GET /v1/me` is the cheapest way to fail fast with a clear message. An integration
that checks its key on boot tells you "the key is wrong" at deploy time instead of
"undefined is not a function" at 3am.
:::

## Step 3 — Your first request {#step-3-your-first-request}

List your organization's datasets:

```bash
curl https://app.aglyn.com/api/v1/datasets \
  -H "Authorization: Bearer $AGLYN_API_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "ds_signups",
      "object": "dataset",
      "name": "Newsletter signups",
      "fields": [ /* … */ ],
      "created": "2026-04-02T10:15:00.000Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

Three things to notice, because they're the same on every list endpoint:

- **`data`** holds the results. Always an array, even with one result.
- **`has_more`** tells you whether there's another page. **This is the only reliable
  end-of-list signal** — see [step 5](#step-5-page-through-everything).
- **`object`** on each item names its type. Handy when you're logging.

Now read records out of one of those datasets, using its `id`:

```bash
curl "https://app.aglyn.com/api/v1/datasets/ds_signups/records?limit=5" \
  -H "Authorization: Bearer $AGLYN_API_KEY"
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "k3f9a1c7be",
      "object": "record",
      "values": { "email": "avery@example.com", "source": "footer" },
      "created": "2026-08-01T09:00:00.000Z",
      "updated": "2026-08-01T09:00:00.000Z"
    }
  ],
  "next_cursor": "azNmOWExYzdiZQ",
  "has_more": true
}
```

Your data lives in `values`, keyed by **field id** — which is not the same as the
display name you see in the console. `Email address` in the console is `email` here.
The dataset's `fields` array tells you the mapping.

### In JavaScript

```js
const KEY = process.env.AGLYN_API_KEY

async function aglyn(path) {
  const res = await fetch(`https://app.aglyn.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) {
    const { error } = await res.json()
    throw new Error(`${error.type}: ${error.message}`)
  }
  return res.json()
}

const { data } = await aglyn('/datasets/ds_signups/records?limit=5')
console.log(data)
```

Read the error body before throwing. `error.type` is a stable machine-readable string;
`error.message` is a sentence for a human. Branch on `type`, log `message`.

## Step 4 — Write something {#step-4-write-something}

Writes need a **write** scope. Go back to the console, create a second key with
**Datasets — write**, or add the scope when you create the key. Scopes have no
hierarchy: `datasets:write` does **not** include `datasets:read`. A key that writes a
record and then reads it back needs both, ticked separately.

```bash
curl -X POST https://app.aglyn.com/api/v1/datasets/ds_signups/records \
  -H "Authorization: Bearer $AGLYN_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"values": {"email": "new@example.com", "source": "api"}}'
```

A new record returns **`201`**.

### About that `Idempotency-Key` {#idempotency}

It's the header that makes retrying safe, and it is worth understanding on day one
rather than after your first duplicate.

The problem it solves: you POST, the record is created, and then your connection drops
before the response reaches you. You have no idea whether it worked. Retrying might
create a second record; not retrying might lose the first.

With an `Idempotency-Key`, retrying is simply correct. Send the **same** key and:

- if the original succeeded, you get **`200`** with the **original record** — not a
  duplicate;
- if the original failed, the key is released, so a retry genuinely re-runs;
- if the original is **still running**, you get `409 conflict` — wait and retry.

`201` means created, `200` means replayed. That's how you tell them apart.

Use a **fresh UUID per logical operation** — one key per record you intend to create,
generated before the first attempt and reused across every retry of *that* attempt.
Keys never expire, so a key really is single-use forever.

The full rules, including how it behaves on `DELETE`, are in
[Conventions → Idempotency](/api/conventions#idempotency).

## Step 5 — Page through everything {#step-5-page-through-everything}

Lists come back in pages. To get everything, follow the cursor:

```js
async function fetchAll(path) {
  const all = []
  let cursor = null
  do {
    const url = new URL(`https://app.aglyn.com/api/v1${path}`)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const page = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AGLYN_API_KEY}` },
    }).then((r) => r.json())
    all.push(...page.data)
    cursor = page.next_cursor      // the ONLY termination signal
  } while (cursor)
  return all
}
```

:::warning Two things that will bite you
**1. A short page is not the last page.** Some endpoints filter rows out after reading
a page, so `data.length` can be less than `limit` while `has_more` is still `true`.
A loop written as `while (page.data.length === limit)` stops early *and looks like it
worked*. Loop on the cursor.

**2. Page 1 is not "the newest 25".** Every list is ordered by **id**, not by date.
There is no `sort` parameter and no filter on `created`. Paging start to finish gives
you every item exactly once — that's what a full sync needs — but "give me today's
records" is not a request this API can answer. Page everything and compare `created`
yourself, or store the ids you've already handled.
:::

## The four errors you will hit {#the-four-errors-you-will-hit}

Every error has the same shape, and `type` is the field to branch on:

```json
{ "error": { "type": "not_found", "message": "No such dataset" } }
```

| You see | It means | Do this |
| --- | --- | --- |
| `401 unauthorized` | Key missing, mistyped, or revoked. | Check the header is `Authorization: Bearer aglyn_sk_…`. A common cause is a shell variable that didn't expand — `echo $AGLYN_API_KEY`. |
| `403 insufficient_scope` | The key is fine; it lacks a permission. `code` names the exact scope. | Create a key with that scope. You can't add a scope to an existing key. |
| `403 plan_required` | The organization's plan doesn't include API access — or, on commerce endpoints, doesn't include commerce (`code: "commerce"`). | Not transient. **Don't retry** — alert a human. |
| `429 rate_limited` | Over 120 requests/minute for this key. | Back off. `Retry-After` says for how long, and every response carries the remaining budget in its headers. |

Retry `429` and `500`. Never retry `401`, `403`, or `400` — nothing about them will
change on the second attempt, and a loop that retries them turns a config mistake into
a rate-limit ban.

## Where to go next

- **[API reference](/api/)** — every resource, every field, every error.
- **[Conventions](/api/conventions)** — pagination, ordering, errors, idempotency, in
  one place. Worth reading once, end to end.
- **[Rate limits & usage](/api/rate-limits)** — the 120/minute limit and how monthly
  usage bills.
- **[Webhooks](/api/integrations/webhooks)** — for reacting to events, don't poll.
  Polling a list endpoint on a timer is the most common way to hit the rate limit.

If you're syncing a store, [Orders](/api/resources/orders) and
[Products](/api/resources/products) each carry a recipes section with the whole loop
written out.

## Related

- [Datasets & schema deep-dive](./datasets-and-schema.md) — field ids, the typed model, quotas.
- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md#api-access) — which plans include the API.
