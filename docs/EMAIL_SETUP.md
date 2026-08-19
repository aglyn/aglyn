# Email setup (Resend + aglyn.com)

How Aglyn sends outbound application email — team invites, receipts, usage
summaries, marketing campaigns, staff alerts — and how to configure it so mail
comes **from `@aglyn.com`**.

## The two-provider split (read this first)

Aglyn uses **two** email systems that do different jobs and don't conflict:

| System | Job | Sends as | Config |
| --- | --- | --- | --- |
| **Google Workspace** | Human **mailboxes** + **inbound** mail (`info@aglyn.com` inbox). Your `MX` records point here. | n/a (receiving) | Workspace admin |
| **Firebase Auth** | Auth emails only — verification, password reset. **Does not send its own mail**: configured `CUSTOM_SMTP`, relaying through Resend (`smtp.resend.com`). | `noreply@aglyn.com` (via Resend) | Firebase console |
| **Resend** | Everything else the **app** sends programmatically — and the Firebase Auth relay above. | `noreply@aglyn.com` | `RESEND_API_KEY` + `USAGE_EMAIL_FROM` |

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

## Inbound: the published intake addresses

Everything above is about mail we **send**. These are the addresses we have
**promised** in published documents, so they have to receive. All of them are
Google **Groups** in the Workspace (not aliases on a personal mailbox), which is
deliberate: a group gains and loses members without the address changing, keeps
its archive across a membership change, and can carry an auto-reply later
without re-plumbing.

| Address | Promised in | Delivers to |
| --- | --- | --- |
| `privacy@aglyn.com` | Privacy Policy §7, §9, §11, §13; DPA Annex A data-importer contact; `/legal/subprocessors` | `zach@aglyn.com` |
| `legal@aglyn.com` | Terms §18.1, §18.5 (arbitration opt-out), §19.8, §19.11; Marketplace Publisher Agreement §14 | `zach@aglyn.com` |
| `security@aglyn.com` | Privacy Policy §6; Terms §3.3; `docs.aglyn.com/trust` | `zach@aglyn.com` |
| `abuse@aglyn.com` | Acceptable Use Policy | `zach@aglyn.com` |
| `dmca@aglyn.com` | Copyright/DMCA Policy | `zach@aglyn.com` |
| `support@aglyn.com` | Terms; `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` — printed on the lockdown 503, the quarantine notice, the sanctions 451 and the abuse/counter-notice intakes | `zach@aglyn.com` |

Also live as groups: `info@`, `hello@`, `help@`, `sales@`, `billing@`,
`accounting@`, `admin@`, `talent@`, `copyright@`, `webmaster@` (the DMARC `rua`
destination and the ICANN registrant contact).

### How to verify one of these — and how *not* to

⚠️ **Do not verify by test send.** A default routing rule (AGL-1577) accepts
mail for *non-existent* `@aglyn.com` addresses and suppresses the bounce, so
"I sent it and it didn't bounce" is exactly as true of an address that was never
created. That check cannot fail, so it proves nothing.

Verify by **configuration**, which can fail:

```
https://groups.google.com/a/aglyn.com/g/<name>/members
```

A real group renders its member list. An address that does not exist returns
**404** — run it against something like `nosuchbox` as a negative control before
trusting a positive. Check `Settings → Who can post` is **Anyone on the web**
too: a group that exists but only accepts posts from members will reject a
stranger's DSAR or §512 notice.

Note that the Groups **"All groups"** listing is *not* a complete enumeration —
`abuse@` is absent from it while demonstrably existing. Only the direct probe
above is conclusive.

Last verified **2026-08-19** (AGL-1911): all six accept unmoderated posts from
anyone on the web and deliver each message to `zach@aglyn.com`. Each has a
single member and no auto-acknowledgement — AGL-2400.

## Current DNS facts (aglyn.com)

- **DNS host:** **Vercel DNS** (`ns1/ns2.vercel-dns.com`) — manage records with
  `vercel dns` or the Vercel dashboard. (An earlier version of this doc said
  Google Cloud DNS; that zone is gone — the Cloud DNS API is not even enabled
  on the project. Verified at the TLD parents 2026-08-13.)
- **MX:** Google Workspace. ✅ (do not change)
- **SPF:** `v=spf1 include:_spf.google.com ~all` — one lookup. The old
  `include:_spf.firebasemail.com` was **removed 2026-08-13** (AGL-1495): Firebase
  relays through Resend, so the include only authorized SendGrid's shared IP
  space for nothing. Resend's SPF lives on the `send.` subdomain; this root
  record stays Google-only.
- **DMARC:** `p=quarantine; pct=100; sp=quarantine` with aggregate + forensic
  reports to `webmaster@aglyn.com` (AGL-1493, 2026-08-13). Flip to `p=reject`
  once the report backlog confirms all three senders (Resend, Workspace,
  Stripe) pass aligned — all product mail is DKIM `d=aglyn.com` strict.
- **aglyn.app:** locked down 2026-08-13 (AGL-1494) — `v=spf1 -all`, null DKIM,
  `p=reject; sp=reject`. Nothing legitimate sends from it; keep it that way.

## One-time setup

### 1. Create / open a Resend account
Go to <https://resend.com> and sign in (or sign up). This is the source of
`RESEND_API_KEY`.

### 2. Add the domain in Resend
Resend → **Domains** → **Add Domain** → enter **`aglyn.com`** (the root, so the
sender can be a bare `@aglyn.com` address). Pick the region closest to the
deployment. Resend then shows ~3 DNS records to add.

### 3. Add Resend's DNS records to Vercel DNS
The zone is on **Vercel DNS**, as "Current DNS facts" above records — this
section used to say Google Cloud DNS, and following it now sends you looking
for a zone that no longer exists.

Copy the **exact** values Resend shows. They look like this (the `send`
subdomain is Resend's return-path — it does not affect Workspace inbound mail):

| Type | Name | Value | Notes |
| --- | --- | --- | --- |
| `MX` | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) | bounce handling |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the send subdomain |
| `TXT` | `resend._domainkey` | `p=<long DKIM public key>` | DKIM signing |

Enter just the subdomain part as the name (e.g. `send`, `resend._domainkey`) —
`.aglyn.com` is appended for you. Paste long DKIM values as a single string.

```sh
vercel dns add aglyn.com send MX feedback-smtp.<region>.amazonses.com 10
vercel dns add aglyn.com send TXT "v=spf1 include:amazonses.com ~all"
vercel dns add aglyn.com resend._domainkey TXT "p=<long DKIM public key>"
```

Do **not** touch the existing root `MX`, root `SPF`, or `_dmarc` records.

### 4. Verify
Back in Resend → Domains → **Verify**. Vercel DNS usually propagates in a few
minutes. Wait for the domain to show **Verified**.

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

## Sending-domain warm-up

**Verdict: no warm-up schedule is needed for launch** (AGL-1918, 2026-08-19).
Recorded here rather than left as a silent omission, because "warm up the
sending domain if volume will ramp" is a conditional item and the condition is
not met.

Why it is not met:

- `aglyn.com` is **not a cold domain**. It has been sending real product mail
  through Resend since 2026-07-23 (AGL-709), on a Verified domain with
  DKIM `d=aglyn.com` strict alignment.
- Warm-up is a **shared-IP-pool** discipline aimed at a sudden order-of-magnitude
  jump. Week One sends to a 20-name Tranche A, not to a list. Twenty invites
  plus their receipts is not a ramp.
- The mail that actually scales with signups — verification, password reset,
  invites — is one message per human action, and invites are already capped at
  30/actor/hour and 60/org/hour (AGL-1907).

What matters more than a ramp, and is tracked separately:

- Bounces and complaints on **campaign** mail now suppress the address
  (AGL-1918); the same on **transactional** mail is AGL-2407.
- One-click `List-Unsubscribe` — AGL-2408.
- There is no send-rate governor anywhere, so if volume ever does need a ramp
  there is nothing to turn — AGL-2409.

Revisit this verdict if any of these becomes true: a campaign audience passes
a few thousand, a bulk import produces a first-send to a purchased or aged
list, or the sending identity moves to a new subdomain (a new subdomain **is**
a cold domain, whatever aglyn.com's history).

## Later hardening (optional)

- Tighten DMARC from `p=quarantine` to `p=reject` once the aggregate-report
  backlog confirms Resend, Workspace and Stripe all pass aligned. (`p=none` →
  `p=quarantine` was done in AGL-1493; see "Current DNS facts" above.)
- Consider a monitored `hello@aglyn.com` reply-to for a human touch. Nothing
  sets `replyTo` today, on any message — AGL-2408 §4.
- ~~Consolidate the ~18 copy-pasted Resend call sites~~ — done in AGL-709; see
  [`@aglyn/shared-util-email`](../libs/shared/util/email/README.md).
