# Email setup (Resend + aglyn.com)

How Aglyn sends outbound application email — team invites, receipts, usage
summaries, marketing campaigns, staff alerts — and how to configure it so mail
comes **from `@aglyn.com`**.

## The two-provider split (read this first)

Aglyn uses **two** email systems that do different jobs and don't conflict:

| System | Job | Sends as | Config |
| --- | --- | --- | --- |
| **Google Workspace** | Human **mailboxes** + **inbound** mail (`info@aglyn.com` inbox). Your `MX` records point here. | n/a (receiving) | Workspace admin |
| **Firebase Auth** | Auth emails only — verification, password reset. | `@aglyn.com` via `_spf.firebasemail.com` | Firebase console |
| **Resend** | Everything else the **app** sends programmatically. | `noreply@aglyn.com` | `RESEND_API_KEY` + `USAGE_EMAIL_FROM` |

Sending **from** `@aglyn.com` does **not** mean sending **through** Google.
Resend sends on your behalf and proves it's authorized with DKIM/SPF DNS
records. It only adds a `send.aglyn.com` subdomain for bounce handling — your
Google inbound MX is untouched, and your mailboxes keep working normally.

`RESEND_API_KEY` is an API key from a [Resend](https://resend.com) account.
Resend is the transactional-email provider (same category as SendGrid /
Postmark / Mailgun), chosen because it's purpose-built for app email
(SES-backed, high limits, bounce webhooks) and is already integrated across
~18 call sites. Google Workspace SMTP is **not** used for app mail — it caps at
~2,000/day and would risk locking the real mailboxes.

## Current DNS facts (aglyn.com)

- **DNS host:** Google Cloud DNS (`ns-cloud-*.googledomains.com`) — add records
  in the Google Cloud console → Network Services → Cloud DNS → `aglyn.com` zone.
- **MX:** Google Workspace. ✅ (do not change)
- **SPF:** `v=spf1 include:_spf.google.com include:_spf.firebasemail.com ~all`
  — Resend's SPF goes on the `send.` subdomain, so this root record is **not**
  edited.
- **DMARC:** `p=none` (monitoring) — permissive, so verification won't be
  blocked. Consider tightening to `p=quarantine` later, once Resend is verified.

## One-time setup

### 1. Create / open a Resend account
Go to <https://resend.com> and sign in (or sign up). This is the source of
`RESEND_API_KEY`.

### 2. Add the domain in Resend
Resend → **Domains** → **Add Domain** → enter **`aglyn.com`** (the root, so the
sender can be a bare `@aglyn.com` address). Pick the region closest to the
deployment. Resend then shows ~3 DNS records to add.

### 3. Add Resend's DNS records to Google Cloud DNS
Copy the **exact** values Resend shows. They look like this (the `send`
subdomain is Resend's return-path — it does not affect Workspace inbound mail):

| Type | Name (Cloud DNS "DNS name") | Value | Notes |
| --- | --- | --- | --- |
| `MX` | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) | bounce handling |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the send subdomain |
| `TXT` | `resend._domainkey` | `p=<long DKIM public key>` | DKIM signing |

In Cloud DNS you enter just the subdomain part as the DNS name (e.g. `send`,
`resend._domainkey`) — it appends `.aglyn.com` automatically. Paste long DKIM
values as a single string; Cloud DNS handles the 255-char chunking.

Do **not** touch the existing root `MX`, root `SPF`, or `_dmarc` records.

### 4. Verify
Back in Resend → Domains → **Verify**. Google Cloud DNS usually propagates in a
few minutes. Wait for the domain to show **Verified**.

### 5. Create an API key
Resend → **API Keys** → **Create** → permission **Sending access**, scoped to
the `aglyn.com` domain. Copy the key (`re_...`) — it's shown once.

### 6. Set the env vars

**Local** (`apps/console/.env.development.local`):
```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
USAGE_EMAIL_FROM="Aglyn <noreply@aglyn.com>"
STAFF_ALERT_EMAIL=you@aglyn.com   # optional
```

**Production (Vercel):** add the same two vars. Multiple apps send email (the
**console** app and the **tenant** app via plugins — commerce, bookings,
marketing, workflows). The cleanest way is a **Team-level (shared) Environment
Variable** in Vercel so every project inherits it:

- Vercel → Team **Settings** → **Environment Variables** (shared), add
  `RESEND_API_KEY` and `USAGE_EMAIL_FROM`, linked to the console + tenant
  projects, for Production (and Preview if you want previews to send).
- ⚠️ Gotcha: `vercel env ls` and the project env API **omit** team-level shared
  vars — so after adding them, don't trust `vercel env ls` showing them as
  "missing." Verify in the Team Settings UI, or run
  `vercel env pull` and inspect the **resolved** result. Redeploy for the
  change to take.

### ⚠️ Two things the Vercel Resend integration does not do

Installing the Resend integration from the Vercel marketplace sets
`RESEND_API_KEY` — and that is *all* it does. Two gaps are easy to miss
because neither produces an error; mail just silently never sends:

1. **It does not set `USAGE_EMAIL_FROM`.** Every sender is guarded on *both*
   vars, so a valid API key on its own delivers exactly nothing. Add
   `USAGE_EMAIL_FROM="Aglyn <noreply@aglyn.com>"` by hand.
2. **It only sets the key on the project you installed it into.** The
   integration writes a *project-level* var, not a team-level shared one. The
   tenant app sends its own mail (receipts, booking confirmations, campaigns,
   abandoned-cart, restock), so the tenant project needs the key too — either
   install the integration there as well, or promote both vars to team-level
   shared and link them to both projects.

Use `/api/admin/email-health` (below) to see what a given deployment actually
resolved, rather than inferring it from the dashboard.

## How the code uses it

All outbound app mail goes through one helper,
[`@aglyn/shared-util-email`](../libs/shared/util/email/README.md) (AGL-709).
Before it, the same ~30 lines of `fetch` were copy-pasted across 10 files.

```ts
import { sendEmail } from '@aglyn/shared-util-email'

const result = await sendEmail({
  to: 'someone@example.com',
  subject: 'You have been invited',
  text: 'Sign in to accept.',
  context: 'invite', // labels the log line on failure
})
if (!result.sent) { /* 'unconfigured' | 'no-recipient' | 'rejected' | 'network' */ }
```

`sendEmail()` reads the two env vars **at call time**, never throws, and
returns a result instead — outbound mail is best-effort everywhere, so a
checkout must not fail because a receipt bounced. With the vars unset it
warns and returns `{ sent: false, reason: 'unconfigured' }`.

Routes that answer an HTTP request use `isEmailConfigured()` to return a 501
instead of pretending. The org-invite route returns an `emailed` boolean so
the console can tell the user honestly whether a message went out (AGL-708).

## Checking a deployment

`GET /api/admin/email-health` (staff claim required) reports what that
runtime actually resolved — which vars are present, the sender and its
domain, and a plain-language list of `blockers`. The API key is never
returned.

Add `?probe=1` to also ask Resend whether the key is accepted. The probe
**sends nothing**: it POSTs an empty body and reads the rejection — `401`/
`403` means the key was refused, `422`/`400` means the key was fine and only
the empty payload was rejected.

Its one blind spot: a sending-scoped key has no read permissions, so there is
no way to confirm *domain verification* short of a real send. A `healthy:
true` report with an unverified domain will still bounce.

## Test it

1. With the vars set, restart the dev server.
2. Console → an org → **Team** → invite an email **you can receive** that is not
   yet an Aglyn account.
3. Expect the toast **"Invited … — email sent"** and an actual email in that
   inbox. (Without the key you'll see "… they'll see it when they sign in".)
4. Check Resend → **Emails** for the delivery log; bounces/complaints show there
   too.

## Later hardening (optional)

- Tighten DMARC from `p=none` to `p=quarantine` once Resend traffic looks clean.
- Consider a monitored `hello@aglyn.com` reply-to for a human touch.
- ~~Consolidate the ~18 copy-pasted Resend call sites~~ — done in AGL-709; see
  [`@aglyn/shared-util-email`](../libs/shared/util/email/README.md).
