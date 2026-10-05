# AGL-3520 — CRM assistance sends the whole record: what the legal pages owe before it ships

**Status: draft. Nothing here is published or sent.** Google Docs are the source of truth
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
