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
| `privacy@aglyn.com` | Privacy Policy §7, §9, §11, §13; DPA Annex A data-importer contact; `/legal/subprocessors` | the account owner's mailbox |
| `legal@aglyn.com` | Terms §18.1, §18.5 (arbitration opt-out), §19.8, §19.11; Marketplace Publisher Agreement §14 | the account owner's mailbox |
| `security@aglyn.com` | Privacy Policy §6; Terms §3.3; `docs.aglyn.com/trust` | the account owner's mailbox |
| `abuse@aglyn.com` | Acceptable Use Policy | the account owner's mailbox |
| `dmca@aglyn.com` | Copyright/DMCA Policy | the account owner's mailbox |
| `support@aglyn.com` | **No legal document, as of 2026-08-24** — see below. The value of `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`, printed on the lockdown 503, the quarantine notice, the sanctions 451 and the abuse/counter-notice intakes | the account owner's mailbox |

> ⚠️ **`support@` acquired a legal obligation on 2026-08-18 and lost it again on
> 2026-08-24.** This row read "No legal document" until AGL-1648 caught the first change;
> it then read "DPA §7.2 — the SCC Clause 9 (Option 2) objection mechanism" until AGL-2400
> caught the second. Both times the runbook was wrong for days, in opposite directions,
> which is the argument for the guard rather than for a third hand-edit.
>
> What changed: the `/legal/subprocessors` change log, dated **August 24, 2026**, records
> *"Removed the thirty-day advance-notice commitment for new subprocessors and the
> objection window that ran with it; Section 7.2 of the DPA is amended to match."*
> Verified against the live pages the same day — live DPA §7.2 now carries no objection
> mechanism and no address at all, and `/legal/subprocessors` publishes no address at all.
> `privacy@` is once again the only published data-protection route, which is where
> AGL-1648 draft R2 wanted to consolidate anyway; that draft's §7.2 proposals are moot.
>
> Still true and still worth knowing: `support@` is the one address in this table whose
> value is **configurable** (`NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`), so a self-host operator
> changes what these product surfaces point at.
>
> ⚠️ **This does not demote `support@` out of the six.** It is still a published intake on
> four product surfaces and still single-member with no auto-reply. It loses a statutory
> clock, not its traffic.

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
anyone on the web and deliver each message to the account owner's mailbox.
Each has a
single member and no auto-acknowledgement — AGL-2400.

### Auto-acknowledgement: what each intake owes a stranger (AGL-2400)

Delivering is not the whole obligation. Four of the six carry a clock that runs
against the **sender**, and on those the auto-reply is the only artifact the
sender ends up holding — their own sent copy proves what they wrote, not that
we received it.

| Address | The clock, and whose it is | Emailed receipt today | Also reachable by form? |
| --- | --- | --- | --- |
| `privacy@` | **Theirs.** Privacy Policy §7 is the only published route to a GDPR/CCPA right and the statutory clock starts on receipt. Where the CCPA applies, 11 CCR §7021(b) separately requires us to **confirm receipt within 10 business days** and say when to expect a response. | none | **No.** Email-only — there is no DSAR form anywhere in the product. |
| `legal@` | **Theirs, and it lapses.** Terms §18.5 gives 30 days from first accepting the Terms to opt out of arbitration. §18.1 requires 60 days of informal resolution before a claim. §19.8 makes this the address for service of legal notices. | none | **No.** Email-only. |
| `security@` | **Ours.** `docs.aglyn.com/trust` publishes *"We will acknowledge"* — the only acknowledgement we have ever promised in writing, and today we do not keep it. GDPR Art. 33's 72 hours run from awareness, and this inbox is the primary detection channel (`docs/BREACH_NOTIFICATION.md` §1). | none | **No.** Email-only; no `security.txt` either. |
| `dmca@` | **Both.** A §512(c)(3) notice fixes when our knowledge began. A counter-notice starts the §512(g)(2)(C) put-back window. | none by mail — but see the form column | **Yes**, both directions: `/api/report-abuse?category=dmca` and `/api/counter-notice`, and since AGL-2400 both **email the reference** to anyone who gives an address. |
| `abuse@` | Neither, in law. The AUP publishes no window and reserves action "at any time and in our sole discretion". | none by mail | **Yes** — `/api/report-abuse`, which emails the `AR-…` reference when the reporter leaves an address. |
| `support@` | Neither. Pro tickets carry a 7–14 business-day first response, which is a support SLA and **must never be mistaken for a statutory one** (`docs/PRIVACY_REQUESTS.md` §1). | none | Partly — the ticket form needs a sign-in *and* a paid tier, so for everyone else it is email-only. |

So the code half of AGL-2400 is done and the mail half is not: the two intakes
that already had a reference number now post it to the submitter, and the four
addresses that are email-only still answer a stranger with silence.

#### And a failed receipt is now visible, which under `p=reject` it was not

The two form-backed receipts are best-effort by design — a receipt that cannot
be sent must never turn a submission we already hold into a 503. But the first
implementation was best-effort in the wrong way: both call sites awaited the
send and **discarded the result**, so a receipt that never left was a
`console.warn` in a serverless log and nothing else.

That is a worse blind spot here than it looks, because of the DMARC row below.
`aglyn.com` publishes `p=reject`, so a refused or misaligned message is turned
away **at SMTP** — it is not spam-foldered, it simply does not exist, on either
side. Nobody discovers the failure by looking, and the one person who knows
something is missing is the submitter, who has no way to tell us. A receipt
that silently never sent was therefore indistinguishable from one that arrived.

Each intake now writes `receiptStatus` / `receiptReason` /
`receiptAttemptedAtMs` back onto its own row, and `/admin/abuse-reports`
renders it beside the address to re-send from, with a count at the top of the
queue. **Three states, and they must not collapse:** `sent` (Resend accepted
it — not "delivered"; a later bounce is not visible from here), `failed`
(actionable, with the reason, because an unconfigured deployment is an env fix
and a rejection is a re-send), and **absent**, which means *nobody measured* —
every row filed before this shipped. Rendering the third as `failed` would fill
the queue with imaginary work on day one, which is how staff learn to ignore a
flag; rendering it as `sent` would assert a delivery nothing observed.

This does **nothing** for the four email-only intakes. A Google Groups
auto-reply is sent by Google, is not observable from the repo, and has no
per-message outcome to record — one more reason the remaining half of this
issue cannot be closed from here.

### The Workspace change — the account owner's, because these are account settings

**Groups → the group → Settings → Email options → Auto replies**, check
*Enable auto-reply to non-members outside the organization*, paste the body,
**Save changes**. Requires the Owner or Manager role. Do the same for
*…to members outside the organization* if you want a customer who is also a
group member to get one; nobody is, today.

Two properties of the mechanism shape every body below, and both are worth
knowing before writing your own:

* **The body is static.** There is no templating — no sender name, no date, no
  message id, no reference number. The receipt is dated only by the auto-reply
  mail's own timestamp, which is why each body below tells the sender to keep
  it and to keep their own sent copy. Anything needing a per-message reference
  has to be a form, which is exactly why `abuse@` and `dmca@` are the two with
  reference numbers.
* **It fires after moderation, when moderation is on.** Ours is off on all six,
  so it fires on receipt. Do not turn moderation on without re-reading this.

⚠️ **Do not test by sending to the live address.** A test DSAR sitting in the
privacy inbox is its own small compliance mess, and the row is indistinguishable
from a real request that was never answered. Verify by reading the settings page
back — the checkbox and the body render — and, if you want proof of delivery,
send from a personal address to `support@` only.

#### `privacy@` — the one with a regulator's shape to satisfy

Written to §7021(b)'s three elements (receipt, how we verify, when to expect a
response) without inventing a deadline of our own. `docs/PRIVACY_REQUESTS.md`
§2 explains why the number must stay statutory: a self-imposed window shorter
than the law's is a promise we can miss for free.

> Thank you — this address received your message, and this reply is your
> record of it. Please keep it, together with your own copy of what you sent;
> the date you sent it is the date your request was received.
>
> If you are exercising a privacy right, here is what happens next. We will
> first verify that the request comes from the person it concerns, or from
> someone they have authorised — proportionately, and we will not ask you for
> identity documents to confirm an email address. We will then respond within
> the period the law that applies to you allows: one month under the UK and EU
> GDPR, 45 days under the California CCPA. If your request is complex enough
> to need the extension those laws permit, we will tell you inside the first
> period and say why.
>
> One thing worth checking before you wait on us. If your request is about
> personal information held on a site built by one of our customers, that
> customer is the controller and we are only their processor — you will get a
> faster and more complete answer by contacting them directly. We will help
> them respond, as our Data Processing Addendum requires.
>
> This is an automated acknowledgement. Nobody has read your message yet.

#### `legal@` — the one where the right lapses

The load-bearing sentence is the second paragraph. An arbitration opt-out under
§18.5 is effective **on sending**, so the sender's real question is not "will
you reply" but "did I make it in time" — and that is answerable in a form
letter.

> Thank you — this address received your message, and this reply is your
> record of it. Please keep it, together with your own copy of what you sent.
>
> If you wrote to opt out of arbitration under section 18.5 of our Terms of
> Service: your opt-out takes effect on the date you sent it, provided that
> date is within 30 days of your first accepting the Terms. It does not depend
> on this reply, on our reading your message, or on our agreeing with it. This
> email and your own sent copy are together the evidence of that date.
>
> If you wrote to begin the informal resolution period under section 18.1, the
> 60 days start from the date of your message.
>
> If this is a formal legal notice under section 19.8, note that some notices
> must also be sent to Aglyn LLC, Attn: Legal, c/o Northwest Registered Agent,
> LLC., 5900 Balcones Drive STE 100, Austin, TX 78731.
>
> This is an automated acknowledgement. Nobody has read your message yet.

#### `security@` — the one we already promised

`docs.aglyn.com/trust` says "We will acknowledge". That is the gap this body
closes, and closing it needs a receipt and nothing more.

⚠️ **This body states NO response window, deliberately.** An earlier draft
carried the **3 business days** from `SECURITY.md` (§"Our commitment", lines
38–39). That figure attaches **only to GitHub private vulnerability reporting**,
where a report arrives in a tracked queue with a named reporter. Pasting it here
would newly extend the commitment to *every* inbound mail to `security@` —
vendor questionnaires, scanner output, phishing reports, mistakes — on an inbox
with one member. the decision, 2026-08-23: acknowledge receipt, invent no
timeframe. **Do not re-add a number here** without also changing `SECURITY.md`
and `trust.md`, because then there would be three places to keep true.

The wording below is a receipt plus the three things already published on
`docs.aglyn.com/trust` (no bounty, no payment, no threats). It adds no
commitment that is not already public, which is what makes it safe to send
automatically.

> Thank you — this address received your report, and this reply is your record
> of it. Please keep it, along with your own sent copy; this reply's timestamp
> is the only date stamp either of us gets.
>
> We do not run a bug bounty and cannot offer payment. We will not threaten
> anyone who reports a problem in good faith, and we ask for a reasonable
> disclosure window — typically up to 90 days — so a fix can ship before
> details are public.
>
> We are a small team and we do not publish a response time for this address,
> so please do not read silence as a decision. If you would like to escalate,
> write to help@aglyn.com.
>
> This is an automated acknowledgement. Nobody has read your report yet.

**Steps for the account owner** (nobody else can do this — it is Workspace account state):

1. Open `https://groups.google.com/a/aglyn.com/g/security/settings` — or
   Groups → **security** → **Settings**. You need Owner or Manager on the group.
2. **Email options → Auto replies**.
3. Tick **Enable auto-reply to non-members outside the organization**. That is
   the box that covers every real reporter.
4. Paste the block above into the body — the four paragraphs only, without the
   `>` quote markers.
5. Leave *…to members outside the organization* alone unless you want a reply to
   your own mail; the account owner is the only member today.
6. **Save changes.**
7. Verify by reloading the settings page and reading the checkbox and body back.
   **Do not test by emailing `security@`** — a fake vulnerability report in that
   inbox is indistinguishable from a real one nobody answered.

Once this is saved, `trust.md`'s *"We will acknowledge"* is true for the first
time. The second half of that sentence — *"we will tell you honestly what we can
fix and when"* — is a human promise the auto-reply does not and cannot keep; it
stays a person's job.

#### `dmca@` — must not look like a rejection

A §512 notice emailed to the designated agent is valid as sent. The reply may
offer the form; it may not imply the email did not count.

> Thank you — this address is the designated agent for copyright notices under
> the DMCA, and it received your message. Your notice or counter-notice is
> effective as you sent it; nothing below is a condition of that. Please keep
> this reply and your own sent copy as your record of the date.
>
> If you would also like a reference number to quote, our web forms issue one
> immediately and email it to you: https://aglyn.com/api/report-abuse for a
> takedown notice, and https://aglyn.com/api/counter-notice for a
> counter-notice. Using them is optional.
>
> A note for counter-notices: we restore access 10 to 14 business days after
> we receive one, unless the complainant tells us they have filed a court
> action. That clock runs from when you sent it, not from when we get to it.
>
> This is an automated acknowledgement. Nobody has read your message yet.

#### `abuse@` and `support@` — the plain ones

No statutory clock, so no window is stated. Keep them short; the point is only
that silence stops being ambiguous.

> Thank you — this address received your message, and this reply is your
> record of it.
>
> If you are reporting a site, https://aglyn.com/api/report-abuse gives you a
> reference number straight away and emails it to you, which makes it much
> easier for us to find your report if you write again.
>
> We read everything sent here. We do not publish what we decide about
> individual sites.
>
> This is an automated acknowledgement. Nobody has read your message yet.

### The second member — also the account owner's, and not fixed by anything above

Every one of the six has exactly one member, the account owner. Because *Who can
post* is "Anyone on the web" with no moderation, mail is **accepted** the whole
time that account is unavailable — so a DSAR, a breach report and a §512 notice
all land silently unread, with no bounce telling the sender to escalate. The
auto-reply makes this worse in one specific way worth naming: it tells the
sender their message arrived, which is true, and removes the only signal they
had that nobody was home.

Adding a second member is one click per group at
`https://groups.google.com/a/aglyn.com/g/<name>/members` → **Add members**, and
a personal address that only forwards is enough — the point is that a second
human can see the queue, not that they triage it. **Nobody but the account
owner can do this**, and it cannot be worked around from the repo: a group's
membership is Workspace state. Until a second member exists, treat this half of
AGL-2400 as open regardless of what the auto-replies say.

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
- **DMARC:** `p=reject; pct=100; sp=reject` with aggregate + forensic reports
  to `webmaster@aglyn.com` (AGL-1493 set `p=quarantine` 2026-08-13; tightened
  to `p=reject`, verified live at the zone 2026-08-24 — AGL-1876). All product
  mail is DKIM `d=aglyn.com` strict, and all three senders (Resend, Workspace,
  Stripe) pass aligned.

  ⚠️ **Under `p=reject` a misaligned message is refused at SMTP, not
  spam-foldered.** The failure signature is therefore a *missing* email with no
  copy anywhere for the recipient to find — not a message sitting in a junk
  folder. If someone reports a receipt or invite that never arrived, check the
  DMARC aggregate reports for that sender before looking anywhere else; a new
  sending path that was never aligned fails this way and nothing else in the
  product will say so.

  One exception, and it is the only one: the two §512 receipts record their own
  outcome on the intake row and show it in `/admin/abuse-reports` (AGL-2400,
  above). Every other sender in the tree still fails this way silently.
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

- Bounces and complaints suppress the address on **every** send, campaign and
  transactional alike (AGL-1918, then AGL-2407). `sendEmail()` stamps its
  `context` as a Resend tag on every message, so a bounce on an invite,
  a password reset or a receipt is placeable; a permanent bounce or a
  complaint that names no site is filed on the platform-wide
  `emailSuppressions` list, and one that names a site is filed on both. The
  list is consulted by the **bulk** senders only — the monthly usage summary
  and the usage-alert fan-out. Transactional mail is deliberately NOT gated
  on it: refusing a password reset over a stale bounce locks a real customer
  out of their own account (the AGL-1438 line, drawn again).
- One-click `List-Unsubscribe` is **shipped** (AGL-2408): campaign mail
  carries the RFC 8058 pair — `List-Unsubscribe: <https://…>` plus
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — and
  `/api/email/unsubscribe` writes only on POST. The GET is a
  confirmation page, so a Safe Links / Proofpoint prescanner following
  the link no longer unsubscribes the recipient. Still open: no
  `mailto:` fallback in the header, because it needs a monitored
  inbox (see "Later hardening" below).
- **Click and open tracking are on for every sending domain.** A provider
  measures a click by rewriting each `<a href>` in the HTML part to a tracking
  host on the sending domain; both flags default OFF and tracking engages only
  once that host is verified, so a domain without one reports a click rate of
  exactly 0% for ever. `aglyn.com` was turned on by hand; the four shared pool
  members (`shared{1..4}.mail.aglyn.app`) were left off and carried every
  tenant campaign, which is where the 0% actually lived. All five now run
  `click_tracking` and `open_tracking` with a verified `links.` host, and
  `POST /domains` asks for both at creation so a dedicated subdomain or a
  customer's own domain cannot be issued without them. `aglyn.app` publishes
  one root CAA entry for `amazon.com` alongside the three it already had —
  additive, so Vercel's certificates for tenant sites are untouched — which
  covers every name in the zone. See `docs/design/email-sending-domains.md`
  for the record table, why the tracking records never block verification, and
  the two caveats: a CAA must never replace a set a customer already
  publishes, and releasing a domain breaks tracked links in mail it already
  sent. `/api/admin/email-health?probe=1` reports a pool member whose tracking
  is off as a `notices` entry rather than a blocker — it delivers fine, it just
  cannot count.
- **Topics and a preference center are shipped.** A campaign belongs to a
  topic (`orgs/{orgId}/emailTopics`, org-shared like `lists`, with four
  built-in defaults that need no migration), and the topic is signed into the
  link as `tid`. Two URLs come off that one signature, and which one goes
  where is the whole compliance story:
  - `List-Unsubscribe` names `/api/email/unsubscribe`, whose POST writes the
    whole-site suppression immediately. A mailbox provider POSTs it with no
    human present, so it must not be a page anybody has to submit — and it
    stays a FULL unsubscribe, because that is what the button promises.
  - the footer link names `/api/email/preferences`, the preference center: a
    checkbox per topic, an "Unsubscribe from everything" button, and a result
    page with an undo. All three routes keep the safe-GET / mutating-POST
    split.

  **Every marketing path makes that split, not only campaigns.** The
  abandoned-cart sweep, the restock notice, the newsletter welcome and each
  workflow email go out through `sendEmail`'s marketing seam, and
  `marketingSendVerdict` mints the pair there — `unsubscribeUrl` on the
  preference page for the footer, `oneClickUrl` on the write-on-POST route
  for the header — with the sender's topic signed into both. A footer that
  named the one-click route gave the recipient of one of those exactly one
  choice: stop hearing from the site entirely.

  The visible footer is on **both parts**. `sendEmail` appends it to the text
  and the HTML of any gated message that does not already carry the link, and
  `renderCampaignEmail` does the same for a campaign, which mints its own
  pair and passes no marketing context. A designed template carries an
  opt-out only where its author placed a `{{unsubscribeUrl}}`, so before that
  a design whose footer block said only the copyright line mailed an HTML
  part with no way out of the list — the half almost every recipient reads.
  The idempotency check looks for the escaped URL as well, because a renderer
  putting the link in an `href` writes `&amp;` between its parameters.

  Per-topic opt-outs are recorded at `hosts/{hostId}/topicOptOuts/{emailKey}`
  — per site, beside the suppression list, keyed on the same derivation — and
  the send path consults them through `filterTopicSendable` after both
  suppression lists. An opt-out that is later lifted keeps its record and
  gains a `resubscribedAt`, the same evidence rule the suppression lists
  follow. A resubscribe from any of these routes still refuses to clear a
  bounce or a complaint.
- D5 of `docs/specs/email-competitive-gaps.md` — the two suppression key
  derivations — is **closed on the link routes**: they now key through
  `personKey`, which normalizes and refuses a value that is not an address.
  `campaign-send.ts`'s `suppressionId` and `email-suppression.ts`'s
  `emailSuppressionKey` still exist and still agree; the third variant that
  hashed the raw string is gone.
- There is no send-rate governor anywhere, so if volume ever does need a ramp
  there is nothing to turn — AGL-2409.

Revisit this verdict if any of these becomes true: a campaign audience passes
a few thousand, a bulk import produces a first-send to a purchased or aged
list, or the sending identity moves to a new subdomain (a new subdomain **is**
a cold domain, whatever aglyn.com's history).

## Later hardening (optional)

- ~~Tighten DMARC from `p=quarantine` to `p=reject`~~ — done; the zone has
  carried `p=reject; sp=reject` since before 2026-08-24. (`p=none` →
  `p=quarantine` was AGL-1493; see "Current DNS facts" above for the
  refused-at-SMTP failure signature this creates.)
- Consider a monitored `hello@aglyn.com` reply-to for a human touch. Nothing
  sets `replyTo` today, on any message — AGL-2408 §4.
- ~~Consolidate the ~18 copy-pasted Resend call sites~~ — done in AGL-709; see
  [`@aglyn/shared-util-email`](../libs/shared/util/email/README.md).
