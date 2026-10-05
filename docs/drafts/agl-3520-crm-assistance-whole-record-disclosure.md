# AGL-3520 — CRM assistance sends the whole record: what the legal pages owe before it ships

**Status: published 2026-10-05 as legal v10 (Privacy §2, Subprocessors Anthropic row and change log). The owner notice in §5 was not sent.** Google Docs are the source of truth
for legal wording; this file records the finding and the proposed text.

## 1. The change

From AGL-3520, AI assistance in the CRM (a record summary, a next step, an email draft) sends
the AI provider (Anthropic) the opened contact, company, deal or lead **as the CRM shows it**:
every standard field, every email address, phone number and postal address, birthdate,
assistant, the reports-to contact, parent company and campaign by name, the owner and task
assignees by display name, marketing consent, picklist labels, custom field values under
their labels, notes, timeline, open tasks and deals. Text a person wrote is no longer
scrubbed of addresses and numbers. Still never sent: authentication tokens, account
identifiers and internal record ids.

The founder's decision (2026-10-04), recorded on AGL-3520: send everything, custom fields and
contact details included, under an open-ended disclosure.

## 2. What the DPA says: no advance notice is owed

Read from the live page `https://aglyn.com/legal/dpa` on 2026-10-05 ("Last updated:
September 15, 2026"):

- **§7.1** gives Aglyn general authorization to engage Sub-processors, and incorporates the
  Subprocessors page as the list.
- **§7.2** says Aglyn imposes substantially similar obligations on Sub-processors and stays
  responsible for them, and keeps the Subprocessors page and its change log current. It
  carries **no advance-notice period and no objection window**. The thirty-day notice that
  `docs/drafts/agl-1648-subprocessor-change-notification.md` quotes was deleted on
  2026-08-24, as `apps/console/constants/subprocessor-inventory.ts` (the "NO NOTICE-PERIOD
  ARITHMETIC" block) and `subprocessor-inventory.spec.ts` record.
- **§4, nature and purpose**, already names "CRM/contacts" and "AI-assisted features that
  generate or change content at the request of Customer's Authorized Users".
- **§4, categories of personal data**, already names "identifiers and contact details (e.g.,
  name, email, address, phone)" and "content submitted through forms and CRM".

So the DPA needs **no change and no advance notice**. Anthropic is an existing Sub-processor,
and the data is in categories the DPA already lists.

⚠ `subprocessor-inventory.ts` records that its no-notice reasoning "expires the moment the
first customer signs". That trigger concerns a new Sub-processor, not a wider category for an
existing one, so it does not change this answer. It is still the paragraph to re-read before
the next vendor is added.

## 3. What the DPA does not settle: the published pages say the opposite

Two published pages describe CRM assistance narrowly, and they would become false the day this
change reaches production.

**Privacy Policy §2** (live, "Last updated: September 17, 2026", the acceptance-pinned v8 in
`apps/console/constants/legal-documents.ts`):

> for AI assistance in the CRM, the contact, company, deal, or lead you open, as the CRM shows
> it to you — such as its name, job title, company, lifecycle stage, and tags … with email
> addresses and phone numbers written in that text replaced, and never an email address, phone
> number, or postal address field, marketing consent, custom field value, or record identifier

**Subprocessors, the Anthropic row's data cell** (live, "Last updated: September 17, 2026") says
CRM records are sent with email addresses removed.

The Privacy Policy's own change clause reads: "Material changes will be indicated by updating
the 'Last updated' date and, where appropriate, by additional notice."

### What that implies

1. **Publish before you promote.** The Privacy Policy §2 CRM paragraph and the Subprocessors
   Anthropic row have to be republished with open-ended wording (§4 below) before AGL-3520
   reaches production. The Subprocessors page also needs a change-log entry. Until then the
   change must stay off `production`, or CRM assistance must be held behind its flag.
2. **The Privacy Policy is acceptance-pinned.** Republishing §2 means a new label (`v10`)
   with its hash captured publication-first, as every earlier bump was. Every account then
   re-accepts once. The Subprocessors page is not pinned.
3. **Additional notice is discretionary, not owed.** The policy promises a new "Last updated"
   date and notice "where appropriate". This change hands a wider set of a customer's own CRM
   data to an AI provider they already use for the same feature, so a short in-console or
   email notice to workspace owners is the conservative reading. It is the founder's call, and
   the text is in §5.
4. After publication, update the catalog's `publishedOn` in
   `libs/plugins/ai/src/lib/providers/catalog.ts` (today `2026-09-17`) to the new change-log
   date, and regenerate `apps/console/constants/plugins.subprocessors.generated.ts`.

## 4. Proposed wording

**Subprocessors, the Anthropic data cell.** Replace the CRM sentence with the catalog's
(`libs/plugins/ai/src/lib/providers/catalog.ts`):

> For CRM assistance, the opened record as the CRM shows it, with all of its standard and
> custom fields, including contact details, notes, timeline and related records. An email draft
> adds the request and the record's merge field names; an import sends the field names and
> types and each column's header and value kind, never a row. No account identifiers or
> authentication tokens, and no email address outside an opened CRM record.

**Subprocessors change-log line:**

> **[DATE]** — Anthropic: AI assistance in the CRM now receives the opened record with all of
> its standard and custom fields, including contact details, postal addresses, marketing
> consent, notes, timeline and related records. No new subprocessor.

**Privacy Policy §2, the CRM sentence:**

> for AI assistance in the CRM, the contact, company, deal, or lead you open, as the CRM shows
> it to you, with all of its standard and custom fields — including email addresses, phone
> numbers, postal addresses, marketing consent, notes, its timeline, and the names of the
> people and records it is related to — but never a password, sign-in token, account
> identifier, or record identifier

## 5. Optional notice to workspace owners (not sent)

> **Subject:** A change to what Aglyn AI reads from your CRM
>
> When you ask Aglyn AI to summarize a CRM record or draft an email from one, it now reads the
> whole record as you see it: every field, your custom fields, contact details and addresses
> included, with its notes and recent activity. That gives better summaries and drafts. AI
> still never sends an email, and it never receives a password, a sign-in token or an internal
> id. The provider is Anthropic, which is already on our subprocessor list. The updated
> Privacy Policy and subprocessor list are at aglyn.com/legal. If you don't want your team to
> use AI in the CRM, remove the **Generate with AI** permission from their role, or switch AI
> off for the site.

## 6. Held behind a release flag until then

AGL-3520 ships OFF. `release_crm_assist_whole_record` (Staff → Feature flags, label "CRM
assistance: whole record", default and template seed OFF, no staff preview) decides per
organization what the CRM's record-facts readers answer:

- **Off** — what production sends today and what the published pages describe: the disclosed
  builders in `libs/plugins/crm/src/lib/model/record-facts-disclosed.ts`, written into the
  prompt by `aiCrmDisclosedFactsLines`, with addresses and numbers in typed text replaced.
- **On** — the whole record (`model/record-facts.ts`), marked `wholeRecord: true`, written by
  `aiCrmFactsLines`.

The catalog's Anthropic row keeps publishing the disclosed wording
(`ANTHROPIC_CRM_ASSISTANCE_DISCLOSED`); the open-ended wording in §4 waits beside it as
`ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD` in `libs/plugins/ai/src/lib/providers/catalog.ts`,
and `libs/plugins/ai/src/lib/subprocessors.spec.ts` pins both. The customer docs describe the
flag-off behavior; the whole-record text they take on is in §7.

### To turn it on, in this order

1. Republish **Privacy Policy §2** with the §4 sentence as **v10** (hash captured
   publication-first, as every bump), and the **Subprocessors** Anthropic data cell with the §4
   text plus its change-log line.
2. In `catalog.ts`, set the Anthropic row's `dataReceived` to
   `anthropicDataReceived(ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD)` and `publishedOn` to the
   change-log date; regenerate with `node tools/scripts/generate-plugin-manifests.mjs`; update
   the published rows pinned in `libs/plugins/ai/src/lib/subprocessors.spec.ts` and
   `apps/console/constants/subprocessor-inventory-plugins.spec.ts`; bump the acceptance-pinned
   legal label in `apps/console/constants/legal-documents.ts`.
3. Put the §7 text into the docs, and take the flag out of `FLAGS_WITHOUT_DOCS` in
   `apps/console/constants/docs-release-flags.ts` (or declare it in
   `PUBLISHED_ON_IN_PRODUCTION` if the default stays off).
4. Promote, then turn the flag on — one organization through its override first, then
   everyone.

## 7. Docs text to publish with the flip

#### CRM by AI — "What AI reads from a record" (`apps/docs/docs/ai/crm-by-ai.md`)

The CRM decides what AI may read, and it reads the same record you would see. For a summary or
an email draft, AI is given **the whole record as the CRM shows it to you**:

- every standard field — for a person their name and its parts, salutation, job title,
  department, company, every email address, every phone and fax number, birthdate, assistant,
  who they report to, mailing and other address, lifecycle stage, lead source and **Do not
  call**; for a company its domain, website, phone, fax, account fields, billing and shipping
  address and parent company; for a deal its pipeline and stages, stage, amount, products,
  type, lead source, campaign, next step, probability, forecast category, the person and
  company it is with, and up to 10 of its contacts by name with the role each plays and which
  is Primary (a contact you cannot see is left out); for a lead its contact details, address,
  account fields, status and campaigns;
- your picklists' labels as the record holds them, and your **custom fields**, each under its
  label;
- the person's **marketing consent** — opted in and since when, declined, or none recorded;
- who **owns** the record and who each open task is assigned to, by name;
- the record's notes (their first 600 characters);
- its 12 newest timeline entries: the day, the kind of activity, an email's sender, recipient,
  subject and delivery state, and the first 280 characters of what was logged;
- up to 8 open tasks with their notes and, for a contact or company, up to 5 deals.

Text you wrote is sent as written. A record that holds a great deal at once has its longest
texts — notes, timeline entries, task notes and custom values — shortened to fit, and no field
is left out.

AI is **never** given a password, a sign-in token, an account identifier or a record's
internal id. A related record — the company someone works for, the person they report to, a
campaign — is named by its name.

#### Enterprise security and compliance (`apps/docs/docs/enterprise/security-and-compliance.md`), after the subprocessor list bullet

**AI assistance in the CRM sends the whole record.** When a member asks AI to
summarize a contact, company, deal or lead, or to draft an email from one, the
AI provider receives the record as the CRM shows it — every standard and custom
field, contact details and postal addresses included, with its notes, timeline
and related records — and never a password, a sign-in token, an account
identifier or a record's internal id. [CRM by AI](../ai/crm-by-ai.md#what-is-sent)
lists it field by field.

#### Trust & security table row (`apps/docs/src/pages/trust.md`), after Resend; drop its last sentence once the list is republished

| **Anthropic** | AI-assisted features: Aglyn Assist, editor assistance, AI generation, automation explanations, AI insights and AI assistance in the CRM. For CRM assistance it receives the opened record as the CRM shows it, with all of its standard and custom fields, including contact details, notes, timeline and related records — email addresses, phone numbers, postal addresses and marketing consent included. It never receives a password, a sign-in token, an account identifier or a record's internal id. The published list's Anthropic entry, dated September 17, 2026, still describes CRM assistance as sending no email, phone or postal field, consent or custom value; it is being republished to match. |

#### AI overview (`apps/docs/docs/ai/overview.md`), "own job is sent" sentence

> Each capability's page says exactly what its own job is sent: the CRM page lists what a
> record sends, and the automation page what is removed first.
