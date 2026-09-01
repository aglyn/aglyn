---
sidebar_position: 1
title: Staff Console (internal)
description: Aglyn-staff tools for managing organizations, entitlements, users, and audits.
---

# Staff Console (internal)

:::warning Aglyn staff only
This area documents internal tools available to **Aglyn staff** with a staff claim. It's
not accessible to regular host owners.
:::

The **staff console** is where Aglyn operators manage the platform and support customer organizations.

## Runbooks — read these before you need them {#runbooks}

Every doc below is written to be followed under pressure, which is exactly when
nobody has time to find it. Until AGL-2141 this index linked none of them, while
two of them told the reader to pre-read a third.

| When | Runbook |
| -- | -- |
| A customer wrote in | **[Support triage](support-triage.md)** — priority ladder, the billing answers, and every escalation route out of a ticket |
| The site is down or degraded | [Incident response](https://github.com/aglyn/aglyn/blob/main/docs/INCIDENT_RESPONSE.md) · [Platform health board](platform-health.md) |
| Personal data may have left | [Breach notification](https://github.com/aglyn/aglyn/blob/main/docs/BREACH_NOTIFICATION.md) |
| Someone reported abuse, DMCA or CSAM | [Abuse reports](abuse-reports.md) |
| An asset or a whole org has to be shut off | [Lockdown](lockdown.md) — feature locks, read-only mode, org suspension, and the [asset quarantine runbook](lockdown.md#quarantine-keys) |
| Data has to be restored | [Disaster recovery](https://github.com/aglyn/aglyn/blob/main/docs/DISASTER_RECOVERY.md) |
| A DSAR or erasure arrived | [Privacy requests](https://github.com/aglyn/aglyn/blob/main/docs/PRIVACY_REQUESTS.md) |

![The staff organizations directory](/img/staff-console/admin-orgs.png)

![The staff audit log](/img/staff-console/admin-audit.png)

![The Password card on a user's staff detail page, offering a reset email or a directly
set password](/img/staff-console/admin-user-password.png)

## What's there

### Staff overview {#staff-overview}

Platform metrics, the newest organizations, purchases, and
per-org usage; plus search. The **MRR estimate** counts only organizations with a
live Stripe subscription — staff plan overrides, comped accounts, and canceled or
unpaid subscriptions contribute $0, and annual plans count at their per-month
equivalent rather than the month-to-month price. The tile shows how many
organizations are billing and how many are comped, so a paid plan that bills
nothing never inflates the headline.

### [Support queue](support-queue.md) {#support-queue}

Every organization's support tickets in one
triage list: filter by open/closed, reply as Aglyn staff, close or reopen.

### Plugin reviews & realm trust {#plugin-reviews}

The marketplace review queue, plus a
**Listed plugins — realm trust** table for granting or revoking
[realm trust](../developers/plugins/guides/realm-bundles.md#granting-trust-staff)
per version.
Rejecting a version is a **verdict, not a kill**: it stops new installs, but a
site already pinned to those bytes keeps running them. Where that has happened
the review panel says so and offers **Stop this version**, the per-version kill
switch — every site pinned to it renders a placeholder on the next load, and
the rest of the listing's versions are untouched. **Taking the listing down**
is the wider hammer: it stops *every* version, including the approved one
customers are using. Restoring a listing clears only what the takedown did, so
a version stopped separately stays stopped.

### Organization management {#organizations-admin}

Audited plan and entitlement overrides, suspension,
and GDPR-erasure flags, per organization. The directory is listed server-side with
the Admin SDK (so it shows *every* org, not the subset client rules would return),
ordered by organization id, 25 per page with Previous/Next.

#### Free workspace limit {#free-workspace-limit}

How many **free** workspaces one account may hold, on a card at the top of the
organizations page. Every free quota in the product — sites, media, bandwidth,
Assist messages, form submissions, contacts — is counted per workspace, so
without this ceiling one account multiplies the whole free allowance by however
many workspaces it opens. The default is **three**.

What is counted is free workspaces the account **owns now or created**. Three
consequences worth knowing before you answer a ticket about it:

- **Paid workspaces do not count.** An agency or consultant whose workspaces
  are paid is unaffected at any number. A workspace whose subscription lapses
  becomes free again and counts again.
- **Being invited to somebody else's workspace never counts.** A contractor on
  ten client rosters owns none of them.
- **Handing a workspace to another account does not free a slot**, because the
  creator is recorded separately from the owner. That is deliberate: otherwise
  "transfer it to an alt account, create another, take it back" would be a way
  round the ceiling. Deleting a workspace *does* free a slot — the allowance it
  was consuming went with it.

Changing the number needs the **super** staff role and is audited with a
before, an after and a typed reason. It takes effect within fifteen seconds
across the platform and needs no deploy. **Lowering it never removes anybody's
workspaces**: an account already over the new number keeps every one and simply
cannot create another. Staff creating a workspace on a customer's behalf are
exempt from the ceiling entirely.

A person who hits it sees the number, and is told to upgrade one, delete one,
or ask us — so "support raised it for this account" is a real answer. Today
that is done by raising the platform number; there is no per-account override.

### Entitlement editor {#entitlement-editor}

Full override editor for an organization's entitlements,
its plan, and per-organization release flags. Every override needs a **reason**
chosen from a fixed list (negotiated contract, support remediation, early access,
correction, sales trial, or *other* — which requires a note). The reason and note
are written onto the audit row beside the before/after and shown wherever that row
is: the audit log, the organization's own page, and the acting staff account's
trail. The log is append-only, so a reason not given at the time cannot be added
afterwards. The reason is checked by the **server** that performs the override,
not only by the dialog, so a request without one is refused rather than applied.
The database now refuses a plan, entitlement or release-flag change made any
other way, so that server is the *only* route an override can take and the
reason cannot be skipped by going around the console.
Changing an organization's release flags needs the **super** staff role; plan and
entitlement changes are open to **billing** staff as well.
**Clearing an override removes it.** Emptying a quota field, or setting a feature
or release flag back to *Inherit*, deletes that override on save and hands the
organization back to its plan default — one at a time, so the overrides you leave
in place are untouched. **`0` is not empty**: a quota of zero is a real override,
a cap of none (a comped 0% fee, an organization held to no POS registers), and it
is kept. A quota field that cannot be read as a number of 0 or more refuses the
save rather than being ignored.
The override and its audit row are saved **together** — either both land or
neither does. Read the message on a failure rather than assuming: it says
*"nothing was written … safe to retry"* when the server refused the change, and
says the outcome is **not known** when the request never got an answer (a dropped
connection, a gateway error). In that second case, check the organization and the
audit log before saving again — saving blind would record a before-state that is
already overridden.

### Users admin {#users-admin}

Staff-claim management and disabling users, with gated listing
and an **exact-email lookup** for accounts beyond the loaded pages. Staff access is
granted to an **existing** account, so if someone isn't found, have them sign in to
Aglyn once and then search their email again.
Each account opens a **detail page** showing identity/auth state, staff role, every
organization membership with roles and per-site access, and its recent audit trail.

A **Legal acceptances** card on the same page answers the two questions a terms
dispute asks: which version of the Terms and Privacy Policy this person accepted and
when, and whether the **30-day arbitration opt-out window** (ToS §18.5) is still open.
The window runs from the person's **first** acceptance of any version, so a later
re-acceptance does not restart it. Each row carries the content hashes of the exact
documents that were shown, the door the acceptance came through, and the IP recorded
at the time. The card is read-only — those records are evidence about the account
holder, and nothing in the product can add, amend or delete one.

If the card says the records **could not be read**, that is not the same as "no
acceptance on file": do not answer a dispute from that screen until it loads. An
account can also legitimately have no record — accounts created before clickwrap
capture, and SSO/invite doors, never passed a consent checkbox. Those accounts are
asked to accept by a banner in the console the next time they sign in, as is anyone
whose accepted version has been superseded by a newer publish.

### Password help {#password-help}

On that detail page, a **Password** card can email the account a
reset link, or set its password directly for an account that cannot receive mail.
Setting a password revokes the account's refresh tokens (so every device signs out)
and emails the holder that an admin changed it. Both actions need the **super** staff
role and are audited; the password itself is never recorded. An account with no email
address supports neither.

### Sign one device out {#sign-one-device-out}

A **Sign-in history** card on the same detail page lists every device that has signed
in to the account — browser and system, location, IP, first and last seen — and can
end the sessions on one of them. It is the answer to *"someone stole my laptop"* when
the person cannot reach their own Security tab, which is most of those calls.

Use it instead of **Disable**. Disabling takes the account away: they cannot then sign
in on their phone and carry on working. This does not touch the account or the
password.

**Read the confirmation out loud before you click it.** Two things are true and both
surprise people:

- **Every device signs out, not just the named one.** Firebase has no per-device
  refresh-token revocation, so the only lever that reaches the stored credential in
  another browser is account-wide. What *is* per-device is what happens next: the
  signed-out device is refused every time it tries to come back, because it cannot
  produce a fresh authentication, while the account holder signs in again normally and
  keeps working. The honest sentence is **"everyone signs out once, you sign back in,
  that device does not."**
- **A page already open on the signed-out device may keep reading *and writing* data
  for up to an hour.** Anything that goes through our servers stops within about
  fifteen seconds. Direct database access from a tab that is already open survives
  until its token expires — security rules key on that token, and they do not ask
  whether the session was revoked, so the tab keeps whatever write access the account
  had. It cannot get another token. Uploaded files are the exception: storage is
  closed to the client entirely, so those stop at once. Say this plainly to the
  account holder rather than implying the residual is read-only.

If the account holder may still have working sessions they do not recognize — or the
device is one you cannot see in the list — **change the password too**, which revokes
on the same terms and additionally takes back the credential.

Super staff only, and audited with the device id and the account. The account holder
has the same control themselves under **Manage account → Security → Recent sign-ins**.

If the card says the registry **could not be read**, that is not the same as "no other
devices": do not tell anyone their account is clean from that screen until it loads.

### Email delivery {#email-delivery}

An **Email delivery** card on the same detail page answers *"they say they never got
it."* It lists every message we sent the account's address, newest first: the subject,
which of our senders produced it, when it was sent and delivered, and whether it was
opened or clicked.

Read it before you resend anything. The four states that change what you do next:

- **Delivered, not opened.** It reached the mailbox. Check the spam folder with them
  rather than sending it again — a second copy lands in the same place.
- **Bounced.** The mailbox rejected it. A *permanent* bounce means the address does not
  exist, so correct the address; a *transient* one is a full mailbox or a busy server
  and will clear on its own. A permanent bounce also adds the address to the
  do-not-contact list, which is why their newsletters stopped.
- **Spam complaint.** Somebody pressed *report spam* on a message we sent. Never resend
  marketing to that address; transactional mail still goes.
- **Nothing at all.** See the limits below before concluding we never wrote to them.

**Open a row** to read the message itself. The dialog shows the full envelope —
from, reply-to, cc, message id — the timeline with a timestamp per state, the open and
click counts, every link the recipient actually followed, and the message rendered as it
was sent, with a plain-text tab beside it.

The body is fetched from the sending service at the moment you open it; we do not keep
copies of messages, which would mean storing every reset link and receipt we have ever
sent. Two consequences worth knowing: a message the service has aged out says so rather
than showing you a blank preview, and opening one is recorded in the audit log, because
reading somebody's mail is a legitimate support action and a sensitive one.

Links in the preview are inert on purpose. It is rendered in a locked-down frame with no
scripts and no navigation, so nothing in a customer's mail can act on your session — and
you cannot burn a single-use reset link by clicking it out of curiosity. The links the
recipient followed are listed separately, as text.

**Opens are approximate; clicks are not.** An open is recorded by a hidden image, and
most inboxes block images by default — a message with no open was very often read. A
click is a real action and can be trusted. Say it that way to the account holder rather
than telling them our records show they did not read it.

**What the card cannot see.** The history is built from delivery events reported by the
sending service, which only start when that feed is connected. Nothing sent before then
appears on its own — see *Import delivery history* below. Nor does mail sent to a
*different* address than the one on the account now: the log is filed by address, so an
account whose email was changed keeps its older mail under the old one. An empty table is
not proof that nothing was sent.

### Import delivery history {#import-delivery-history}

On **Staff → System emails** there is an **Import delivery history** card. It reads the
sending service's own record of already-sent mail and files each message under its
recipient, which is what puts pre-existing mail on the Email delivery cards.

Run it once after connecting the delivery feed, and again any time the feed was down for
a stretch. It is safe to run as often as you like: a message the live feed already
recorded is left untouched, and no open or click counts are invented — the history only
reports a final status per message, so an imported row shows *delivered* or *bounced* but
never "opened three times".

Two things imported rows do not carry, because the history does not include them:

- **Which of our senders produced the message.** That comes from a tag on the send, so an
  imported row shows the subject and no sender label.
- **Open and click counts.** Only the live feed reports those. A message that arrived
  through the import shows engagement only from the moment the feed picked it up.

It needs its own credential — a full-access API key in `RESEND_READ_API_KEY`. The key
that sends your mail is scoped to sending and cannot read message history, which is the
correct posture for it: a leaked sending key should not be able to list everyone you have
ever emailed. Without that variable the card says so and changes nothing.

If the card says the log **could not be read**, that is not the same as "we never
emailed them": do not tell anyone their mail was or was not sent from that screen until
it loads.

The record is ours, not the sending service's. It survives that vendor's own retention
window, and it survives replacing the vendor.

### Staff notes {#staff-notes}

Free-text support/billing context on each organization's detail
page, visible to staff only (never in tenant-readable data) and audited.

### Broadcast announcements {#broadcast-announcements}

Push a product announcement or maintenance notice as
an in-app notification to every organization's owner/admins (optionally one plan
tier), respecting each recipient's mute preferences; audited.

### Billing insight {#billing-insight}

Every organization's Stripe **invoice history** and default
**payment method** (with delinquency state) render on its detail page.

### [Refunds](refunds.md) {#refunds}

Directly under the invoice history, **Refund a charge** issues a full or partial
refund against one of that organization's charges without leaving Aglyn. Any staff
role can read the charges and how much of each is already refunded; **issuing** one
is `super`, because it is the only staff action that sends money out. A reason is
required, the confirmation names the amount and the charge, and the result is
audited — see the [refunds runbook](refunds.md) before you use it, particularly on
why a refund is a loss rather than a reversal.

### Impersonation {#impersonation}

Staff can open the console as a customer account (audited **with a
required reason**, AGL-2125 — the dialog will not submit without one; a
pinned warning banner with one-click exit shows for the entire session; staff
accounts cannot be impersonated).

### System emails {#system-emails}

The mail Aglyn itself sends (organization invites, the monthly
usage summary, internal alerts). Each one ships with built-in copy and can be
replaced with a designed template built in the besigner, using email-safe blocks
only. Set the subject and preheader from the editor's **Properties** panel; merge
tokens the email supplies are listed there, and any token left unresolved is blanked
before sending. **Reset to default** puts the built-in copy back.
The list is generated from the emails the product actually sends, so staff edit the
system emails that exist — adding one is a code change. Password reset and email
verification are Aglyn's own and are fully editable. Billing emails — receipts, failed
payments, refunds — are sent by Stripe from its Dashboard and are listed read-only.

#### Platform send rate {#platform-send-rate}

At the top of the same page. Everything Aglyn sends leaves on **one** Resend key
and the provider's rate limit is per account, so a throttle lands on every
customer's password resets at the same time whatever domain each site sends
from. This is the ceiling on outbound mail per hour across the whole platform,
and it is a **value, not a deploy**: a sending-domain warm-up or a
deliverability incident is handled by changing the number here.

Reputation is not shared the same way the rate limit is. Under a `p=reject`
DMARC record, a hit is a rejection rather than a spam folder — and which mail it
reaches depends on the domain: the platform's own account mail is on its own
name, a site with a sending domain of its own carries its reputation alone, and
the sites with none share one of four pooled members, which is why only
transactional mail leaves on those.

The card shows the current hour's volume beside the ceiling, because the
question during an incident is never "what is the limit" but "are we near it".

**What the ceiling can and cannot do.** It can defer a marketing **campaign**
and a scheduled **bulk sweep** (the monthly usage summary). It can **never**
refuse transactional mail — password resets, invites, order receipts, booking
reminders — at any value. Those are counted, because the ceiling is about total
volume through the provider account, but they send regardless.

Nothing is lost when the ceiling bites. A scheduled campaign over it goes back
to `scheduled` and the 15-minute processor picks it up in the next window; a
usage-summary run stops without stamping the orgs it did not reach, and the
hourly firing on the 1st and 2nd of the month mails them.

Reading the value needs any staff role; **changing it needs `super`**, the same
bar as feature flags, and every change writes an audit row with the before, the
after and the reason typed into the **Why** box.

### [Feature flags](feature-flags.md) {#feature-flags}

Release-gate console features via Remote
Config, with percentage rollout; staff preview everything.

### [Multi-tenant architecture](architecture-multi-tenancy.md) {#multi-tenant-architecture}

How organizations,
membership, security rules, subdomains, and billing attribution fit together.

### Audit archival {#audit-archival}

A nightly cron moves audit entries past the 90-day retention
window into a Storage compliance trail (JSON lines, month-partitioned) and reminds
staff of GDPR erasure requests past their 7-day hold.

### [Organization suspension](lockdown.md) {#organization-suspension}

A staff toggle that serves 503s on the org's sites and shows the
owner a banner.

### [Sales tax return](sales-tax-return.md) {#sales-tax-return}

The quarterly Texas return: pick a
period, read the Form 01-114 figures for Texas, see every row the sweep could not
fully read, and export the working papers for the Webfile session.

### Audit log viewer {#audit-log}

A record of staff actions.

### Coupons {#coupons}

Discount codes for **Aglyn's own subscriptions**. They live in Stripe — the console
creates them there and reads them back, so a coupon made in the Stripe Dashboard shows
up here and vice versa. Nothing on this page touches the discount codes a *customer*
creates for their own storefront; those belong to the commerce plugin on their site.

**Create a coupon** takes a name (the text that appears on the customer's invoice), a
type — **Percent off** or **Fixed amount off** — a **Duration** of *Once*, *Repeating*
(for a number of months) or *Forever*, and optionally a **redemption code**, a **max
redemptions** cap and an expiry date. A coupon with no code is applied by staff to a
subscription; a coupon with one can be typed by the customer at checkout.

Before you commit, the form shows a **net-margin rating** for the discount — what is
left after Stripe's fees and the plan's own cost. It is illustrative only: the binding
check runs on the server when the discount is actually applied, so a rating that looks
survivable is not permission.

That percentage is a **contribution margin**: net revenue less infrastructure COGS, and
nothing else. Support, customer acquisition and overhead are not in the figure anywhere,
so treat it as a ceiling rather than a profit. The infrastructure number behind it is a
per-site floor for almost every organization — measured usage only replaces it once it
costs more than the floor, which no organization's usage does yet.

**Existing coupons** lists every Stripe coupon with its promotion codes, redemption
count, and a **valid** or **expired** state.

Each promotion code carries **Activate** / **Deactivate**. Checkout only resolves a code
that is active, so a deactivated code is reported to the customer as one we do not
recognize — deactivating is how a code is pulled mid-campaign, and activating is how a
code that was turned off is put back. Both directions ask for confirmation first and are
recorded in the staff audit log; turning a code back on for a discount of 40% or more
also asks for the same sign-off creating it would. A discount already applied to a
subscription is unaffected either way.

### Do not contact {#contact-suppressions}

The platform do-not-contact list for **phone numbers** — calls and texts. It is not the
email unsubscribe list; email opt-outs live with the campaign that sent them.

Aglyn sends no marketing calls or texts today, and the page says so: there is no consent
record behind them yet. The list exists so that an outbound program has something to
check the day one starts, and so that an opt-out we receive *now* is not lost.

**Record a request** is for an opt-out that arrived outside the product — by email to
privacy@aglyn.com, or spoken on a call. Give the number, how the request arrived (*Said
on a call*, or *Other / staff*), the channel it covers (**Calls** or **Texts**), and a
note. Replying STOP to a text will be handled automatically once texting exists; this
form is for everything that does not arrive that way.

If they also asked us to **delete the number we hold**, tick that box and give the
account uid. The number stays on the suppression list — that is the only thing that
keeps it from being dialled again — and what is deleted is the copy on their profile,
with SSO blocked from re-asserting it on the next sign-in.

A suppression **outlives the contact record**, and it can be undone: a number the person
later opts back in for is marked **Opted back in** rather than removed, so the history of
what was asked and when survives.

### Access {#access}

Access is gated on a **staff claim**, enforced per handler and by scoped Firestore
rules. The area doesn't advertise itself: `/admin/*` returns a plain **404** to anyone
without the claim, and the **Staff console** entry is hidden from the account menu
rather than shown-and-refused.

:::note Internal documentation
Deeper runbooks for staff operations live with the platform ops docs, not in this public
site.
:::

## Which identity holds staff

A staff claim lives on **one Firebase Auth user record**, and Aglyn has more than one
pool of them: the project-level pool, plus a separate pool for every organization
using [SAML SSO](../enterprise/sso.md). The same person can exist in two pools with
two different records, and **a claim on one is invisible to the other** — which is
why a grant can look successful while the person still gets a 404.

**Staff can be granted to any identity.** SSO is an option, never a requirement:

- an SSO identity in Aglyn's own tenant;
- an identity in the project pool, signing in with a password or Google;
- an SSO identity in a **customer organization's** tenant.

All three are valid and supported. When a grant is made, the audit row records the
**pool** alongside the uid, because a uid on its own does not identify an account when
two pools can hold the same one.

### Staff inside a customer's tenant — a property worth knowing

If a staff claim is granted to an identity that lives in a *customer's* SSO tenant,
**that customer's IdP administrator controls authentication for it.** They cannot mint
a staff claim — the claim is Aglyn's — but they control who can authenticate *as* the
identity that holds one, and they control whether it keeps existing.

This is allowed and sometimes unavoidable. Two things make it safe to live with:

- prefer granting staff to an identity in a tenant Aglyn controls, where there is a
  choice;
- treat a customer-tenant staff grant as a **reviewable** row: it is exactly what a
  staff-access review should be looking at, and the staff user list shows the tenant
  so it is not an undifferentiated email address.

### Offboarding

How a staff person is removed depends on which identity holds the grant:

1. **Revoke the staff claim** in the users admin. This is the step that always applies,
   and it targets the pool the identity actually lives in.
2. **Disable or delete the account** in whichever directory owns it — Google Workspace
   for an `@aglyn.com` identity, the customer's IdP for a customer-tenant identity, or
   Firebase Auth directly for a project-pool account.

Revoking the claim is not instant on its own: a claim change reaches a signed-in
session at its next **ID-token refresh**, which the console forces once per page load,
so a reload picks it up within about an hour at worst. When speed matters, disabling
the account and revoking its refresh tokens ends the session immediately.

## Break-glass access

**One consumer Google account — outside the Workspace domain, in the project pool
rather than the SAML tenant — holds `super` staff permanently and by design.** It is
not an oversight, not a migration leftover, and should not be "tidied up" — it is the
account that still works when SSO does not. Which account it is belongs in the
password manager, not in a published page: naming it here would hand an attacker the
one identity that is outside Workspace enforcement. If SAML is
misconfigured, the IdP is down, or a domain rule is set wrong, this is the way back in.

It is a deliberate trade, and the cost is real: an identity outside Google Workspace
has **no enforced MFA, no central offboarding, and no admin session revocation.** The
whole mitigation sits on the Google account itself —

- strong two-factor, ideally a **passkey** or hardware key;
- a unique password, never reused anywhere;
- treated as a privileged credential, because it is one.

The rule below is written so it can never refuse this account: the account is on an
ungoverned domain, so it falls outside the rule by construction rather than by an
exception someone has to remember to maintain.

## Requiring SSO for a company domain

An operator can require that **every identity on a given email domain authenticates
through a specific SSO tenant.** The point is narrow: an address on a company domain
that signs in with a password or a personal Google account looks like a company
identity while being governed like a personal one — outside the directory's MFA,
offboarding and revocation.

**This is a rule about a domain, not about staff.** It applies whether or not the
person is staff, and it never requires staff to use SSO. Staff on other domains are
untouched.

Two settings, both empty/off by default:

| Setting | Meaning |
| --- | --- |
| `AGLYN_SSO_REQUIRED_DOMAINS` | `domain=tenantId` pairs, e.g. `example.com=example-tenant`. Empty means no domain is governed. |
| `AGLYN_SSO_DOMAIN_ENFORCEMENT` | `on` to refuse non-compliant sign-ins. Anything else is off. |

Both must be set for anything to be refused, and only one case is ever refused: an
address on a governed domain signing in with **no SSO tenant at all**. An identity on a
governed domain that signs in through a *different* tenant is allowed and flagged for
review, not blocked.

:::info Self-hosting
These default to empty, so a self-hosted install governs nothing unless its operator
configures it — with **their** domain and **their** tenant. Aglyn's own domain is not
compiled in anywhere.
:::

Turning enforcement on is a one-way door for anyone it refuses, so before flipping it:

1. confirm SSO staff access works through a **real sign-in**, not a token inspection;
2. migrate or retire every existing identity on the governed domain that has no tenant
   — including **automation accounts**, which are easy to forget and will simply stop
   being able to sign in.

## Why am I getting a 404?

`/admin/*` returns a plain 404 with no explanation, deliberately — a stranger should
not learn the staff console exists. That makes a *genuine* staff member's failure hard
to tell apart from a broken route.

`GET /api/auth/staff-self-check`, with your own ID token, answers it. It reports the
uid, email and pool of the session you are actually signed in as, whether that token
carries the staff claim, and — if **your own address** exists in more than one pool —
which of those records holds the grant.

It only ever reports on the caller's own identity, so it discloses nothing about anyone
else and cannot be used to find out who is staff.

## Related

- [Billing & plans](../workspace-and-billing/billing-and-plans/overview.md)
- [Single sign-on (SAML)](../enterprise/sso.md)
