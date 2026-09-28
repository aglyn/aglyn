---
sidebar_position: 11
title: Abuse reports
description: The public abuse-report queue — where outside reports land, how to triage by severity, which lever answers which report, and the CSAM and DMCA paths that are not takedown buttons.
---

# Abuse reports

:::warning Aglyn staff only
The queue lives at **Staff → Abuse reports** (`/admin/abuse-reports`) and requires
a staff claim. The `abuseReports` collection is `allow read: if isStaff()` and
`allow write: if false` — every write comes from the Admin SDK, so nothing you do
in a Firestore console tab is a supported path.
:::

This is the intake for people who are **not our customers**. A bank's fraud desk,
a browser vendor, a photographer whose work was lifted, a stranger who clicked
something wrong — none of them can open a support ticket (that route needs a
token and a paid plan), and all of them have somewhere else to go if they cannot
reach us. For a phishing site the somewhere else is a domain-level block on
`*.aglyn.app`, which takes every legitimate customer site down with it. That is
the failure this queue exists to prevent, and it is the reason an unanswered
report is more expensive than it looks.

## Where reports come from {#where-reports-come-from}

One URL, on every origin we serve:

```
https://<any-site>/api/report-abuse
```

It works on `aglyn.com` and on every `*.aglyn.app` site, because it lives under
`/api`, which the tenant middleware excludes from its per-host rewrite. So a
reporter who was looking at `dodgy.aglyn.app` and a reporter who was looking at
our marketing site land on the same form. `?url=` pre-fills the reported address.

Things about the form worth knowing before you read a row:

- **No JavaScript, no account, no App Check.** `GET` renders plain HTML, `POST`
  takes either a urlencoded form or JSON. The reporters this exists for are often
  on a locked-down corporate or law-enforcement browser, and an automated
  phishing feed posts JSON.
- **It does not refuse while a site is suspended.** Every other public write on
  the tenant runtime stops during a lockdown. This one deliberately does not — a
  suspended site is the most likely subject of a report, and the person who just
  saw the 503 is the most motivated reporter we will ever get.
- **It does not require the reported site to exist.** A mistyped subdomain or an
  already-deleted site still produces a row. `hostId` and `orgId` are resolved
  when the URL is one of ours and left empty when it is not — so an empty
  `hostId` means "we could not resolve it", never "there is nothing here".
- **Rate limit: 5 reports per IP per 10 minutes.** A refusal answers 429 and
  hands the reporter `support@aglyn.com` rather than a wall. The first report
  from any source always lands, which matters because a corporate NAT puts a
  whole fraud department behind one address.
- **A honeypot hit writes nothing.** The form carries a hidden `website` field;
  a bot that fills it gets a receipt page that looks exactly like success and no
  document is created. So the queue being empty is weak evidence that nobody
  reported anything.

Each report gets a reference like `AR-3F9A1C2B4D` shown to the reporter. It is
the first ten characters of the document id, uppercased — so if someone quotes a
reference at you, the row is the one whose `reference` field matches. **The
reporter's IP is stored nowhere.** It goes into the hash that produces the
document id and into the rate-limit key, both one-way. The same source reporting
the same URL for the same reason merges onto one document and bumps
`reportCount`, so one person cannot make one site look widely reported.

The two timestamps mean different things and both are trustworthy. `createdAt`
is written **once**, on the first report, and never touched again — so on a row
with `reportCount` above 1 it still answers "when did we first know", which is
the question that matters afterwards. `updatedAt` moves on every repeat.

A repeat also never re-opens a report. Once you have moved a row to `actioned`
or `dismissed`, the reporter filing again bumps `reportCount` and leaves your
decision where you put it.

## Held outbound email and pages {#held-outbound-email}

The queue has a second source that is not a person: the phishing screen. It
reads every workspace's outbound email and published pages with one brand list
and one set of rules. When it finds a signal that holds, it **holds** the email
or page and files a row here. The row has category `phishing`, severity urgent,
reference `HS-…` and source `outbound-screen`. Staff get the same urgent
notification an intake phishing report raises, once per row.

### What the screen looks at {#what-is-screened}

| Surface | Where it is screened | What a hold does |
| -- | -- | -- |
| Campaigns | Before the campaign is claimed | The campaign is parked as a scheduled send that no processor run reaches. |
| Workflow, action and org-automation email steps | Before the step sends | The run fails with "held for staff review" and the reference. A step after a wait stays queued. |
| Every other email a site sends (CRM one-off mail, inbox replies, newsletters, member posts, cart and restock reminders, receipts, booking mail, marketplace plugins) | At the send itself (`sendEmail`) | That one email is not sent, and its sender reports `held-for-review`. |
| Outreach sequences (connected mailboxes) | Before the step is claimed | The enrollment is paused with the reason. A member resumes it once the row is released. |
| Published pages | When the page is put together for a visitor | The page serves the last version it served clean, or nothing if it has none. |

A page row names the page by what it is and the route it serves, never by the
site's root address:

- a page, such as `the "Pricing" page (/pricing)`;
- a collection list template, such as `(/blog)`;
- a collection or product entry template, such as `(/videos/:slug)`, with the entry
  address that was being shown;
- an experiment variant, together with its page;
- an error page.

When the flagged content comes from a shared layout or component rather than the page
itself, the row names that layout or component and how many pages use it. **Open in
console** opens the held version of the page, or the layout or component, on this origin.
The owners see the same name and a banner on the page in their console. They can request
a review, but they cannot release the page.

Pages are screened when they are served rather than when Publish is clicked.
Publishing is a pointer move made from the browser in several places, and an
author can edit a live version in place. Every one of those paths reaches a
visitor through the same composition step, and that is where the screen reads
the page: the screen, its layout, the components placed on it and its forms.

### What holds, in two tiers {#tiers}

**Strong signals hold for every workspace, however old:**

- **A lookalike link, embed or reply address.** A host that wears a brand's name
  without being the brand's domain, such as `poshmark.id63835663.shop`,
  `paypal-secure.com`, `booking.com.guest-review.top` or `paypa1.com`.
- **A credential field on a page.** A field the page's author defined that asks
  for a password, a card number or a one-time code. Aglyn's own member sign-in,
  account and checkout elements are not affected, because they collect those
  details themselves.

**Soft signals hold only for a workspace less than 14 days old:**

- **A brand in the sender name** that is not the workspace's own, such as mail
  sent as "PayPal Support".
- **Brand, lure and elsewhere, together.** The email names a brand, asks the
  reader to act on an account ("verify your account", "has finally sold",
  "feedback regarding your property"), and links to a domain that is not the
  brand's, the workspace's own, or a common social or maps link.
- **A brand's call to action on a page.** One element names a brand and asks
  the reader to sign in, verify, confirm or open a document, and the page links
  to somewhere that is not the brand's or the workspace's.

Soft signals never hold email a customer is owed by their own action: receipts,
gift cards and order notices, booking confirmations and reminders, and password
resets. A lookalike link in one of those still holds.

A brand mentioned on its own never holds. The brand list and its real domains
live in `libs/shared/util/email/src/lib/outbound-phishing-screen.ts`. Add a brand
there when it has been seen impersonated, not because it is large.

### Deciding a row {#deciding-a-held-row}

**Closing the row is the decision.** Both outcomes need the usual note, and both
write the audit row:

| You set the row to | Effect |
| -- | -- |
| `dismissed` (false positive) | **Released.** A campaign goes back on the clock and sends on the next processor run. An automation sends from its next event, and a queued step sends on its next beat. Other email from the site that carries the same signals sends. A page serves its held version once the site's cache is dropped, which the decision does itself. |
| `actioned` | **Rejected.** A campaign is canceled. Email carrying the same content or signals is refused. A page stays unserved. |
| `reviewing` | Still held. |

A campaign or automation release covers **exactly the content that was held**.
If the merchant edits it, the screen checks it again and a new row may appear.
Other email and pages are keyed on the site and the signals that held, because
their words change with every recipient or render. A rejection does not lock the
workspace. If the content is phishing, lock the org at
[Lockdown](./lockdown.md) as well, which stops every outbound path.

### Names and domains {#names-and-domains}

- **Subdomains.** Creating or renaming a site to a brand's name or a lookalike
  of one (`poshmark`, `paypal-secure`, `appleid`) is refused for every
  workspace, as is a brand's word joined to an account word (`booking-review`,
  `apple-support`). Names that merely contain a common word, such as
  `apple-pie-co` or `tanyas-booking`, are allowed.
- **Custom domains.** Attaching a custom domain that is a brand lookalike is
  not refused. It files an urgent `phishing` row here for staff to decide. The
  site's pages are still screened as they are served.
- **Sending domains.** A custom sending domain that is a brand lookalike
  (`paypa1.com`) files the same urgent row when it is added and again when it
  verifies. Email from it is held for every workspace, because the screen reads
  the `From:` address the way it reads a link.
- **Form submissions.** The public form endpoint drops any submitted field
  named for a password, card number or one-time code. This covers pages the
  screen never reads, such as a marketplace plugin's frame.
- **Marketplace plugins.** A sandboxed plugin frame cannot post a native form:
  its sandbox has no `allow-forms` and its CSP sets `form-action 'none'`. At
  review, the bundle verifier's **No password, card or one-time-code inputs**
  row flags a bundle that builds such an input. It is a question for the
  reviewer, not a refusal, because a real plugin can own a sign-in. Ask what
  the input is for and confirm the plugin sends it only to the origins its
  manifest declares.

## Stripe fraud signals {#stripe-fraud-signals}

The billing webhook files a third kind of row. The source is
`stripe-fraud-signal`, the category is `phishing`, the severity is urgent and
the reference is `PF-…`. It files one row for each of these Stripe events:

| Event | Filed when |
| -- | -- |
| `radar.early_fraud_warning.created` | When the charge bills a workspace, or when it paid no one we can name. The card issuer reports the charge as likely fraud. It is not a chargeback yet, and refunding now can prevent one. |
| `review.opened` | Same as above. Radar put the payment into review, and it stays there until someone closes the review in Stripe. |
| `charge.dispute.created` | Only when the charge bills a workspace subscription. |

A signal on a site's own sale (a storefront order, a booking, a membership or
a marketplace purchase paid to a seller's connected account) is not filed
here. It belongs to the merchant: the plugin puts it on the order or booking
and notifies the site's managers. Staff hear about those only as a pattern;
see [Seller fraud pattern](#seller-fraud-pattern).

The row names the workspace, the charge and the amount. When the charge can be
read from Stripe, it also shows what the card's own checks said: CVC, postal
code, issuing country, 3DS and Radar risk level. It links to the workspace's
**Subscription** card on the staff org page, and staff are notified once for
each signal. A redelivery only increases the count.

**Nothing is refunded or canceled automatically.** You decide:

- Refund on the charge in Stripe.
- Cancel billing on the Subscription card ([Lockdown](./lockdown.md#cancel-billing)).
- Lock the workspace if it is fraud.
- Close the review or answer the dispute in Stripe.

Then close the row with a note saying what you did.

The live webhook endpoint must be subscribed to the two new events. Run
`node tools/scripts/setup-stripe.mjs`, which only adds missing events, or enable
them on the endpoint in the Stripe dashboard. Until then, `/api/health/billing`
reports the endpoint as missing required events.

## Seller fraud pattern {#seller-fraud-pattern}

A merchant who takes stolen cards through their own storefront leaves a
pattern: several different sales on one connected account draw an issuer fraud
warning or a chargeback within days. The billing webhook keeps every such
signal for each connected account, and files one row when

**3 different charges** on the same connected account draw an early fraud
warning or a dispute **within 7 days**.

The source is `stripe-seller-fraud-pattern`, the category is `phishing`, the
severity is urgent and the reference is `PF-…`. Staff are notified once. A
warning and a dispute on the same charge count as one charge. Radar reviews are
listed but never counted. Once filed, the account is not filed again for 7
days, so a burst is one row.

A legitimate small shop sees one or two of these a month at most, so a single
warning or dispute never reaches this queue. The merchant handles it.

The row names the connected account, the charges, and the workspaces and sites
they were for, with links to the workspace and to the account in the Stripe
Dashboard. **Nothing is refunded, canceled or paused.** If the seller is the
fraudster:

- Lock the workspace at [Lockdown](./lockdown.md) with the `security`
  reason. A locked site's checkout, bookings and memberships stop taking new
  payments, and the two boxes that start ticked for `security` also pause its
  membership renewals and switch the seller to manual payouts
  ([Stopping a tenant's money](./lockdown.md#pause-site-money)). Unlocking
  restores exactly what the lock paused.
- If the lock result says the payouts are **not controllable** (a Standard
  account), pause them in the Stripe Dashboard
  (**Connect → Accounts → the account → Payouts**).

Then close the row with a note saying what you did.

## Card-testing velocity {#card-testing-velocity}

A public checkout is where a card tester learns which stolen cards still work:
a script opens payment after payment, from one address or from many, against
one shop or across many. Every visitor payment door on a published site (buy
now, cart checkout, reservation deposit, booking deposit) is held to three
counters. The numbers live in `card-payment-velocity.ts` and are not repeated
here:

- **One address on one site.** Past it, the shopper is told to wait a few
  minutes. A young workspace's site has a tighter limit.
- **One address across every site.** Past it, the same refusal.
- **One site, every address together.** This one **refuses nothing**, because
  a site-wide refusal would let any stranger switch a merchant's checkout off,
  and a busy launch looks the same. Crossing it files one row per site per
  day.

The row's source is `payment-velocity`, the category is `phishing`, the
severity is urgent and the reference is `PV-…`. Staff are notified once a day
per site. It can mean a script testing cards against the shop, a merchant
testing stolen cards through their own storefront, or a real launch. Look at
the site and its recent orders. If it is card testing, lock the workspace and
pause the connected account's payouts as for a
[seller fraud pattern](#seller-fraud-pattern).

The counters cannot see the card, because Stripe's hosted Checkout page takes
it. A limit per card is Radar's job. Stripe's card-testing protection is on
for every Checkout Session by default. Velocity rules live in the platform
account's Radar, since every tenant sale is a destination charge on it. They
need Radar for Fraud Teams; check each attribute's exact name in the rule
editor before saving:

- **Block** when one address has many declined charges in an hour
  (`:declined_charges_per_ip_address_hourly:`).
- **Review** when one card is charged many times in a day
  (`:total_charges_per_card_number_daily:`).
- **Request 3D Secure** when `:risk_level:` is `elevated`.

## The marketplace {#marketplace}

Marketplace publishers get the same screens, applied where a listing is
submitted and where a sale is recorded.

**Held submissions.** Every publish, listing edit and publisher-profile save
goes through the phishing screen before anything is listed. The title,
description, readme, changelog and links are read as a message from the
publisher. A template's, layout's or component's content is read as the page it
will become, and an email template's as mail. The tiers are the ones above. A
hold refuses the submission and files a row with source `outbound-screen`,
reference `HS-…` and kind **Marketplace submission**. **Dismiss** releases it
and the publisher submits again. **Actioned** rejects it. The publisher's owners
and admins are told that it is held and how to ask about it, never which rule
held it.

A publisher name or handle that uses the platform's name, and a name or listing
title that claims to speak for a brand ("PayPal Support"), are refused outright
and file nothing. Staff accounts are exempt, which is how the platform's own
listings are published.

**Plugin network origins.** The plugin verifier asks the reviewer about any
origin a manifest declares that wears a brand without being the brand's own
domain (`paypal-verify.net`, `aglyn-billing.com`). This is a question for the
reviewer, not a refusal.

**Sales.** A buyer who is a member of the publishing workspace cannot check out,
and a workspace under any lock sells nothing. Each recorded sale is also read
for a publisher paying itself. A row with source `marketplace-sale-risk` and
reference `MR-…` is filed when any of these hold:

- the buying and publishing workspaces share a member;
- the same card bought from the same publisher for another workspace;
- a publisher in its first 30 days made a single sale of $100 or more.

Payouts from a publisher in its first 30 days are held 14 days on its connected
account, so a stolen-card sale can still be refunded with the publisher's share
taken back. **Nothing is refunded or paused by the row.** If it is the publisher,
lock the workspace with the `security` reason and refund the sale, which
reverses the publisher's share. The lock takes the publisher's listings out of
browse, and a security lock stops every install and update of them. With
**pause payouts** ticked, the lock also pauses the publisher's payout account
([Lockdown](./lockdown.md#lock-listings)).

Early fraud warnings and disputes on marketplace sales count toward the
[seller fraud pattern](#seller-fraud-pattern) under the **publisher's**
workspace, never the buyer's.

## Risk notices: what the workspace is told {#risk-notices}

Every row a risk source files — a held email, page or marketplace submission, a
flagged or blocked domain or link, a Stripe fraud signal, a seller or
marketplace-sale pattern, card-testing velocity — also tells the workspace's
owners and admins, through one seam (`notifyRiskEvent`) and one catalog of
words (`risk-notice-catalog.ts`). Locks, lifts and staff cancellations use the
same seam; see [Lockdown](./lockdown.md#owner-notices).

- **What owners read.** What happened, on what, and when; what it means for
  them; numbered next steps; and actions that open the real control (the held
  email, the order, billing, support). They are never told the rule, the brand
  matched, or a number — a fraud actor reads the same notice. The customer help
  page is [Why was something on my account held or flagged?](/help/holds-and-reviews).
- **What staff read.** Each row shows the catalog's staff title and summary
  above the evidence, and its actions: **Open in abuse queue**, **Waive /
  release** and **Reject** (which set the status below to Dismissed or
  Actioned — nothing changes until you save), **Lock workspace** / **Lock site**
  (opens Lockdown pre-filled; it still waits for you to press Lock), **Cancel
  subscription** (the org's Subscription card), **Open in Stripe**, and **View
  workspace**. A staff alert links straight to its row:
  `/admin/abuse-reports?report=<id>`.
- **Owners cannot release anything.** Their only lever is **Request a review**
  (on the notice, or under Settings → Holds & reviews). It appends a note to
  THIS row — shown under "Review requested by the workspace" — and alerts staff
  with a link here. It never changes the row's status or its held send.
- **Closing a row tells them how it ended.** Dismissed sends the "released"
  notice, Actioned sends "not approved"; a review with no held item sends
  "complete, no action" or "found a problem". Put anything more you want them
  to know in "What you did".
- **Bursts.** Past five notices in an hour for one workspace (ten staff alerts),
  the rest are folded into one summary sent when the hour closes, so a
  workspace under attack gets a digest, not five hundred emails. Locks, lifts
  and cancellations are never folded.
- **Email.** Notices that stop someone's work are emailed as account mail from
  the platform's sender — they ignore notification settings and reach a locked
  workspace. Each kind is its own template on the **System emails** page
  (`risk-…` keys). Notices about a workspace's own customers' payments wear the
  workspace's brand; everything the platform does wears the platform's.

## Triage by severity {#triage-by-severity}

Every category carries a severity. It is not a mood — it says how fast a human
has to look.

| Severity | Categories | What it means |
|---|---|---|
| **urgent** | `phishing`, `csam`, `malware` | Look now. |
| **high** | `dmca`, `impersonation`, `illegal` | Same day. |
| **normal** | `spam`, `other` | Work the queue. |

**Urgent is urgent because the cost of delay is not paid by us and not paid by
our customer.** It is paid by whoever clicks the phishing page next, or by the
child in the material, or by the visitor whose machine the download takes. That
is a different kind of cost from a customer waiting on a billing question, and it
does not get cheaper by being ignored overnight.

The second reason, for phishing specifically: an unanswered phishing report is
exactly what turns into a domain-level block on `*.aglyn.app`. The reporter who
cannot reach us escalates to a browser vendor or a blocklist, and that block does
not distinguish the phishing subdomain from the four hundred honest customer
sites beside it. Answering one report quickly is the cheapest insurance we have
on the whole platform.

## CSAM is not a takedown button {#csam}

If a report is `csam`, stop reading the rest of this page and do this:

1. **Do not delete the content.** Do not delete the site, do not empty the media,
   do not "clean up" the workspace, do not delete the report.
2. **Preserve it.** Lock the site down (host scope) so the public cannot reach
   it. Lockdown suppresses; it does not erase. That is the correct instrument
   here and quarantine is too, for the same reason — a quarantined file still
   exists and can still be produced.
3. **Escalate to the account owner immediately.** Whatever hour it is.

The lever is **preservation plus notification**, not erasure. Deleting the
material feels like the responsible act and is close to the opposite of one: it
destroys what an investigation needs, and reporting obligations are not
discharged by the content going away.

:::danger Open item — the reporting mechanics do not exist yet
Who files the report with NCMEC, under whose account, and on what timeline is
**not established**. There is no registered account, no runbook step you can
follow, and nothing in the code that does it for you. Until that is settled, the
only correct action a staff member can take on a `csam` report is preserve,
suppress, and escalate to the account owner — do not improvise a filing, and do not assume
someone else has already made one.

The public form no longer implies otherwise (AGL-2045). Its `csam` hint used to
read *"Reported to the authorities and handled outside the normal queue"*, which
was half true and dangerous in the false half: a reporter who believes the
filing is done may not make one, so the sentence could **replace** a real
CyberTipline report. It now describes only the handling — urgent, out of the
normal queue, escalated to the operator — and tells the reporter to file with
NCMEC at `report.cybertip.org` themselves. Assume every reporter has done that
and that we have not.
:::

## Which lever answers which report {#which-lever}

The response tooling is good. Match the size of the lever to the size of the
problem — the whole point of having three is that the widest one punishes people
who did nothing.

| The problem is | Reach for | Where |
|---|---|---|
| **One bad file** — malware in a PDF, an infringing image, one abusive asset | Media quarantine | `/admin/media-quarantine` |
| **One bad site** — a phishing page, a whole site built to deceive | Lockdown, **host** scope | `/admin/lockdown` |
| **A whole workspace acting in bad faith** — the same operator rebuilding the same scam across their sites | Lockdown, **org** scope | `/admin/lockdown` |

Media quarantine's reason codes already include `abuse` and `dmca`, which is
deliberate: a report's category maps onto a quarantine reason with no translation
step. It is reversible, keyed on the file's content digest, and it does not
delete or bill anything — see [Asset quarantine](lockdown.md#quarantine-keys) for
which digest to send and what each key reaches.

**Host scope now genuinely freezes the site's client writes.** Until AGL-1965,
a host-scope suspension stopped the public site and every Admin-SDK route and
did *not* stop the browser's direct Firestore writes — so an editor with a live
session could keep editing a phishing site staff had just suspended, and
republish it. The Firestore rules now carry a `hostSuspended` arm, so a suspended
site cannot be republished.

:::caution That is only true once the rules are deployed
`cloud/firebase-firestore.rules` deploys **separately from the app**. An app
deploy that carries the rules file in the repo has not applied it. If you are
relying on a host-scope lock to stop republishing — and on a phishing takedown
you are — confirm the rules in force are the ones with the host arm, rather than
assuming the last deploy included them.
:::

Two known edges of a host-scope lock, both carried in AGL-1981, both worth
knowing before you promise a customer or yourself that a site is frozen:

- **A timed suspension never expires in the rules.** The server-side helpers
  honor `suspendedUntilMs` and the rules do not. So when a timed lock lapses the
  site starts serving again while the client SDK stays frozen — the customer gets
  their site back and cannot edit it, with no error explaining why. Prefer an
  untimed lock you come back and lift by hand.
- **Org-level data is not frozen by a host-scope lock.** A host suspended in
  read-only mode keeps serving, and the pages it serves render org-level datasets
  and media that the host arm does not reach. If the offending content is
  org-level rather than site-level, host scope is the wrong scope.

Whatever you pull, the lockdown and quarantine surfaces both read the state back
after they write it and say `NOT CONFIRMED` when the re-read disagrees. Believe
the re-read, not the click.

## Statuses {#statuses}

| Status | What it means |
|---|---|
| `open` | Nobody has looked at it. Every report starts here. |
| `reviewing` | You are working it right now. Set it so a second person does not duplicate the investigation — and so an urgent row that has been `reviewing` for hours is visibly stuck rather than invisibly stuck. |
| `actioned` | We did something: a quarantine, a lockdown, a scope escalation. Say what, in the row. |
| `dismissed` | We looked and are doing nothing. A dismissal is a decision and needs a reason — "not our host", "the page is what it claims to be", "duplicate of AR-…". |

`dismissed` is not the same as unread. If you dismiss without a reason, the next
person to receive a report about the same site has no idea whether we already
considered it.

**Filtering and paging the queue.** The queue has two filters, **Status** and
**Category**, set from the two menus above it; each one in force shows as a chip
you can remove. Both are applied to
the **whole queue** by the query that reads it, not to the page on screen, so
"no reports match" means none anywhere. They combine freely — `open` reports in
`phishing`, say. There is no search box: a report is triaged by status and category, and its text
is whatever a stranger typed into a public form.

Reports come newest update first, a page at a time, with the page controls under
the last card. Counter-notices page on their own below them, **oldest first** —
the first page holds the deadlines closest to passing.

The menus offer only what the query can hold. A filter that reaches the queue
some other way and cannot be applied is not applied at all: a notice above the
list names it and says why, in the form *"Status starts with act is not applied:
…"*, rather than narrowing some rows and not others. See
[Filter and search a list](../getting-started/console-tour.md#filter-and-search).

The banners at the top count the **whole queue**, whatever page you are on: open
reports in an urgent category, counter-notices not yet forwarded, and
restorations already past their deadline (read "at least N" in the rare case
there are more candidates than one read covers). The failed-receipt banner is
the exception and says so: it counts the submitters **on this page**.

## What we do not tell people {#disclosure}

Two rules, both narrow and both firm.

**We do not tell the reporter what we decided about a specific site.** Not
"we suspended them", not "we found nothing". A reporter has standing to know
their report arrived — that is the reference number — and no standing to learn
what enforcement exists against a named customer. The receipt page says this
plainly, so a reporter who expected a verdict was told up front they would not
get one.

**We do not pass reporter details to the site owner.** One exception, and it is
required rather than optional: on a **DMCA notice** the site owner needs the
notice, including who sent it, because their right to counter-notice is
meaningless without knowing what and who they are answering. That is why a
copyright notice cannot be anonymous and every other category can be.

## The DMCA path {#dmca}

A valid takedown notice under 17 U.S.C. §512(c)(3) carries, among other things:

1. **Identification of the copyrighted work** said to be infringed.
2. **A good-faith statement** that the use is not authorized by the owner, its
   agent, or the law.
3. **A statement under penalty of perjury** that the information is accurate and
   the sender is authorized to act for the owner.
4. **A physical or electronic signature.**

The form enforces all four — plus a reply address, which the other categories do
not require — and refuses a `dmca` submission missing any of them. So a report in
the queue with `category: dmca` has the affirmations on it or it would not be
there. Read them anyway: enforcing that a field is non-empty is not the same as
the field saying something.

**We do not adjudicate the claim.** Nothing here decides whether the copyright
claim is good. We record what was asserted, by whom, at what time. If the notice
is facially complete and points at content we host, the proportionate response is
usually quarantining the specific asset rather than locking the site.

**The site owner has a right to counter-notice.** That path now exists — see
[Counter-notices](#counter-notices) below.

:::warning The agent is filed. The publication half is not.
**Registered.** Copyright Office designated-agent record `DMCA-1038349`, active
since **2026-08-18**, next renewal **2029-08-18**. Agent: *Copyright Compliance
Department*, `dmca@aglyn.com`, c/o Northwest Registered Agent, LLC., 5900
Balcones Drive STE 100, Austin, TX 78731. The agent's telephone number is
deliberately not written here: this repository is public. It belongs in
deployment configuration as `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_PHONE`, and it must
not be reintroduced into a doc, a fixture or a test. Earlier text on this page
and on AGL-1618 said no filing existed; that was corrected 2026-08-19.

**What is still outstanding is publication, and it is a real condition, not
paperwork.** §512(c)(2) requires those same four details — name, address,
*phone*, email — to be available to the public through the service, and
§512(i)(1)(A) conditions the entire safe harbor on having informed subscribers
of the repeat-infringer policy. Neither is on `/legal/dmca` yet (AGL-2035,
AGL-2007), and `/legal/dmca` is besigner-published content, so closing them is a
publication pass rather than a repo edit.

Two things follow for you. **Details on the filing and details on the page must
match** — if you are ever asked to correct one, correct both. And until the
publication lands, **still do not tell a reporter or a customer that we are
operating inside the safe harbor**: the registration is necessary and is not
sufficient.
:::

## Counter-notices — the put-back {#counter-notices}

A subscriber whose material we removed can answer with a counter-notice under
§512(g). This is the process that protects us from **the other side**: following
the put-back procedure is what shields us from a claim by our own customer for
taking their site down on a stranger's say-so.

**Where they file.** `https://{any-host}/api/counter-notice` — public, no login,
no JavaScript. It has to be reachable without an account on purpose: a host-scope
takedown 503s the site and freezes every client write, and an org-scope one keeps
the customer out of the console entirely. A counter-notice form behind a sign-in
is unreachable in exactly the circumstances it exists for.

**What the form collects**, all of it required, because a counter-notice missing
any element is not a weaker document — it is one with no legal effect:

1. **Identification of the material** and where it appeared before removal.
2. **A statement under penalty of perjury** that it was removed as a result of
   mistake or misidentification.
3. **Consent to the jurisdiction** of the Federal District Court for the
   subscriber's address — or, if they are outside the US, any district in which
   Aglyn may be found.
4. **Agreement to accept service of process** from the complainant.
5. **Name, postal address, telephone number** and an electronic signature.

### The clock, and why it is not yours to move {#counter-notice-clock}

§512(g)(2) gives a sequence with a deadline in it:

- **Promptly** send the complainant a copy and tell them the material goes back.
- Put it back **not less than 10 and not more than 14 business days** after
  **receipt of the counter-notice** — unless the complainant first tells us they
  have filed a court action seeking to restrain the subscriber.

Two things follow, and both are built rather than described:

- **The clock counts from when the subscriber pressed the button**, not from
  when you opened the queue. Time we take to process a counter-notice comes out
  of the remaining window; it is never added to the customer's lockout. A
  counter-notice forwarded eleven days late schedules the *same* restore date as
  one forwarded the same hour.
- **Forwarding schedules the reversal.** Moving a counter-notice to `forwarded`
  stamps the site's own suspension expiry (`suspendedUntilMs`) with the restore
  instant, so the lock lifts itself on the statutory date. There is no cron job
  to fail quietly and nobody to remember.

The queue shows the earliest and latest lawful instants either side of the date
we picked, so you can see it sits inside the window rather than take our word.

### The steps {#counter-notice-steps}

| Step | What it means | What it does to the site |
| --- | --- | --- |
| `received` | Filed by the subscriber. Nothing sent yet. | Nothing. The deadline is already running. |
| `forwarded` | Copy sent to the complainant — the §512(g)(2)(A) obligation. | Stamps the restore date onto the suspension. |
| `restored` | Access is back. | Withdraws the strike the original notice earned. |
| `suitFiled` | The complainant told us they filed a court action. | **Cancels** the scheduled restoration; the material stays down. |
| `withdrawn` | The subscriber took it back. | Cancels the scheduled restoration. |
| `rejected` | Not a counter-notice at all — a misfiled question. | Cancels the scheduled restoration. |

`rejected` is **not** a ruling on the merits, and must never be used as one. We
do not adjudicate a counter-notice any more than we adjudicate a notice.

**Two things forwarding will not do**, deliberately:

- It **never creates a suspension.** If the site is not currently suspended,
  nothing is written and the confirmation says so. Read that message: it means
  no put-back was scheduled, because there was no lock to schedule the end of.
- It **never extends one.** If the suspension already ends sooner than the
  statutory date, the sooner date stands. A subscriber asking for their site
  back must not be able to keep it down longer than staff imposed.

**An overdue restoration is a breach**, and the queue puts it at the top in red.
Restoring late is its own §512(g) failure, and unlike most things on this page it
is a harm *we* are causing to *our own customer*.

## Repeat infringers {#repeat-infringers}

§512(i) conditions the **entire** safe harbor — every limitation in §512, not
just the hosting one — on having adopted **and reasonably implemented** a policy
for terminating repeat infringers, and on informing subscribers of it. Providers
most often lose on the second half: a policy that exists as prose while nothing
counts anything is what courts have declined to credit.

**What counts as a strike.** One upheld copyright notice: a report with
`category: dmca` that **you moved to `actioned`**. Not a received notice — anyone
can send one, and counting receipts would let a competitor close a customer's
account with three emails. Not a phishing or malware takedown either; §512(i) is
about infringement.

**Counted against the workspace**, not the site. Someone who loses one site and
opens another in the same workspace has not been terminated in any sense the
statute would recognize.

**Strikes come off.** A strike is withdrawn when:

- you move the report back off `actioned` (`staffReversed`);
- a counter-notice runs its course and access is restored
  (`counterNoticeRestored`) — the process reversed the takedown, so a strike
  surviving it would count an infringement we just declined to affirm;
- the complainant retracts the notice (`noticeWithdrawn`).

Withdrawal *marks* the ledger row rather than deleting it, so the history stays
answerable.

### The threshold {#repeat-infringer-threshold}

| Strikes | Level | What happens |
| --- | --- | --- |
| 1 | Warned | Chip on the report row. Tell the customer. |
| 2 | Final warning | One more reaches the threshold. |
| 3+ | Termination threshold | **The queue refuses to close any further copyright report on that account until you record a decision.** |

That refusal is the point. It is **not** an automatic termination — closing a
paying customer's account on three assertions by strangers, with no human in the
loop, is nothing §512 asks for. The statute says "in appropriate circumstances",
and judging the circumstances is the part a person does.

**"Not this time" is a valid answer**, and it is recorded in the audit log
exactly like a termination. If two of the three strikes are the same complainant
over the same disputed license, say so and escalate — that *is* the policy being
reasonably implemented.

A strike count shown as blank means **unknown**, not zero: the queue looks up a
bounded number of accounts per page. Check the account directly before closing a
report on one of them.

## Known gaps {#known-gaps}

Honest list. Every one of these is a thing you will otherwise discover during an
incident.

- **Only the urgent categories are pushed at you.** A first report in
  `phishing`, `csam` or `malware` fans out through `notifyStaff` and appears in
  the console notifications menu for every staff-claim holder. Everything else —
  `dmca`, `impersonation`, `illegal`, `spam`, `other` — waits in the queue, and
  **opening the queue is the only way anyone learns about those.** That is a
  deliberate trade, not an oversight: notifying on every report would make the
  notification unread, and the one it would cost us is the phishing one. It does
  mean a copyright notice can sit for as long as nobody looks, so looking is a
  habit somebody has to keep.
- **The notification fires once per report, not per submission.** A reporter
  resubmitting cannot re-alert you, which is right — and also means a situation
  getting worse does not raise its voice.
- **The reporter is emailed their reference, when they left an address**
  (AGL-2400). This paragraph used to say the opposite — *"no
  auto-acknowledgment email to the reporter"* — and had been wrong since the
  receipt shipped. An anonymous report still gets nothing, correctly: there is
  nobody to write to, and the queue says so on the row rather than leaving you
  to infer it from an empty field.
- **Each row tells you whether that receipt actually left.** Three answers, and
  they are not interchangeable:
  - *accepted for delivery* — Resend took it. Not proof of delivery; a bounce
    afterwards is not visible from this page.
  - *no receipt reached them* — shown in red, with the reason. **This is work.**
    The reporter is holding nothing: no reference, no date, no evidence they
    filed. Re-send it by hand to the address on the row. A reason of
    `unconfigured` means this deployment has no outbound mail set up at all, so
    fix the environment rather than retrying; anything else means the provider
    refused that specific message.
  - *not recorded* — the row predates the record. Treat it as **unknown**, not
    as either answer.

  Why this needs saying at all: `aglyn.com` publishes DMARC `p=reject`, so a
  refused message is turned away at SMTP rather than landing in a junk folder.
  There is no copy of it anywhere, on either side — so this page is the only
  place the failure is knowable, and the reporter has no way to tell you.
  The failed-receipt count at the top of the queue describes the rows on
  **this page**, not the whole queue — unlike the urgent count beside it, which
  is the whole queue's.
- **`abuse@aglyn.com` and `dmca@aglyn.com` deliver** — confirmed 2026-08-19
  (AGL-1911) by reading Google Workspace group configuration, *not* by a test
  send. Both are Google Groups ("Legal - Abuse", "Legal - DMCA") with
  *Who can post* = **Anyone on the web**, no moderation, and a single member
  subscribed **Each email**. A test send could not have
  established this: AGL-1577's default routing accepts mail for *non-existent*
  `@aglyn.com` addresses too and suppresses the bounce, so "it didn't bounce" is
  equally true of an address that was never created. The check that can fail is
  `groups.google.com/a/aglyn.com/g/<name>` — it returns **404** for an address
  that does not exist.
  Each is a single-member group with no auto-acknowledgment, so a report sits
  unread and unacknowledged whenever its one member is away (AGL-2400).
  **The form is still the better route** — it captures the §512(c)(3)(A) fields
  a free-text email will not. If someone asks where to send a report, send them
  to `/api/report-abuse`; the address printed on the form is
  `support@aglyn.com`.
- **No NCMEC mechanics.** See [CSAM](#csam) — preserve, suppress, escalate.
  Still true, and the public form now says so by omission rather than
  claiming the opposite (AGL-2045). Building a real reporting path —
  registered CyberTipline account, the §2258A duties that attach with it,
  and retention — is a decision for the account owner, not something to improvise on a
  live report.
- **The designated agent is filed; the required publication is not.** The
  registration is live (`DMCA-1038349`, active 2026-08-18). What is missing is
  the §512(c)(2) publication of the agent's four details and the §512(i)
  repeat-infringer policy text on `/legal/dmca` — AGL-2035 and AGL-2007, both a
  besigner publication pass. See [the DMCA path](#dmca).
- **Forwarding a counter-notice is a manual send.** The queue records that you
  forwarded it and schedules the put-back; it does not email the complainant for
  you. You send the copy — including the subscriber's name, address and phone,
  which §512(g)(2)(A) requires us to pass on — and then mark the step. Marking
  `forwarded` without actually sending it schedules a restoration while leaving
  the complainant unaware, which is the one sequence here that harms the party
  who did nothing wrong.
- **A counter-notice with no notice reference cannot withdraw its strike.** The
  subscriber is not required to quote one and the form does not insist. When it
  is missing, restoring leaves the strike standing — match it up and reverse the
  report by hand.
- **Nothing warns the customer that they are on a strike.** The count is staff-
  side. §512(i) requires subscribers to be informed of the policy, which the
  published policy does; telling *this* customer about *this* strike is still a
  message a person sends.

## Related {#related}

- [Lockdown](/staff-console/lockdown) — the levers a report is actioned into.
- [Incident response](https://github.com/aglyn/aglyn/blob/main/docs/INCIDENT_RESPONSE.md)
  — the wider runbook this queue feeds.
- [Breach notification](https://github.com/aglyn/aglyn/blob/main/docs/BREACH_NOTIFICATION.md)
  — when a report turns out to be a personal-data incident rather than an abuse
  one.
