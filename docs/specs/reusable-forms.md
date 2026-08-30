# Reusable forms — the form entity, per-form submissions, leads, and per-form performance

Status: **specification only. No code changed.** Written 2026-08-29 against `main`
at `c08f3b93c`. Nothing here has been decided by the account owner; §8 is the
list of things that need him.

> ⚠️ **House convention note.** Existing design specs live in `docs/design/` and
> are named `agl-####-slug.md`. This file is at `docs/specs/reusable-forms.md`
> because that path was specified, and because `docs/specs/email-overhaul.md`
> already set the precedent. If either is adopted rather than discarded, both
> should move to `docs/design/` and take issue numbers, so
> `npm run check:linear-ids` and the rest of the doc guards see them where they
> expect them.

> ⛔ **No Linear issue was opened while writing this.** The workspace was
> searched for `form` and for `lead`; every issue that describes forms today is
> **Done** (the build-out arc AGL-76 → AGL-141 → AGL-544 → AGL-556 → AGL-557,
> and the containment arc AGL-1655 → AGL-1664 → AGL-1666 → AGL-1831), and no
> open issue describes a reusable form entity, per-form submission lists, or
> per-form performance. Where an `AGL-` id appears below it is quoted from a
> code comment as provenance for a file, never asserted as a description of an
> issue. This document proposes work; it does not file it.

> 🔗 **Companion document.** `docs/specs/email-overhaul.md` covers the audience
> side that forms feed. Nothing here contradicts it; §4 and §6 cross-reference
> it explicitly, and where this document proposes a key derivation it adopts
> the one that spec already chose.

---

## Verdict up front

**A form is not an object in this product. It is a shape you can draw.** Every
capability a "reusable form" implies — a name that survives a rename, a
declared field list, a per-form list of submissions, a conversion rate — is
blocked by the same single absence: nothing in the database knows that a form
exists. A submission carries `formName`, which is the free-text label an author
typed into an inspector field, and `path`, which is the URL of the page it was
sent from. That is the whole of a form's identity.

Three findings dominate everything else in this document:

1. **The per-form list already exists, and it is keyed on a display string.**
   `GET /v1/sites/{siteId}/form-submissions?form=Contact` runs
   `query.where('formName', '==', form)` today
   (`apps/console/utils/api-v1-resources.ts:1387-1388`). So "per-form
   submissions" is not a feature to invent; it is a feature to make *correct*.
   Renaming a form in the besigner today silently splits its history in two,
   and two different forms named `Contact` on two pages have always been one
   list. The console's Inbox does not offer the filter at all.

2. **Forms do not produce leads.** `addHostLead` has exactly three callers —
   the site-member signup handler and the two bookings branches
   (`libs/plugins/commerce/src/lib/server/membership-register.ts:169`,
   `libs/plugins/bookings/src/lib/server.ts:634` and `:653`). The form-submit
   route calls `upsertHostContact` and never `addHostLead`
   (`apps/tenant/app/api/forms/submit/route.ts:363-375`). A lead-capture form
   — the thing the endpoint's own docblock calls itself, "Lead-capture
   submissions endpoint (AGL-76)" — has never created a lead.

3. **A form that captures consent throws the consent away.** `Form` has no
   consent prop; a consent checkbox is an ordinary `FormField` with
   `fieldType: 'checkbox'`, so its value lands in `fields` as the string the
   browser submitted. The route's `upsertHostContact` call passes `hostId`,
   `email`, `name`, `source` and `interaction` — **not `marketingConsent`** —
   even though the function accepts it (`upsert-contact.ts:55`). So the one
   capture surface most likely to carry a marketing opt-in is the one surface
   that cannot record one. This is the exact hole `docs/specs/email-overhaul.md`
   §3f names for `siteMembers`, one collection over.

The first is a correctness problem with a migration attached. The second is a
missing edge in the data model. The third is a defect that has to be fixed
before a reusable form can honestly claim to capture leads.

---

## 1. Current state, cited to files

### 1a. Built and working

| Capability | Where | Notes |
| --- | --- | --- |
| Form components | `libs/plugins/mui/src/lib/components/form.tsx` | `FORM_ID = 'form'` (:41), `FORM_FIELD_ID = 'formField'` (:42), both marked *"persisted in screen documents; never rename."* |
| Seven field types | same file, `FormFieldProps` :437-470 | `text \| email \| textarea \| select \| radio \| checkbox \| rating`, plus `options` (newline- or comma-separated, `parseFieldOptions` :476), `required`, `label`, `placeholder`. |
| **`fieldName`, not `name`** | :437-439, :497 | *"Submission key; also the input's name attribute."* The runtime default is `const name = fieldName \|\| 'field'`. |
| Value collection with no React context | `handleSubmit` :188-341 | `new FormData(event.currentTarget)`. The docblock at :80-84 states the reason: it *"rides the DOM so arbitrary nesting between Form and field needs no React context."* Repeated keys (checkbox groups) join with `, `. |
| Honeypot | :371-378 | `name="website"`, `tabIndex={-1}`, off-canvas at `left: -5000px`. |
| Field→dataset mapping | :525-532, `FIELD_MAP_INPUT_PREFIX = '__map__'` (:85) | A hidden input per mapped field carries `datasetFieldId`; the route re-validates every id against the dataset model and drops unknowns. |
| After-submit outcomes | `FormProps` :47-77 | `message \| redirect \| reveal`, with `sanitizeRedirectUrl` (:102) refusing anything that is not https-absolute or same-origin. |
| Submit endpoint | `apps/tenant/app/api/forms/submit/route.ts` | Honeypot drop + count → shape validation (`MAX_FIELDS = 20`, `MAX_PAYLOAD_CHARS = 10000`) → per-(site, IP) rate limit 10/60s → host exists → lockdown → plan quota → abuse ceiling → write → contact → dataset → counter → notify → event. |
| Submission document | route :332-360 | `formName`, `path`, `fields` (keys ≤ 64 chars, values ≤ 2000), `read`, `createdAt`, optional `rateDegraded`, optional `routing.dataset { id, name, recordId }`. |
| Containment, fully built | `libs/aglyn/src/lib/app-utils/plan-entitlements.ts:3384-3440`, `form-abuse-ceiling.ts` | `FORM_ABUSE_CEILING_MULTIPLE = 10`, `FORM_ABUSE_CEILING_FLOOR = 5_000`, `FORM_ABUSE_CEILING_UNLIMITED = 1_000_000`, counted per site per month, with a refusal counter, a manager notification on the month's first trip, and a visitor-facing fallback address. |
| Metered, not walled, on paid plans | `checkFormSubmissionQuota` :3368-3382 | `allowed: metered ? true : used < included`. Free hard-walls at `formSubmissionsPerMonth` (20); every plan carrying `meteredInfraPassThrough` accepts and bills the excess. |
| Inbox, ordered and paged | `libs/plugins/inbox/src/lib/components/inbox-console-page.tsx:120-138` | `orderBy('createdAt', 'desc')` + `usePagedCollection`. The docblock records that this was `limit(200)` with no `orderBy` and a client sort on top, and names why the missing rows left no visible gap. |
| Sender presentation | `libs/plugins/inbox/src/lib/model/submission-presenter.ts` | Avatar, initials, deterministic hue, relative time. |
| Routing chips | inbox page :797, route :488-505 | `Added to "Leads" dataset` is real, stamped only on the success path. |
| Dashboard glance | `libs/plugins/inbox/src/lib/components/inbox-glance-card.component.tsx` | Newest three, `PREVIEW_ROWS + 1` probe row, renders nothing when the site has no submission. |
| REST read + `read` flag | `apps/console/utils/api-v1-resources.ts:1335-1420` | `read` is the only writable field; anything else is a `validation_failed` naming the key. |
| **`?form=` filter** | :1387-1388 | `if (form) query = query.where('formName', '==', form)`. |
| Reusable components | `libs/aglyn/src/lib/app-utils/compose-reusable-components.ts` (1119 lines), `hosts/{hostId}/components/{id}` | Promote a subtree, place instances (`componentId: 'reusableInstance'`, `props.refId`), graft at render with id namespacing `cmp__{instance}__{def}`, declared `{{prop.*}}` props, per-instance `styleOverrides` **and** `attrOverrides`, `detachInstanceSubtree`, and a *Used by* card that is idle until asked. Gated by the `reusableComponents` entitlement, Starter and above. |
| Server-side artifact creation | `apps/console/app/api/hosts/resources/route.ts` | One table mapping a resource kind to a collection, a `quotaKey` **or** an `entitlement`, an activity noun, and a field allow-list. This is where a new authored artifact is created. |

### 1b. Built and inert — this is where the product actually is

| What | Why it is dark | Consequence |
| --- | --- | --- |
| **`formName` as an identity** | It is a free-text inspector field on the `Form` node, copied onto each submission at write time and never reconciled. | The `?form=` filter, the Inbox's form label and the reader's dialog title are all reading a caption. Rename the form and every prior submission is orphaned from the new name. Two forms with the same label were always one list. |
| **`path` as a discriminator** | Recorded (`window.location.pathname`), stored, and read by nothing except the notification body. | The one field that could tell two same-named forms apart is not surfaced, not filterable, and not indexed. |
| **A consent checkbox** | `fieldType: 'checkbox'` exists; the value reaches `fields` as a string. The route never passes `marketingConsent` to `upsertHostContact`. | Consent captured on a form is stored as free text in a PII blob and is invisible to every consent-aware reader. See §1d. |
| **Contacts ingestion from forms** | Works — `extractEmailFromFields` → `upsertHostContact` with `source: 'form'`. | But it is the *only* person-record a form produces, and it is org-scoped, so the host-scoped Inbox "Members & leads" tab never shows it. |
| **The `Contact Form` preset** | `formPresets` (`form.tsx:842-903`). | A preset is a **stamp**: it copies nodes into the page and thereafter tracks nothing. It is the closest thing to a reusable form and it is the opposite of one. |
| **The reusable-component system, for forms** | Fully built, generic, and never connected to forms. | A `Form` subtree *can* be promoted today and placed on twelve pages with per-instance `attrOverrides`. Nothing knows the result is a form, and the twelve instances still write twelve `formName` strings that only agree by luck. Neither `apps/docs/docs/content-and-data/forms/overview.md` nor `apps/docs/docs/guides/build-and-publish-a-survey.md` mentions reuse at all. |
| **`datasetFieldId`** | Real, id-first, rename-safe (AGL-556). | It is a schema — but it lives on the dataset, exists only when a dataset is bound, and describes the *destination*, never the form. |

### 1c. Absent

- **Any `forms` collection.** There is no `hosts/{hostId}/forms`, no `formTemplate`, no `savedForm`. `PLUGIN_CONTENT_COLLECTIONS`
  (`libs/aglyn/src/lib/foundation/definitions/host-content-collections.ts:220-238`)
  is the complete list of host subcollections, and no member of it is a form.
- **A form id on a submission.** The write at route :332-360 has no `formId`
  field and no place to put one.
- **A declared field schema.** The field list exists only as nodes inside a
  screen document. This is why the Inbox has to *guess* who wrote in:
  `submission-presenter.ts` matches reduced field keys against
  `['name','fullname','yourname','firstname','contactname']` and
  `['email','emailaddress']`, and `forms/overview.md` is candid that a form with
  fields named `q1` shows "Someone" on every row — *"That is the design, not a
  fault."*
- **A lead from a form.** §Verdict item 2.
- **Per-form anything measured.** No form-level counter, no impression, no
  start, no completion, no conversion rate. `hosts/{hostId}/counters/formSubmissions`
  is one number per site per month, and it is the billing meter.
- **A per-form list in the console.** The Inbox has three tabs — Submissions,
  Members & leads, Campaigns — and no form filter anywhere.
- **An unread total.** The Inbox renders no count; the glance card counts
  unread over the three rows it draws and scopes the sentence with the word
  *"here"*. So "what is waiting for a reply" is currently answered only in the
  local sense, on purpose — §5 keeps it that way.
- **A composite index on `formSubmissions`.** `cloud/firebase-firestore.indexes.json`
  declares none. Everything filterable today is either a single-field query or
  narrowed in memory, which the v1 handler documents at :1389-1400.
- **Cross-host form sharing.** Component definitions are per-host. An agency
  cannot author one form and use it on forty client sites.

### 1d. The consent gap on the form path, stated precisely

`docs/specs/email-overhaul.md` §1d establishes that `marketingConsent` is
written by six call sites and read by no sender. Forms make it worse in a way
that spec did not have to cover:

- **`Form` has no consent prop.** The only way to capture an opt-in is a
  checkbox `FormField`, which produces an entry in `fields` — a
  `Record<string, string>` of visitor-typed values.
- **The route does not forward it.** `upsertHostContact` accepts
  `marketingConsent` (`upsert-contact.ts:55`, written at :137-139 and :192-194),
  and the form route does not pass it.
- **So consent from a form is stored where it cannot be read**: as a value in
  the submission's PII blob, under whatever key the author named the checkbox,
  with whatever string the browser sent.

The standing rule the shipped consent arc established is that consent is
**never inferred** — `membership-register.ts:58` says *"Explicit opt-in checkbox
(AGL-2499) — never inferred from signing up,"* and
`host-visitor-records.ts:115-122` states the general form: a lead is a side
effect of an action the visitor took, which *"is not by itself consent to be
emailed marketing, so this is only set when the caller captured an explicit
checkbox."*

That rule is not in tension with fixing this. **A checkbox the visitor ticked
IS an explicit checkbox.** What is missing is a declared place to put it. A
form that captures consent must persist it where a sender can read it, and a
form that does not capture consent must persist nothing — which is exactly the
`absent-or-true` shape every other writer already uses.

⛔ **What must not happen:** treating a form submission as consent. That is the
inference the arc refused. A form with no consent field produces no consent
record, on any plan, in any phase of this document.

### 1e. Five identity rules for one person

`docs/specs/email-overhaul.md` §1e tabulates four person silos. Establishing the
form side surfaced a fifth comparison, and it is worth setting them out
together because §4 has to pick one:

| Where | Key derivation | Cited |
| --- | --- | --- |
| Contacts | `normalizeContactEmail` — `trim().toLowerCase()`, regex-validated, ≤ 320 chars — then `.where('email','==',…).limit(1)`, doc id is an auto-id | `libs/aglyn/src/lib/app-utils/contacts.ts:67-73`; `upsert-contact.ts:90, 114-118` |
| Site members | `trim().toLowerCase()` then an in-transaction `where('email','==',…)`; doc id is an auto-id | `membership-register.ts:51-53, 88, 122-124` |
| **Leads** | **none** — `tx.create(leadsRef.doc(), document)` | `host-visitor-records.ts:187` |
| List members | ✅ `personKey` — `sha256(normalizeContactEmail(email))`, full digest, one writer | `libs/aglyn/src/lib/app-utils/person-key.ts`; `libs/tenant/data/admin/src/lib/server/list-members.ts` |
| The Inbox's own display dedupe | raw `member.email === lead.email` string equality | `inbox-console-page.tsx`, `dedupedLeads` |

The list-member split was `docs/specs/email-overhaul.md`'s **D4**. Three
independent things made the two ids incompatible — a different primitive (keyed
HMAC versus bare digest), a different length (20 hex versus 64), and no shared
helper to reconcile them. **This is the shape §4 must not repeat.**

✅ **It is closed, and it is the helper §4 asks for.** `personKey` shipped with
D4; §4's Phase 3 imports it rather than defining it. It is in
`libs/aglyn/src/lib/app-utils/person-key.ts`, NOT in `contacts.ts` as §4 below
says — that module reaches the client barrel and the helper imports
`node:crypto`. See `docs/specs/email-overhaul.md` §3d for the measurement
behind that placement.

### 1f. Defects found while establishing the above

Not part of the proposal; things that are wrong now.

- **F1 — the `name` prop silently overrides `fieldName`.** Every branch of
  `FormField` renders `<TextField name={name} … {...rest} />` with `{...rest}`
  spread *after* `name`, and `name` is not destructured out of props. So
  `<FormField name="message" />` wins over `fieldName` and changes the
  submission key. One place in the repo relies on it
  (`libs/plugins/mui/src/lib/components/lead-and-checkout-analytics.spec.tsx:79`),
  which means the accident is currently load-bearing in a test.
- **F2 — a second, hand-rolled submit path.** The marketing popup posts to
  `/api/forms/submit` directly with `formName: 'Popup'` and
  `fields: { email }` (`libs/plugins/marketing/src/lib/components/site-runtime.tsx:776`),
  sharing no code with `Form`. Any form entity that assumes one client is wrong
  on day one.
- **F3 — the `?form=` filter's ordering.** v1 lists are ordered by document id
  (`paginate` applies `orderBy(FieldPath.documentId())`), which is
  `conventions.md`'s published behavior — but combined with a `formName`
  equality it is the same "arbitrary window that looks like a feed" shape the
  Inbox was just fixed for. The handler is explicit that adding a second
  equality clause would need a composite index and calls that *"a migration
  with a backfill, not a feature."*
- **F4 — the glance card's unread count is a count of three.** `unread` is
  computed as `rows.filter(s => !s.read).length` over the `PREVIEW_ROWS` slice.
  This is the *right* engineering call — see §5 — but the card's own docblock
  says it shows *"how many are unread,"* which is a wider claim than the number
  supports.
- **F5 — leads are append-only by design, and nothing says so on screen.**
  `LEADS_MAX_PER_HOST = 200_000` is four times `SITE_MEMBERS_MAX_PER_HOST`
  precisely because *"a lead is APPEND-ONLY and deduped by nothing"*
  (`visitor-record-ceiling.ts:100-118`). A site owner reading the Members &
  leads tab is reading a list of events presented as a list of people.
- **F6 — every host member can read every submission, including `viewer` and
  `author`.** `formSubmissions`, `leads` and `siteMembers` have no dedicated
  rules block; they are governed by the host catch-all, whose read is
  `isStaff() || (isHostMember(hostId) && !(subcollection in
  ['webhooks','orders','mediaTombstones']))`
  (`cloud/firebase-firestore.rules:1886-1888`). `isHostMember` is documented one
  screen up as *"the loosest membership test in this file: `admin`, `editor`,
  `author` and `viewer` all pass"* (:1071-1075). The file's own reasoning
  contradicts the outcome twice: `orders` is excluded from that read and gated
  by `canReadHostSensitive` (admin/editor) for carrying *"a shopper's address
  and payment data,"* and the org-level `contacts` block (:721-724) is
  deliberately org-wide-members-only with the note that *"a collaborator who
  genuinely needs their site's leads should get them through a server route
  that filters, not a widened rule."* Those are the **same people**: one form
  POST writes the contact and the submission in one request, and only one of
  them is protected. `host-content-collections.ts:146-149` calls
  `formSubmissions` *"unbounded, PII-heavy"* in the platform's own words.
  ⚠️ This is not caused by anything in this document, and §3's per-form list
  would be a second surface over the same open read — which makes the entity
  work the natural moment to close it, and makes widening it unacceptable.
- **F7 — `/v1` cannot see where a submission was routed.** `formSubmissionView`
  (`api-v1-resources.ts:1279-1289`) projects
  `{ id, object, form, path, fields, read, created }` and omits `routing`. The
  console dialog shows the dataset chip; an integration syncing the same rows
  into a CRM cannot tell that a record was already written.

---

## 2. The form entity

### 2a. Where it lives

```
hosts/{hostId}/forms/{formId}
  displayName    string        // authored; free to change, never an identity
  slug           string        // stable, lowercased, unique per host
  fields         FormFieldDecl[]
  consentFieldName?  string    // names the field in `fields` that IS the opt-in
  routing        { datasetId?, datasetFieldMap?, lead?: boolean }
  stats          { submissions, leads, lastSubmissionAtMs }   // §5
  archivedAt?    timestamp
  createdAt      timestamp
  updatedAt      timestamp
```

```
FormFieldDecl
  fieldName      string        // THE submission key; matches the node's prop
  label?         string
  fieldType      'text'|'email'|'textarea'|'select'|'radio'|'checkbox'|'rating'
  required?      boolean
  options?       string[]
  datasetFieldId? string
  role?          'name' | 'email' | 'phone' | 'consent' | null
```

**Host-scoped, not org-scoped.** A form renders on a site's pages, is authored
in that site's besigner, and its submissions already live at
`hosts/{hostId}/formSubmissions`. Every comparable authored artifact — screens,
layouts, components, workflows — is host-scoped. Org-scoping would be the
agency feature (§8 Q4) and it is a different decision.

**`role` is the fix for the sender guess.** `submission-presenter.ts` currently
matches field keys against a convention list because a form has no schema. With
`role`, the Inbox reads the declared name/email fields and stops guessing —
and a survey whose fields are `q1`…`q9` can *declare* which one is the email
instead of being told that showing "Someone" is the design.

**`consentFieldName` is the §1d fix.** One field on the form declares which
submitted value is the marketing opt-in. The route then passes
`marketingConsent: true` to `upsertHostContact` (and to `addHostLead`, §4) only
when that field was submitted truthy. Absent-or-true, never `false`, matching
every existing writer.

### 2b. Registration and enforcement

A form is created through the existing gate: a new entry in the resource table
at `apps/console/app/api/hosts/resources/route.ts`, alongside `screen`,
`layout`, `reusableComponent` and the rest —

```
form: {
  collection: 'forms',
  quotaKey: 'formsPerHost',            // see §6
  label: 'forms',
  activity: { type: 'content', noun: 'form' },
  fields: ['displayName', 'slug', 'fields', 'consentFieldName', 'routing'],
}
```

Three guards fire the moment `forms` becomes a host subcollection, and they are
features of this design rather than obstacles:

- `host-content-media-coverage.spec.ts` asserts `PLUGIN_CONTENT_COLLECTIONS`
  equals the repo-wide sweep minus the core list minus `MEDIA_SCAN_EXCLUDED`.
  Adding `forms` fails the build with a one-line decision. The correct answer
  is **scan it** — a form definition can carry an image field's default and is
  author-edited, unlike `formSubmissions`, which is excluded for being
  *"unbounded, PII-heavy."*
- The Firestore rules catch-all
  (`cloud/firebase-firestore.rules`, the create/update/delete exclusion lists)
  would otherwise grant every host-content writer full client access. `forms`
  should join the `components` pattern: excluded from the catch-all, re-granted
  through a dedicated block, with **delete gated on `canPublishHostContent`** —
  taking a live form down is the publish act in the other direction.
- `host-subcollection-write-deny-coverage.spec.ts` sweeps the same derived list,
  so the rules and the registry cannot drift.

The count that enforces a form limit is already transactional. The resources
route counts inside `firestore.runTransaction` with
`tx.get(collectionRef.count())`, which takes a pessimistic lock so the cap is
serialized against concurrent creates and the loser retries against the higher
count. A new `form` entry inherits that for free; a hand-rolled
read-then-`add()` would inherit the laundering bug instead.

### 2c. How a besigner-built form binds to it

**One new prop on the existing `Form` component: `formId`.**

That is the whole binding. `formName` stays, demoted to what it always was — a
caption — and resolves from the bound form's `displayName` when `formId` is
set. The client sends `formId` alongside everything it sends today; the route
stamps it on the submission.

The authoring surface is the one that already exists for datasets. `Form`'s
schema gains a `FORM_SELECT` attribute in the same family as `DATASET_SELECT`
(`components.types.ts:301`), listing the host's forms with a `None` option.
`FormField`'s inspector gains nothing at all: `ancestorDatasetId`
(`element-props-form.component.tsx:757-780`) already walks up the canvas tree
to find the enclosing `Form`'s dataset, and the same walk finds the enclosing
`Form`'s `formId`.

**Reuse across pages is the reusable-component system, unchanged.** Promote the
bound `Form` subtree once; place instances anywhere; the `formId` travels
inside the definition, so every instance writes the same form's submissions
without the author retyping a label. Per-page variation uses the
`attrOverrides` mechanism that already exists (`compose-reusable-components.ts:165-219`).
This is worth stating plainly: **the reuse half of "reusable forms" is already
built and sold** as `reusableComponents` on Starter and above. What is missing
is the entity that makes the reuse *mean* something.

⚠️ **Two instances of one definition are one form, and that is the point.**
Twelve pages, one submission list, one conversion denominator, one field
schema. An author who genuinely wants two forms makes two forms.

### 2d. Migration — the part that decides whether this is a design

Every form on the platform today is ad-hoc. A design that only works for new
forms is not a design.

**The migration is a promotion, not a rewrite, and it is authored — never
automatic.**

*Step 1 — discovery, on demand.* A "Forms" page for a host scans published
screens, layouts and component definitions for `componentId === 'form'` nodes,
and groups them by `(formName, path)`. This is the *Used by* scan's corpus and
its shape: `nodesReferenceComponent` and `collectReferencedComponentIds`
(`compose-reusable-components.ts:1041-1116`) already walk exactly this graph.
⚠️ **It is idle until asked**, for the reason `used-by-card.component.tsx`
states in full: the scan reads every screen and every layout, and mounting it
is the expensive-read shape this codebase has a standing rule against.

*Step 2 — adopt.* Each discovered group offers **Create a form from this**.
That mints a `forms/{formId}` document whose `fields` are read off the node
tree — `fieldName`, `fieldType`, `label`, `required`, `options`,
`datasetFieldId`, all already on the nodes — and sets `formId` on the `Form`
node in the screen's draft. The author saves and publishes as they would any
other edit. Nothing is published on their behalf.

*Step 3 — backfill history, keyed on what was actually recorded.* Existing
submissions carry `formName` and `path`. The adoption writes both onto the new
form as `legacyMatch: { formName, paths: [...] }`, and a backfill stamps
`formId` onto matching historical submissions.

⚠️ **The backfill's failure mode must be chosen deliberately, and the safe
choice is to leave rows alone.** Two forms sharing a label are genuinely
ambiguous, and `path` disambiguates them only when it was distinct. So:

- `(formName, path)` both match → stamp `formId`.
- `formName` matches, `path` matches no adopted form → **leave unstamped**, and
  show the count in the Forms page as *"N earlier submissions could not be
  matched to a form."*
- Never guess. An unstamped submission is still in the Inbox, still readable,
  still exportable over `/v1`. It is missing from one form's list, which is
  visible and recoverable. A wrongly stamped submission is invisible and is
  not.

*Step 4 — the reads keep working throughout.* `?form=Contact` continues to
filter on `formName` for as long as anything sends it, because the field is
still written. A new `?formId=` filter is added beside it. The legacy parameter
is not removed in any phase of this document — the same posture
`project_console_content_routing`'s legacy `?collection=` rewrites take.

⛔ **What is explicitly not proposed:** an automatic sweep that adopts every
form it finds and republishes screens. Publishing on an author's behalf is not
a migration, it is a deploy nobody asked for, and the besigner's own model is
that a Save alone propagates nowhere.

---

## 3. Submissions, and what happens to the Inbox

### 3a. The Inbox stays. It becomes a view.

**The Inbox is not replaced and it is not demoted to a per-form tab.** It is
the site-wide answer to *"who is waiting for a reply,"* and that question does
not decompose by form — a site owner opening it wants everything, newest first,
which is exactly what it now does correctly.

What changes is one control: **a form filter on the Submissions tab**, defaulting
to *All forms*, listing the host's `forms` documents plus an *Unassigned* entry
for rows with no `formId`.

Per-form lists are then the same list with the filter pre-applied, reachable
from the form's own page. One component, one query builder, two entry points —
the shape `project_console_content_routing` already uses for the three aliases
over one content component.

### 3b. The query, and the index it needs

```
collection('hosts/{hostId}/formSubmissions')
  .where('formId', '==', formId)
  .orderBy('createdAt', 'desc')
  .limit(pageSize + 1)
```

That is a composite index — `formId ASC, createdAt DESC` — and it must be
declared in `cloud/firebase-firestore.indexes.json` and deployed **before** the
filter ships. Two things follow, both of them lessons this repo has already
paid for:

- Index writes need `datastore.indexAdmin`; the deploy script runs with an
  explicit access token, and `firebase deploy --only firestore:indexes` must not
  be used because it deletes indexes not in the file.
- `orderBy('createdAt')` silently drops documents missing the field. It is safe
  here for the reason the Inbox already verified in its own docblock: the
  tenant form-submit route is the only writer, it stamps
  `createdAt: serverTimestamp()` on every add, `/v1` only reads and deletes, and
  `formSubmissions` is absent from `IMPORTABLE_FIELDS`. **That verification must
  be re-run for `formId`, and it fails** — every historical submission predates
  the field. Which is why the filter is an equality on `formId` and the
  *Unassigned* view is `where('formId', '==', null)` only if the backfill writes
  an explicit `null`. It should not; it should leave the field absent, and
  *Unassigned* should be served by the unfiltered query minus the stamped rows,
  or by a dedicated `formId: '__none__'` sentinel decided in §8 Q2.

### 3c. What the per-form list shows that the Inbox cannot

- Columns derived from the form's declared `fields`, in the author's order,
  instead of the sender heuristic.
- The consent column, when `consentFieldName` is set.
- The routing chip per row, already built.
- Export scoped to one form.

### 3d. `/v1`

`?formId=` joins `?form=` and `?read=`. The existing note at
`api-v1-resources.ts:1389-1400` — that combining two equality clauses with the
document-id ordering needs a composite index and is *"a migration with a
backfill, not a feature"* — applies unchanged and is the reason `?formId=` +
`?read=` narrows in memory exactly as `?form=` + `?read=` does today.

`formSubmissionView` gains `form_id`, and should gain `routing` at the same time
(F7): an integration that syncs submissions into a CRM currently cannot tell
that a row was already written to a dataset, which is the one fact that stops it
duplicating work the platform already did.

---

## 4. Leads

### 4a. When a submission becomes a lead

**When the form says it should, and the submission carries an email.**
`routing.lead: true` on the form document; `extractEmailFromFields` is already
called on the same path. Nothing is inferred from the submission's content.

This is deliberately an author's declaration rather than a heuristic, and it
follows the existing split: the newsletter block enrolls, the signup handler
creates a lead, the bookings handler creates a lead — each because the surface
*is* a lead surface, not because a rule inspected the payload.

### 4b. What stops one person becoming two records

**One derivation, in one exported function, used by every writer.**

✅ **Already built.** D4 shipped it; this phase imports it and adds nothing.

```
libs/aglyn/src/lib/app-utils/person-key.ts     // via @aglyn/aglyn/server
  export function personKey(email: unknown): string | null
    // sha256(normalizeContactEmail(email)), full digest, or null
```

- It composes the **existing** normalizer. `normalizeContactEmail` already
  trims, lowercases, regex-validates and length-bounds; re-implementing that is
  how `emailSuppressionKey` and `suppressionId` came to disagree
  (`docs/specs/email-overhaul.md` D5).
- It is the **same** derivation `docs/specs/email-overhaul.md` §3d chose for
  `memberKey`. That spec closed D4 with it; this one uses it for leads.
  **Two specs, one function.**
- It is a **full digest**, never truncated. The 20-hex truncation in
  `run-event-actions.ts` was one of the three reasons D4 existed.
- ⚠️ It is **not** in `contacts.ts`, where this spec first placed it. That
  module is re-exported by the full `@aglyn/aglyn` barrel that client code
  bundles, and `personKey` imports `node:crypto` — the same constraint that
  holds `api-adapter`, `api-idempotency` and `plugin-bundle-checks` out of that
  barrel. Only the file moved; the signature and the derivation are as
  specified.

**Leads become one document per person per host**, at
`hosts/{hostId}/leads/{personKey}`, with the capture history as fields rather
than as extra documents:

```
hosts/{hostId}/leads/{personKey}
  email, name?
  sources        string[]      // 'signup' | 'booking' | 'form:{formId}'
  firstSeenAtMs, lastSeenAtMs
  submissionCount number
  marketingConsent?, marketingConsentAtMs?
  createdAt
```

⚠️ **This is a real change to what a lead means, and it must not be
hand-waved.** `visitor-record-ceiling.ts:100-118` states the current model
plainly: a lead is append-only, *"every sign-up writes one, and so does every
booking … so one returning customer legitimately produces many."* That reasoning
is correct about the *events* and wrong about the *record*. The fix keeps both:
the person is one lead document; the events are the submissions, the bookings
and the member document that already exist. `sources` and `submissionCount`
carry what the extra rows were carrying.

Three consequences follow and all three are improvements:

- `LEADS_MAX_PER_HOST = 200_000` was sized at 4× the member ceiling *because*
  leads accumulate per event. Deduped, leads and members count the same
  population and the 4× rationale evaporates. **The number should not be
  lowered** — §6 — but the docblock's reasoning has to be rewritten to say what
  the number now means.
- The Inbox's `member.email === lead.email` display dedupe becomes a
  `personKey` comparison, and one person stops rendering as a Member on one page
  and a Lead on another.
- `docs/specs/email-overhaul.md` D1's `leads` audience read
  (`campaign-send.ts:306`, `limit(1000)` with no `orderBy`) is reading a
  collection whose size stops growing with traffic. That does not fix D1 — the
  missing `orderBy` is still a random sample — but it shrinks the population
  the fix has to page over.

### 4c. Migration for existing leads

A collapse, not a rewrite: group `hosts/{hostId}/leads` by `personKey`, write
one merged document per key keeping the **earliest** `createdAt` as
`firstSeenAtMs`, the union of `source` values as `sources`, the count as
`submissionCount`, and the earliest `marketingConsentAtMs` where present. Then
delete the superseded rows.

⛔ **Consent may only ever be carried forward, never dropped and never
invented.** If any row in a group carries `marketingConsent: true`, the merged
document carries it with the earliest timestamp. If none does, the merged
document has no consent field. A merge must never be the moment a person
acquires or loses an opt-in.

⚠️ The delete half is the risky half. It should run only after the merged
documents are verified, and it is the one place in this document that destroys
customer data — so it belongs behind a staff-run script with a dry-run mode, in
the shape `tools/scripts/backfills/` already uses, and never in a request path.

---

## 5. Per-form performance

### 5a. What is measured

| Metric | Where it comes from | Cost per event |
| --- | --- | --- |
| **Submissions** | `forms/{formId}.stats.submissions`, `FieldValue.increment(1)` on the write the route is already making | one field on an existing write |
| **Leads** | `stats.leads`, incremented on the same write when `routing.lead` produced one | same write |
| **Last submission** | `stats.lastSubmissionAtMs` | same write |
| **Views** | `forms/{formId}.stats.views`, incremented by the analytics beacon | **one extra write per page view that contains a form** — see 5b |
| **Conversion rate** | `submissions / views`, computed in the browser from two numbers already on one document | zero |
| **Per-day series** | `hosts/{hostId}/formAnalytics/{formId}:{day}`, `{ views, submissions, expiresAt }` | one extra write per event, TTL-swept |

The increment-on-write pattern is not invented here. It is exactly
`hosts/{hostId}/overlays/{overlayId}.stats.{impressions|clicks|dismissals}`
(`apps/tenant/app/api/analytics/collect/route.ts:737-756`), and the day-doc
pattern is exactly `hosts/{hostId}/screenAnalytics/{screenId}:{day}`
(:875-897) with the same `analyticsDayExpiresAt` stamp. Both should be reused
rather than reimplemented, including the detail that the overlay stats write is
`update()` and not `set()`, *"so beacons from stale cached pages must not
resurrect a deleted overlay as a stats-only stray doc."* A deleted form must not
be resurrected by a form-view beacon either.

### 5b. What it costs, stated honestly

⛔ **No aggregate scans a growing collection on any render.** Not
`count()`, not a full read, not on mount, not behind a spinner. The submissions
collection grows without bound and is the one the customer is billed on; a
console surface that counted it would be the expensive-read defect this product
has created repeatedly.

The one genuinely new cost is **the view counter**, and it must be argued for
rather than assumed:

- The beacon already fires once per page view and already writes two documents
  (`analytics/{day}` and `screenAnalytics/{screenId}:{day}`). Adding a form
  view makes it three on pages that contain a form.
- It requires the *client* to know which forms rendered — which the tenant
  runtime knows after `composeReusableComponentNodes`, and which it can report
  as a `formIds` array on the existing pageview beacon rather than as a separate
  request. **One array on an existing beacon, not a new endpoint.**
- ⚠️ Multiple forms on one page means multiple increments per view. The array
  must be bounded (the same `slice`-and-cap posture the route applies to
  `fieldMap`).
- ⚠️ A form inside a **popup** is not viewed when the page is. The popup
  already reports `popupImpression`; a form inside one should take its view from
  that event, not from the pageview.

**The cheaper alternative, and why it is not enough.** The denominator could be
derived from `screenAnalytics` for the screens that place the form — no new
writes at all, using the *Used by* scan to enumerate them. It is wrong in two
ways that matter: a screen's views are not the form's views when the form is
below the fold or inside an overlay, and the enumeration is a scan, which puts
an expensive read behind a number that is supposed to be cheap. It is a
reasonable Phase-1 stopgap that reports *"views of pages containing this form"*
under that exact label, and it is not a conversion rate.

### 5c. Display gating

Follow the `screenAnalytics` decision exactly: **always collected, display
gated.** A tenant who upgrades gets history rather than a start-from-zero
counter, and the beacon stays cheap for everyone. Whether per-form performance
sits under the existing `screenAnalytics` entitlement or gets its own is §8 Q5.

---

## 6. Capacity

### 6a. The rule, and where forms fall under it

`apps/console/utils/server/capacity-in-use.ts` states it: **the enforcement
point is the reduction, not the use.** Re-checking at use time *"would mean
ejecting a teammate or locking a dataset."* `apps/console/utils/over-limit.ts`
is the one comparison, with `OVER_LIMIT_KINDS` — `sites`, `seats`, `datasets` —
and `CapacityAddonKind` names the add-on kinds the gate covers.

That file also draws the line this section needs, in its own words:
`eventCalendar` is excluded because *"it is a feature switch — turning it off
refuses a capability, not a person or their data, which is exactly the class
that never needed this."*

The other half of the rule is stated at `plan-entitlements.ts:2168-2222`, under
the heading *"THE GRANDFATHER BOUNDARY"*: `retainedOverCap` is how many seats a
site holds above its limit, they are retained, and **"the cap binds ALLOCATION,
never ACCESS."** Whatever a form limit turns out to be, it binds the creation of
a new form and nothing else.

Forms split cleanly across that line, and the split is the whole answer:

| Thing | Class | Enforcement |
| --- | --- | --- |
| **A form** | an authored artifact, like a screen, a layout or a dataset | **at the reduction.** `formsPerHost` joins the create-time gate at `/api/hosts/resources` AND `overLimitRows`, so a downgrade that would strand forms is refused at the moment of choosing, and no form is ever deleted, hidden or disabled. |
| **A submission** | a person's data arriving | **never refused for capacity on a paid plan.** Already correct: `checkFormSubmissionQuota` returns `allowed: true` on every metered plan and bills the excess. |
| **A lead** | a person | **never refused, never ejected, never merged away.** §4's collapse is a dedupe of records, not a reduction of people. |
| **Traffic that is not a customer's** | abuse | the ceiling, unchanged. `checkFormSubmissionAbuseCeiling` is containment and its docblock is explicit that conflating it with the plan gate is how *"the plan gate ended up as the anti-abuse control it was never designed to be."* |

**So forms do not differ, and no argument for an exception is needed.** What
was missing was the reduction gate, because there was no artifact to gate.

### 6b. Adding `formsPerHost`

⚠️ Adding a numeric plan dimension is a **packaging change** and takes a
Pricing Decision Log entry, exactly as a price move does — `docs/feature-matrix.md`
says so in its change-control note, and `check:feature-matrix`,
`check:pricing-tables` and `check:decision-log` enforce it. The Sept-1 price set
is locked and a charged price may not change; a new *included band* on an
existing plan is not a charged price, but it is still a six-place move and it is
§8 Q3.

⚠️ **A finite number plus an explicit boolean, never `UNLIMITED` across the
wire.** `JSON.stringify(Infinity)` is `null`, `Number(null)` is `0`, and
`Number.isFinite(0)` is `true` — so the sentinel sails through every guard and
renders a cap of zero on the most expensive plan.

⚠️ **Name the key for the scope the collection actually has.** `contactsPerHost`
is enforced and metered org-wide over `orgs/{orgId}/contacts` despite its
suffix, and `datasetsPerHost` → `datasetsPerOrg` is a `LegacyEntitlementKeys`
entry (`plan-entitlements.ts:125`, resolved at :1932) — the standing cost of
getting a suffix wrong once. Forms are host-scoped per §2a, so the key is
`formsPerHost` and it must stay that.

⚠️ **Three derived guards fire on a new numeric key, and all three are
features.** None can be satisfied by adding the number alone:

- `quota-surface-coverage.spec.ts` derives its key set from
  `Object.keys(PLAN_ENTITLEMENTS.free)` and requires every one to have a console
  surface — and specifically not a *limit-only* one. A ceiling with no odometer
  fails, which is the `emailSendsPerMonth` regression it was written for.
- `quota-enforced-somewhere.spec.ts` requires a non-comment reader outside the
  plan model, because a staff-writable field that nothing reads *"reported
  success while doing nothing"* — the `totalSiteSizeMb` post-mortem.
- `free-tier-caps-refuse.spec.ts` requires a refusal at the cap, an acceptance
  one below it, **and a causation test**: relax that one cap by one unit and the
  same usage must succeed, because *"a refusal that survives its own cap being
  raised was never that cap's refusal."*

⚠️ Gate the readout on `ready`. `checkQuota(undefined, …)` resolves as **Free**,
which is a repeatedly-shipped bug class in this codebase — an ungated denominator
tells a Business customer their cap is the free one.

**The alternative, and it is a real one.** Do not add a plan dimension at all.
Gate forms on the **existing `reusableComponents` entitlement** — a boolean,
already Starter-and-above, already server-enforced at
`/api/hosts/resources`, and already on the published feature matrix — plus a
flat platform ceiling in the `WEBHOOK_MAX_PER_HOST` / `AUTHORS_MAX_PER_HOST`
family with no `OrgEntitlements` key and nothing on the price list to explain.
That is zero pricing motion, zero decision-log entries, and it is the shape
`docs/DECISION_LOG.md`'s 2026-08-23 entry approved for the member/lead ceiling.
**This document recommends it for Phases 1–3** and leaves `formsPerHost` to §8
Q3.

### 6c. What must not change

- `LEADS_MAX_PER_HOST` and `SITE_MEMBERS_MAX_PER_HOST` stay where they are.
  Deduping leads (§4) makes the ceiling less likely to trip; lowering it because
  of that would convert a safety margin into a plan limit, which
  `docs/DECISION_LOG.md` explicitly forbids. ⚠️ Two assertions in
  `apps/console/specs/free-tier-caps-refuse.spec.ts` bind §4 directly:
  `expect(LEADS_MAX_PER_HOST).toBeGreaterThan(SITE_MEMBERS_MAX_PER_HOST)`
  (:651), and the sweep at :683 requiring every lead writer to route through
  `addHostLead` with no direct `collection('leads')` write — *"a
  `collection('leads')` write is what the ceiling cannot see."* Both must
  survive §4, and both are reasons the upsert belongs **inside** `addHostLead`
  rather than beside it.
- Neither ceiling becomes a plan dimension. The same spec asserts
  `expect(entitlements).not.toHaveProperty('siteMembersPerHost')` across all
  eight plans, and `checkVisitorRecordCeiling` takes no org argument *"so there
  is nowhere for a plan to enter the answer."*
- The free plan's submission wall stays a wall. There is no subscription to
  meter onto, and this document does not reopen it.
- Submissions are never dropped for quota, and no retention policy in this
  document deletes one. The `formAnalytics` day docs carry a TTL; the
  submissions do not.

---

## 7. Phased plan

### Phase 0 — Fix what is wrong now *(no new entity)*

F1's prop shadow; the form route forwarding `marketingConsent` to
`upsertHostContact` **once a form can declare which field it is** — so this
half waits for Phase 1 — and the `?form=` filter's documented ordering caveat
surfaced in the docs rather than left in a code comment.

**Does not:** create any collection, add any limit, or change any price. Does
not touch the Inbox.

**Why first:** F1 is a live footgun with a test standing on it, and everything
downstream keys on `fieldName` being the submission key.

⚠️ **F6 is a decision, not a task, and it belongs here rather than later.**
Narrowing the catch-all read so `formSubmissions`, `leads` and `siteMembers`
join `orders` behind `canReadHostSensitive` would take the submission archive
away from `viewer` and `author` — roles that can read it today and may be
relying on it. That is a customer-visible removal and it is §8 Q9. What is not
optional is that no phase of this document *widens* it.

### Phase 1 — The entity, and adoption

`hosts/{hostId}/forms`, the `form` resource-table entry, the rules block, the
media-scan registry entry, the `formId` prop on `Form`, the `FORM_SELECT`
inspector attribute, a Forms page listing the host's forms, and the
discover-and-adopt flow (§2d steps 1–2). Submissions start carrying `formId`.

**Does not:** backfill history, add a per-form list, measure anything, create a
lead, or add a plan limit. Gated on the existing `reusableComponents`
entitlement plus a flat platform ceiling.

**Why here:** every later phase needs a form id on the row, and the adoption
flow is what makes the id exist for forms that already shipped.

### Phase 2 — Per-form submissions

The composite index, the Inbox form filter, the per-form list reusing the same
component, `?formId=` on `/v1`, columns from the declared `fields`, and the
§2d step-3 backfill with its unmatched count surfaced.

**Does not:** remove `?form=`, remove `formName` from the submission document,
or guess at an ambiguous match. Does not measure conversion.

### Phase 3 — Leads

`routing.lead` honoured on the form path; `addHostLead` rewritten to upsert on
`personKey`; the collapse backfill behind a dry-run script; the Inbox's display
dedupe moved onto `personKey`; the `visitor-record-ceiling.ts` docblock
rewritten to say what the number now means.

**Does not:** change `LEADS_MAX_PER_HOST`, unify leads with contacts or site
members, introduce a `personId`, or infer consent from anything. Does not touch
`campaign-send.ts` — D1 belongs to `docs/specs/email-overhaul.md` Phase 1.

✅ **Settled.** D4 shipped first, so `personKey` already exists as `memberKey`'s
derivation and this phase imports it from `@aglyn/aglyn/server`. **It must not
add a second copy** — `tools/scripts/backfill-list-member-keys.mjs` restates the
derivation out of necessity (it is a plain module and the helper is TypeScript)
and guards it by refusing `--apply` when the two disagree. A lead backfill that
needs the same restatement should carry the same guard.

### Phase 4 — Per-form performance

`stats` on the form document, incremented on the write the route already makes.
The per-day `formAnalytics` docs with the shared TTL stamp. The stopgap
denominator labelled *"views of pages containing this form."* A performance card
on the form page, display-gated.

**Does not:** add the form-view beacon, count any collection on read, or claim a
conversion rate it cannot compute.

### Phase 5 — Real form views

`formIds` on the existing pageview beacon, bounded and capped; the popup's form
taking its view from `popupImpression`; the real conversion rate replacing the
stopgap, with the label changing at the same moment the number does.

**Does not:** add an endpoint, track any visitor, or store anything per-visitor
— two integers per form per day, the same discipline the dwell-time collector
states for itself.

### Phase 6 — Packaging, only if it is wanted

`formsPerHost` as a plan dimension, joining `overLimitRows` and the create-time
gate, with the console surface `quota-surface-coverage.spec.ts` requires and the
Decision Log entry `check:decision-log` requires.

**Does not:** change any charged price while the Sept-1 lock stands. Does not
enforce at use time, and does not eject or hide a form the org already holds.

---

## 8. Open questions for the owner

**Q1 — Is a form host-scoped or org-scoped?**
Host-scoped matches every other authored artifact, matches where submissions
already live, and is less work. Org-scoped is what an agency running forty
client sites actually wants — one intake form, forty sites — and it is the same
question `docs/specs/email-overhaul.md` Q4 asks about sending domains. Answering
them differently would put a form and its sending identity at different scopes,
which is survivable but has to be a choice rather than an accident.

**Q2 — How is "unassigned" served?**
Leaving `formId` absent on unmatched history is safe and needs no write, but it
cannot be queried — Firestore has no "field missing" filter, so the Unassigned
view would have to page the whole collection and subtract. Writing an explicit
sentinel makes the view a cheap equality but means touching every historical
submission, on the one collection that is unbounded and billed.

**Q3 — `formsPerHost` as a plan dimension, or the `reusableComponents` boolean
plus a flat ceiling?**
The dimension is a cleaner story on the price list and a genuine upsell. It is
also a six-place packaging move under a price lock, and it introduces a number
that a downgrade can strand — which is more capacity gate to get right. The
boolean-plus-ceiling costs nothing, ships now, and gives away forms to every
paying plan equally.

**Q4 — Does the backfill delete the superseded lead rows, or keep them?**
Deleting gives one document per person and a lead count that means something.
Keeping them means the collapse is reversible and nothing is destroyed, at the
cost of a collection that still grows per event and a ceiling that still counts
the old way. There is no third answer that gives both a true count and a
reversible migration.

**Q5 — Is per-form performance a new entitlement, or does it ride
`screenAnalytics`?**
Riding `screenAnalytics` (Pro+) is zero packaging motion and puts form
performance beside screen performance, where a reader would look for it. A
separate flag lets forms be sold lower — and a conversion rate is arguably the
most compelling thing a Starter customer could see — but it is another feature
matrix row and another decision-log entry.

**Q6 — What happens to the popup's hand-rolled submit path (F2)?**
Routing it through `Form` makes one client, one honeypot, one field-map
convention, and gives the popup a real form entity with real per-form metrics.
It also touches a shipped marketing surface whose capture behavior is currently
simple and works. Leaving it means `formName: 'Popup'` stays a magic string
outside the entity model forever.

**Q7 — Does an adopted form's `displayName` change what `?form=` returns?**
No, if `formName` keeps being written from the form's current display name —
which means renaming still splits the *legacy* filter's history, exactly as
today. Freezing `formName` at adoption keeps the legacy filter stable and makes
the Inbox's label go stale. Neither is clean; the choice is which
already-imperfect surface stays predictable.

**Q8 — Should a form be able to declare a `consent` role without an email
field?**
A consent record with no address is unusable, so the honest answer is to refuse
the combination at authoring time. But the same form might collect a phone
number, and `isPhoneContactSuppressed` exists in this codebase as a do-not-contact
gate with nothing calling it — so refusing on "no email" would foreclose an SMS
consent story that is already half-present.

**Q9 — Do `viewer` and `author` keep their read of form submissions (F6)?**
Narrowing it to `canReadHostSensitive` matches how `orders` is already treated
and matches the argument the rules file makes for org-level `contacts` — the
same people, currently protected in one collection and not the other. But it
takes a read away from two roles that have it today, on a site an agency may
have deliberately staffed with `author` precisely so the client sees the inbox
and not the order book. Leaving it means the per-form list ships as a second,
more convenient surface over an archive the platform itself calls PII-heavy.

---

## Appendix — what was not verified

- **No production data was read.** No claim about how many ad-hoc forms exist,
  how many submissions carry a matchable `(formName, path)` pair, or how many
  leads would collapse under §4 is made anywhere in this document. Those
  numbers decide how expensive the migrations in §2d and §4c are, and they can
  only come from a query against production.
- **No browser was used.** The besigner's authoring surfaces are described from
  their source, not from driving them.
- **The index cost is stated, not measured.** `formId ASC, createdAt DESC` on
  `formSubmissions` is an index over the largest per-site collection the product
  has; its build time and storage cost on the busiest existing site were not
  estimated.
- **`docs/specs/email-overhaul.md` was read at `c08f3b93c` and taken as
  accurate.** Its defect numbering (D1–D7) is cited, not re-derived — except
  D4, which was re-checked against `main` and is still present at
  `newsletter.ts:51` and `run-event-actions.ts:492-495`.
- **No Linear issue was opened, and none is claimed to describe this work.**
