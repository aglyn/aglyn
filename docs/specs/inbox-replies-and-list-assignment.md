# Inbox replies, and assigning a sender to a list

Status: **both are BUILT.** The reply shipped first; the list assignment was
specified here and deliberately held back, and it shipped once its three
blockers cleared. Written 2026-08-29 against `main` at `c08f3b93c`; Part 2
rewritten 2026-08-29 when it was built. It follows and depends on
`docs/specs/email-overhaul.md`, which established the state of the email
feature; every claim here that is about email in general is cited to that
document rather than re-derived.

> **Part 2 was written as a plan and is now a record.** The three blockers it
> named are each marked with what cleared them and where the built thing
> lives. The reasoning is kept rather than replaced: the argument for NOT
> building it is what made the shape it was eventually built in, and a
> document that erased it would invite the next person to build the version
> this one refused.

> ⚠️ **House convention note.** Design specs in this repository live in
> `docs/design/` and are named `agl-####-slug.md`. This file sits beside
> `docs/specs/email-overhaul.md` instead, because it continues that document
> and no issue id was opened for it. If it is adopted it should move and take
> a number, so the doc guards see it where they expect it.

> ⛔ **No Linear issue was opened or read while writing this.** No `AGL-` id is
> cited anywhere below. The issue-creation freeze is respected: this document
> proposes work, it does not file it.

---

## Verdict up front — as written, and what changed

**Replying is a transactional act with an owner already identified — it was
built. Assigning someone to a list is a marketing act whose consent basis does
not exist anywhere in the data model — it was not.**

> ✅ **The second half no longer holds, and that is why the feature exists
> now.** A consent basis exists in the data model and is read at send time:
> `libs/aglyn/src/lib/app-utils/marketing-consent.ts` decides
> `granted`/`declined`/`unrecorded`, `performCampaignSend` joins on it at the
> audience sweep, and `enrollListMember` persists it on the membership. The
> three facts below were each true when written and each has been closed —
> see Part 2's blocker list for which change closed which.

The distinction is not stylistic. The email overhaul spec's §1d found that
`marketingConsent` is written by six call sites and read by **no sender**.
Adding a seventh writer — a list-assignment button that stamps a consent field
on a member document — would produce exactly the defect that audit named: a
consent signal that is captured and never consulted, on a screen that tells the
merchant a check was performed. That is worse than the absence of the button,
because it manufactures the appearance of compliance.

Three facts settle it, and each was verified in code rather than assumed:

1. **The audience a sender would join has no consent field.**
   `orgs/{orgId}/lists/{listId}/members` documents carry `email`, `name`,
   `source` and `addedAt` and nothing else. Confirmed at both writers:
   `libs/plugins/commerce/src/lib/server/newsletter.ts` and the `enrollList`
   branch of `libs/tenant/runtime/src/lib/run-event-actions.ts`.
2. **No send path reads consent, so a field added there would be inert.**
   `performCampaignSend` in
   `libs/plugins/marketing/src/lib/server/campaign-send.ts` filters an audience
   against `hosts/{hostId}/suppressions` and nothing else.
3. **A form submitter has no consent record to copy through.**
   `apps/tenant/app/api/forms/submit/route.ts` calls `upsertHostContact` with
   `source: 'form'` and does **not** pass `marketingConsent`, so the org contact
   it creates carries no consent flag. An assignment that read a consent record
   would therefore refuse essentially every sender in the Inbox — and one that
   did not read it would be enrolling people who never opted in.

Fact 3 is the one that makes this a policy question rather than an engineering
one. There is no correct code to write until someone decides what basis a
merchant may assert.

---

## Part 1 — What was built

### 1a. The slice

One narrow act: **reply to one submission, by email, from the reader dialog.**
Nothing else. No bulk reply, no templates, no scheduling, no inbound mail.

| Piece | Where |
| --- | --- |
| Pure policy — who may be replied to, and what the message says | `libs/plugins/inbox/src/lib/model/reply-policy.ts` |
| The handler, `POST inbox/reply` | `libs/plugins/inbox/src/lib/server.ts` |
| The composer, inside the submission reader | `libs/plugins/inbox/src/lib/components/submission-reply.component.tsx` |
| Registration | `plugins.config.json` → `consoleApi: registerInboxConsoleApi`, prefix `inbox` |

### 1b. The three design questions, answered

**Threading — what makes a reply part of a thread?**

Nothing on the wire, and that is a finding rather than a shortcut. A submission
arrives as an HTTP `POST` to `/api/forms/submit`; it is not a message and it has
no `Message-ID`. There is therefore no identifier for `In-Reply-To` or
`References` to name, and a synthesized one would reference a message no mail
server has ever seen — which threads nothing and makes some filters treat the
message as forged. **A reply is always the first message in its conversation.**
The only thing that groups it in the recipient's client is the subject.

The thread the *merchant* sees is ours, stored at
`hosts/{hostId}/formSubmissions/{id}/replies/{replyId}`, and it is one-sided by
construction — it holds what was sent and can never hold what came back.

**Reply-To — where does the customer's answer go?**

To the console account that pressed Send (`decoded.email` from the verified ID
token). It does **not** come back to the Inbox, because nothing here receives
mail: there is no inbound route, no MX record pointed at this platform, and no
parser. The composer says this in the UI rather than in a docs page, because a
merchant who does not know it will wait in the Inbox for an answer already
sitting in their own mailbox.

A handler that could not resolve an address for the acting account refuses the
send rather than inviting a reply into an unmonitored mailbox.

**Sender identity — who does the reply appear to come from?**

`"<fromName>" <USAGE_EMAIL_FROM>` — the one verified platform identity, with
only the display name varying. Per-org sending domains do not exist in any form
(email-overhaul §1c: zero product code matches SPF, DKIM or DMARC).

`fromName` comes from `resolveBrandingProfile(org).fromName`, the shared
resolver every other sender uses. **It is entitlement-gated**: an org without
`whiteLabel` gets `PLATFORM_BRANDING_PROFILE.fromName`, which is the platform's
own name. So a merchant on a plan without white-label replies to their own
customer under this platform's name, from `noreply@`.

**Is that acceptable?** For a one-off transactional reply, with `Reply-To`
pointing at a real human, it is tolerable and it is what every other
transactional message in the product already does. It is **not** a good answer,
and it is the reason `Reply-To` is load-bearing here rather than a nicety. The
fix is email-overhaul Phase 4 (custom sending domains); the interim question of
whether the *site's* name may lead the From line on a non-white-label org is
put to the owner in Part 3, Q3, because answering it by hand would hand a paid
capability to every plan.

**Where the reply is stored, and does the Inbox become a mailbox?**

Stored under the submission, as above. **The Inbox does not become a mailbox**
and this change deliberately does not move it toward one. A mailbox needs an
inbound route, a parser, an address per site or per submission, a threading
model, and a spam posture on received mail — a commitment several times the
size of this feature. The composer's copy states the boundary so the product
does not imply the commitment it has not made.

### 1c. How suppression is enforced

Both lists, on one key derivation, before anything is sent or metered:

- **Platform**, via `isEmailSuppressed` (`emailSuppressions/{sha256}`). It fails
  **closed** — a throwing read or an unkeyable address answers "suppressed".
- **This site**, via a direct read of
  `hosts/{hostId}/suppressions/{emailSuppressionKey(email)}`.

Both use `emailSuppressionKey`, so the two reads cannot disagree about which
document to look for. This is the first send path in the product to consult
both: email-overhaul D6 records that campaigns read only the per-host list, so
an address learned to be dead on transactional mail is still mailed by a
campaign. That defect is **not** fixed here — it is in `campaign-send.ts` and
fixing it belongs to that file's Phase 1 — but the reply does not reproduce it.

A refusal is a `409` naming which list held the address, surfaced to the
merchant verbatim.

### 1d. How consent is enforced

It is not, and that is the correct answer for this act. A reply is
transactional: the recipient asked to be contacted by submitting the form. No
marketing-consent record is required, none is read, and — the half that
matters — **replying grants nothing.** No contact is upserted, no consent flag
is written, no list is touched, and no `marketingConsent` is inferred from the
fact that a merchant answered someone. The two regimes stay separate in the
data as well as in the UI.

### 1e. The HTML part

Confirmed fixed and not reintroduced. `sendEmail` synthesizes an HTML part from
`text` at the one place all senders share
(`libs/shared/util/email/src/lib/text-email-html.ts`, wired in the payload
builder), so the handler passes **no `html` at all** — the failure mode was
`"html": ""`, and the way to keep it closed is to have no second place that can
get it wrong. There is an assertion for this, and it goes red when an empty
`html` is added.

### 1f. Metering and rate

`meterHostEmail(hostId, 1, 'transactional')` — the cost meter only, never the
campaign meter a plan limit may refuse. Answering a customer cannot exhaust the
allowance that sends a newsletter.

No `priority` is passed, so it resolves to `transactional`, which the platform
hourly governor may never refuse. That is the right class: a reply cannot be
deferred to a later window because nothing sweeps it up and sends it tomorrow.

`inbox/reply` is deliberately **not** on the machine-path exemption list in
`plugin-api-rate-limit.ts`. A person pressing a button in a browser is far below
the per-(site, IP) visitor budget, and being limited is the right default for a
surface that puts mail on the wire.

### 1g. What the handler refuses

| Condition | Answer |
| --- | --- |
| No `Authorization: Bearer` | `401` |
| Role below `editor` on the host | `403` |
| Acting account has no email address | `400` |
| Submission or host missing | `404` |
| Form carried no email field, or an unroutable one | `422`, naming which |
| Address on either suppression list | `409`, naming which |
| Provider refused the send | `502`, and **nothing is written** — no reply record, no `repliedAtMs`, no meter |

The recipient is resolved **server-side from the stored submission** and a `to`
in the request body is ignored. A site editor who could name the recipient would
have a send surface pointed at any address, on a verified domain, under this
platform's name.

### 1h. Storage and rules

`hosts/{hostId}/formSubmissions/{id}/replies/{replyId}`, holding `to`,
`subject`, the merchant's `message`, `replyTo`, `fromName`, `sentByUid`,
`providerMessageId` and `sentAtMs`. The submission itself gains `repliedAtMs`
and is marked read in the same write.

**No Firestore rules change was needed**, and this is worth recording because it
is easy to get wrong in the other direction. The host subcollection catch-all
matches `{subcollection}/{document=**}`, so a document at
`formSubmissions/.../replies/...` is governed by the `formSubmissions` entry —
which is on the **create** deny list. Client creates are therefore already
refused and only the Admin SDK can write a reply record, while host members can
read one. That is exactly the posture a record of "a message left the building"
requires: a client-forged row would claim a send that never happened.

Update and delete on that path stay open to host members, inherited from the
same catch-all. That is the existing posture for the submission itself and is
not changed here; it is noted rather than hidden.

### 1i. Tests

`libs/plugins/inbox/src/lib/model/reply-policy.spec.ts` (21),
`libs/plugins/inbox/src/lib/server.spec.ts` (18),
`libs/plugins/inbox/src/lib/components/submission-reply.spec.tsx` (9).

Every one of the 33 new assertions was verified by mutating the source and
watching it fail. The mutation list is recorded in the commit message.

---

## Part 2 — Assigning a sender to a list

Written as what building it would require; kept as the record of what was
built, because the shape is the one this section specified.

### 2z. Where it lives

| Piece | Where |
| --- | --- |
| Pure policy — what basis an enrollment may carry | `libs/plugins/inbox/src/lib/model/list-assignment-policy.ts` |
| `POST inbox/assign-list`, and `POST inbox/list-options` for the readout | `libs/plugins/inbox/src/lib/server.ts` |
| The card, inside the submission reader and beneath the reply | `libs/plugins/inbox/src/lib/components/submission-list-assignment.component.tsx` |
| The basis on the membership, and the refusal backstop | `libs/tenant/data/admin/src/lib/server/list-members.ts` |

Assertions: `list-assignment-policy.spec.ts` (13),
`server-assign-list.spec.ts` (25),
`submission-list-assignment.spec.tsx` (9), and the end-to-end
`apps/console/specs/an-enrollment-is-not-a-license-to-send.spec.ts` (5), which
drives the real Inbox route and the real `performCampaignSend` against one
store. Every new assertion was verified by mutating the source and watching it
fail; the mutation list is in the commit message.

### 2a. What the act is

From an Inbox submission, put the sender onto an org list
(`orgs/{orgId}/lists/{listId}`) so that a future campaign can reach them. It is
**marketing enrollment**, not a CRM note, because the only consumer of a list is
`performCampaignSend`.

### 2b. The three blockers, in the order they must be cleared

**B1 — the member document has no consent field.** It must gain one before any
enrollment path is written. The email overhaul spec already proposes the shape
in its §3d, and this spec adopts it unchanged rather than inventing a second:

```
orgs/{orgId}/lists/{listId}/members/{memberKey}
  consentAtMs    number | null
  consentBasis   'contact-opt-in' | 'operator-attested'
  consentBy      string | null     // uid, for an attestation
```

`memberKey` must be the single `emailSuppressionKey` derivation, which closes
email-overhaul D4 and D5 in the same move and needs the collapsing backfill
described there. **Enrolling from the Inbox before that backfill exists would
add a third id derivation to a collection that already has two.**

**B2 — no sender reads consent, so the field would be decorative.** The
send-time consent join is email-overhaul Phase 3, and that phase is explicitly
gated on the policy documents moving first and on a per-org switch with a
before/after audience preview. Until it exists, a `consentAtMs` written by this
button is a value nothing consults — the exact defect §1d of that document
identifies. **This is the blocker that makes building it now actively harmful
rather than merely incomplete.**

**B3 — the basis itself is an owner decision.** See Part 3, Q1 and Q2.

#### What cleared them

- **B1 — cleared.** A list membership now carries a basis, written by
  `enrollListMember`. It is the `marketingConsent` family and **not** the
  `consentAtMs`/`consentBasis`/`consentBy` names sketched above, deliberately:
  `readMarketingBasis` is the shipped reader and it reads `marketingConsent` +
  `marketingConsentAtMs`, so the names above would have been a basis the
  send-time join cannot see. `marketingConsentBasis` and
  `marketingConsentByUid` are attribution ON that field — they say *why* a
  person is mailable, never *whether*.
- **B1's id half — cleared.** The derivation is `personKey`, and the
  duplicate-collapse was done as a *lookup* rather than a backfill:
  `enrollListMember` resolves the two legacy ids and adopts an existing row,
  so no enrollment path can add a third derivation.
- **B2 — cleared.** `performCampaignSend` joins on consent at the audience
  sweep, above the 500 cap. A basis written by this button is read by the one
  thing that mails a list.
- **B3 — NOT cleared, and it did not have to be.** See Part 3, Q1: the build
  records the assertion and makes it attributable rather than deciding what a
  merchant may assert.

### 2c. The design, once the blockers clear

Two bases, and no third:

- **`contact-opt-in`** — the org contact for this address carries
  `marketingConsent: true`. Copy `marketingConsentAtMs` onto the member as
  `consentAtMs`. This is a *pass-through*: it records a decision the person
  made, on a surface where they made it.
- **`operator-attested`** — the merchant states, in the dialog, that they have
  this person's permission. Recorded with the acting `uid` and the timestamp,
  and rendered in the list as an attestation rather than as an opt-in, so the
  two are never conflated in any surface a support or compliance question is
  answered from.

**With neither, the assignment refuses.** It does not enroll and mark the
consent unknown; an unknown consent in a marketing audience is a person who
never opted in.

⛔ **Explicitly not proposed, restating email-overhaul §3f:** inferring consent
from the submission itself. Someone filling in a contact form asked to be
answered. They did not ask to be marketed to, and the checkbox that would let
them say so is not on the form-submit path — `apps/tenant/app/api/forms/submit/route.ts`
never passes `marketingConsent` to `upsertHostContact`.

> ✅ **Built as specified, with two additions the spec did not anticipate.**
>
> 1. **A stored `declined` refuses OUTRIGHT, above the attestation.** The
>    spec's "with neither, it refuses" covers the absence of a record; a
>    recorded refusal is a different thing and needed saying. A merchant
>    cannot attest their way past somebody who said no — if they could, there
>    would be no difference between recording a refusal and discarding one.
>    The check runs in two places on purpose: the route reads the person's CRM
>    record (the one silo `marketingConsent: false` is ever written to), and
>    `enrollListMember` refuses a membership that itself records a refusal.
>    The second is the backstop that makes the rule true of the COLLECTION
>    rather than only of this button — the newsletter handler, the workflow
>    `enrollList` step and the dynamic-list materializer all go through it.
> 2. **The pass-through keeps the person's own timestamp.** Restamping it
>    would report every historical opt-in as having happened when a merchant
>    pressed a button, which walks records across the forward cutoff
>    `MARKETING_CONSENT_ENFORCED_FROM_MS` grandfathers on.
>
> The consent read is UNSCOPED (no `scopedToHost`), because a refusal filtered
> out by host scoping is a refusal the route would then step over. It is safe
> only because the caller has already been proved an org-wide member — see 2f.

### 2d. Suppression on this act

A suppressed address must not be enrollable, and the reason is different from
the reply's. A reply is one message the merchant chose to send; a list is a
standing membership that will be mailed by paths that may not re-check. Both
lists must be consulted at enrollment, exactly as the reply does — and the
enrollment must **also** be re-checked at send time, because an address can be
suppressed after it is enrolled. Enrollment-time checking alone is the
laundered-quota shape: a check that passes once and licenses an unbounded number
of later sends.

> ✅ **Both checks are in place, and the second one is asserted end to end.**
>
> - **At enrollment**, through `addressSuppression` — the same both-lists
>   helper the reply uses, renamed off `replySuppression` because two acts now
>   ask it. A suppressed address is refused with a `409` and nothing is
>   written, so a merchant is never told they added somebody unmailable.
> - **At send**, through `filterSendableForHost` in `campaign-send.ts`, which
>   was already there. What was missing was a proof that the ordering holds
>   across the two features:
>   `apps/console/specs/an-enrollment-is-not-a-license-to-send.spec.ts` enrolls
>   through the real Inbox route, suppresses the address afterwards, runs the
>   real sender, and asserts the message does not go — while the membership
>   and its basis stay intact, because a suppression is a fact about the
>   address and not a withdrawal of consent.

### 2e. What it must not do

- Not create a fifth copy of a person. The member document is a pointer with a
  denormalized address, per email-overhaul §3d.
- Not enroll silently on reply. The two acts stay separate in the UI and in the
  data; the reply composer touches no list.
- Not widen `marketingConsent` to make the button usable. The tracking-consent
  rule that `implied` grants advertising outside the EEA/UK is about anonymous
  visitor tags and does not transfer to email to a named address.

---

### 2f. Who may do it

**A host role is necessary and not sufficient.** Lists live at
`orgs/{orgId}/lists`, so the security rules put the list document behind
`isOrgWideMember()` and its `members` — which are people, with a consent record
attached — behind that plus a role of owner, admin or editor. An editor invited
to ONE site is an org member
with `allHosts: false`; gating this route on the host role alone would let a
single-site collaborator enroll people into an audience every other site in the
org can mail. The Admin SDK evaluates no rules, so the route is the enforcement
rather than an echo of it, and it asks the same two questions
`canWriteOrgWideData()` does: org-wide reach, and a role of owner/admin/editor.

## Part 3 — Open questions for the owner

These are the questions that block Part 2. None can be answered from the
repository.

**Q1 — What basis may a merchant assert for a manual list add? — STILL OPEN,
and the build does not answer it.**
Every standalone ESP lets a merchant add an address by hand and makes the
merchant responsible for having permission. That is legally coherent and it is
what `operator-attested` above encodes. But it is also, mechanically, a way to
put anyone on a list — so it is a policy decision about what this platform is
willing to be the instrument of, and the policy documents have to be able to
stand behind whatever is chosen. Refusing manual adds entirely is the other
coherent answer, and it makes the Inbox's "add to list" impossible rather than
merely gated.

> **What was built instead of an answer.** The attestation is *recorded and
> attributable*: `marketingConsentBasis: 'operator-attested'` and
> `marketingConsentByUid` on the membership, plus a row under the submission
> naming the account, the moment, the list and the address. So whatever the
> owner decides, the question "who put this person on a marketing list, and on
> what basis" is answerable for every row written from today, and a later
> decision to disallow or restrict attestations can find and act on exactly
> the rows it applies to. Three sub-questions the owner still has to settle:
>
> 1. **May a merchant attest at all, and on which plans?** Today any org-wide
>    editor may. There is no entitlement gate on it.
> 2. **Should the attestation carry the merchant's stated source?** It records
>    *that* they claimed permission, not *where the permission came from* ("a
>    business card", "they asked at the counter"). A free-text field would make
>    the record far more useful in a dispute and is one input away.
> 3. **Should an attested row be presented as consent in the send readout?**
>    It is today: `splitByMarketingConsent` counts it under `consented`
>    alongside a real opt-in, because `readMarketingBasis` reads
>    `marketingConsent` and nothing else. **The data distinguishes them; the
>    campaign composer's three-number readout does not.** Splitting that
>    figure is a small change and a real decision — a merchant who sees
>    "1,240 consented" is entitled to know how many of those are their own
>    assertions.

**Q2 — Does Part 2 wait for email-overhaul Phase 3, or ship ahead of it? —
ANSWERED BY EVENTS.**
Shipping ahead means writing a consent field that no sender reads, which is the
defect the email audit named. Waiting means the Inbox has no list affordance
until the send-time consent join exists, a per-org switch is built, and the
policy documents have moved. This spec recommends waiting, and that
recommendation is the reason nothing was built.

> It waited, and the join shipped first. The recommendation held: what was
> eventually built writes a basis into a field the audience sweep reads, so
> there is no decorative consent signal and no screen claiming an unperformed
> check. The per-org switch is `marketingConsentPolicy`
> (`forward` by default, `strict` on request); the policy documents are the
> owner's remaining half of Q1.

**Q3 — May the site's own name lead the From line for an org without
white-label?**
Today a merchant's reply to their own customer reads as coming from this
platform, because `resolveBrandingProfile` returns the platform profile for any
org lacking the `whiteLabel` entitlement. Using the *site's* name instead would
make the reply recognizable to the person who wrote it — but the display name in
front of the verified address is precisely the affordance white-label sells, so
granting it here would hand a paid capability to every plan. The conservative
default is shipped; the alternative needs a pricing decision.

**Q4 — Should a reply be visible to the whole team, or only its author?**
Stored replies are readable by any host member, matching how submissions
already work. That is right for a shared inbox and wrong for a merchant who
thinks of it as their own mail. Nothing was built either way beyond the existing
member-read posture; if it should be narrower, it needs a rule change rather
than a UI one.

**Q5 — Does a reply need a delivery-log entry?**
The reply records the `providerMessageId` returned by the send, so a bounce on a
reply would be attributable once the webhook flows. It is **not** written into
`emailDeliveries` by this feature — that log is populated by the webhook, and
whether a reply should also get a snapshot at send time is the same question the
rest of the transactional senders have not answered either.

---

## Appendix — what was not verified

- **No message was sent.** `USAGE_EMAIL_FROM` and `RESEND_API_KEY` are reported
  set as of 2026-08-29, so this path would really send; it was exercised only
  against a spy for `sendEmail`.
- **No production data was read**, so whether any existing list member would
  pass a consent check is unknown. The claim that essentially none would is
  derived from the form-submit route not writing `marketingConsent`, which is
  verified in code, not from counting documents.
- **No Linear issue was opened or read.** No claim here describes any issue.

### Not verified for the list assignment either

- **No list membership was written outside a test.** Every assertion runs
  against a Firestore double; the real `enrollListMember` runs against it, but
  no production or emulator collection was touched.
- **The org-wide gate is asserted against the predicate, not against
  Firestore.** `isOrgWideMember` is the real function and the membership shapes
  in the assertions are the ones `grantHostAccess` and the invite route write —
  but nothing here proves the rules and this route agree on a live document.
  They agree by construction: both call the same predicate.
- **`marketingConsentBasis` has no reader yet.** It is attribution, not a gate,
  and it is deliberately not consulted by the send — but that means nothing
  displays it either. The console surface that shows a list's members does not
  distinguish an attestation from an opt-in, which is Q1's third sub-question.
