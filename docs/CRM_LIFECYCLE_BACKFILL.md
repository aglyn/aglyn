# CRM lifecycle backfill (AGL-2631)

Three gaps the CRM v2 arc left in the data that was already there, closed by
one script: `tools/scripts/backfill-crm-lifecycle-stages.mjs`. Its decisions
live in `tools/scripts/lib/crm-lifecycle-backfill.mjs` and are pinned by
`tools/scripts/lib/crm-lifecycle-backfill.test.mjs`
(`npm run test:crm-lifecycle-backfill`).

| Gap | Left by | Repaired by |
| --- | --- | --- |
| A contact captured before the doors set a stage floor has no `lifecycleStage` on any facet: "—" in the Stage column, invisible to the stage filters, the Sources & lifecycle and Conversion by source cards, and the `lifecycleStage == "lead"` automation filter | AGL-2612 | the default pass |
| A person a lead-routed form or a booking request captured before lead routing existed never entered `hosts/{hostId}/leads` | AGL-2612 | `--leads` |
| `contactsCount` on a company counts only the links made after the counter shipped | AGL-2613 | `--companies` |

**Dry run by default.** The stage pass always runs; `--leads` and
`--companies` add the other two; `--apply` writes whichever passes ran.
`--any-form` widens `--leads` to every form the host has ever held — see
[the backlog from before lead routing](#--any-form-the-backlog-from-before-lead-routing).

## Running it

From the root checkout, whose `.env` carries the service account
(`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`). The project is named on
the command line because the key file does not carry it:

```sh
# 1. Report everything, write nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --companies

# 2. Write.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --companies --apply

# 3. Prove it is done: the same dry run plans nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --companies
```

`--org=<orgId>` limits a run to one org. `FIRESTORE_EMULATOR_HOST` skips the
credential for a local proof against the seeded emulator (`docs/E2E_LOCAL.md`).
`--help` prints usage and exits; an unrecognized argument exits 2 having
written nothing (`lib/deploy-args.mjs`).

### What a run prints

```
preconditions: OK — the stage table agrees; the doors never downgrade; every door sets its floor; …
project aglyn-main via service account … — DRY RUN

org <orgId>: 42 contact(s), 2 site(s)
  stages: would stamp 12 facet(s) — customer 3, lead 7, subscriber 2; 25 hold a stage; 5 imply none
  leads (<hostId>): would create 4 — 1 routed form(s); 7 already a lead; 1 erased on this site; 2 already worked past Lead; 3 met through no lead surface (turn routing on, or pass --any-form, and re-run)
      3f2a9c1b0e7d…  form:<formId>  captures 2  seen 2026-07-03 → 2026-08-14  consent carried
  companies: 1 of 3 would be fixed; 2 in step
      Cedar & Salt (a1b2c3d4e5f6…)  absent → 2

Dry run: 12 facet stage(s) on 42 contact(s) across 1 org(s) (customer 3, lead 7, subscriber 2); 4 lead(s) created (…); 1 company count(s) fixed.
  Re-run with --apply to write.
```

A clean second run reads `would stamp 0 facet(s)`, every lead candidate under
`already a lead`, and every company `in step`. Lead rows are listed by the
first twelve characters of the person key, never by address.

## The rules, and where they come from

**The stage floor** is the doors' own table, read off what the doors left on
each facet: an `order` source or money on the facet (`ordersCount`,
`ltvCents` — how a paid booking shows) is a **customer**; a `form` or a
`booking` source is a **lead**; a `member` or `newsletter` source is a
**subscriber**; a facet met only by hand, by import or over the API implies
nothing and is left without a stage, which is what those doors mean. Only a
facet WITHOUT a usable stage is written — the never-downgrade rule of
`advanceContactLifecycleStage`, so a customer who once filled in a form
stays a customer. A stored value that is not a stage at all is replaced the
way a door would replace it, and counted in the report.

There is no org-level stage mirror to stamp: every reader — the list's Stage
column and filter, the record page, the CSV export, dynamic lists, the
reports — reads `facets.{groupId}.lifecycleStage`, so the facet write is the
whole write.

**The historical lead** is planned per host from the contact's own timeline.
A form capture is attributed by the FORM — a form id is minted under one
site — and only a form whose author has `routing.lead` switched on today is
a lead surface (`leadSurfaceForms`); an interaction that predates the form
entity is joined to its form through the submission it names, which
`backfill-form-ids` stamped. A booking is attributed by the interaction's
`hostId`, or by the facet being the host's own group of one when the
interaction carries none. The row is the one `addHostLead` writes — `email`,
`name`, `sources` as `form:{formId}` / `booking`, `submissionCount` from the
host's submissions plus the bookings, `firstSeenAtMs`/`lastSeenAtMs` from
the captures (falling back to the contact's own `createdAt` and `updatedAt`
when the timeline kept no timestamp), `capturedByHostIds`, `createdAt` —
plus `status: 'new'` and
`backfilledAtMs`, and with the contact's marketing grant for that host
copied across when the record reads as granted and nothing on it refuses.

**No owner.** The site's default owner and the round-robin apply to captures
as they arrive; a queue of old leads handed to whoever is next up today would
be an assignment nobody decided. Assign them from the Leads list.

**The skips** protect a person: `erased` — the host's suppression list holds
a row with `reason: 'erasure'` for the address, and nothing is rebuilt;
`already a lead` — a row exists under the person key or under an older
auto-id carrying the same address, and is never overwritten (`create()`
refuses an existing document besides); `already worked past Lead` — the
holder's facet stands at marketing-qualified or later, customers included,
so somebody has worked this person and a queue entry saying nobody has would
be false; `met through no lead surface` — the site met them through a form
without lead routing, an order or an opt-in. For the form, turning routing on
and re-running changes that verdict, and so does `--any-form`; for an order
or an opt-in nothing does.

**The company count** is re-derived from every contact's `companyIds`
mirror, the quantity `COMPANY_CONTACTS_COUNT_FIELD` is defined over, and SET
rather than incremented so a re-run cannot compound. An absent count reads as
zero, as the list reads it, so a company nobody linked gains no write. An id
the mirrors name that no company answers to is reported and left.

## `--any-form`: the backlog from before lead routing

The default lead pass files a lead only for a form whose author has
`routing.lead` on today, which is the right verdict for a form somebody
decided about. It is the wrong verdict for the people captured before lead
routing existed: they came in through forms nobody could have switched on,
several of those forms have since been deleted, and the first production dry
run planned no lead at all — every candidate read `met through no lead
surface`. Every person who came in through a form and was never worked or
converted is a historical lead, so `--any-form` (with `--leads`) treats every
form the host has ever held as a lead surface: a live form with routing off,
an archived form, and a form deleted outright — a deleted form leaves its
submissions behind (`hosts/{hostId}/formSubmissions` keeps `formId`), and
they still name it.

**The source kind, when no form id survived.** The second production dry
run, with the flag, still planned no lead: the pre-CRM contacts carry no
`formIds` mirror, their facet's `interactions` name no submission and no
form (the timeline predates `refId` and `formId`), and the one record that
a form met them is the facet's `sources: { form: true }` — the KIND of
surface, the same flag the stage pass already reads as a lead. So under
`--any-form` that kind is a lead surface too: a facet that is the host's own
group of one (`facets.{hostId}`) with `sources.form` set, and no surface
named anywhere on the record, plans a row `by source kind`. A shared facet
(`facets.{groupId}` for a declared group) cannot say which site's form and
is left, the same rule a booking without a `hostId` follows.

For such a row the form is looked for in the host's submissions by the
address, with the same email extraction the submit route uses across every
form the host has held: every form those submissions name is spelled on the
lead as `form:{formId}`, exactly as the door would have written it, and when
none of them names a form — or there are none — the lead's `sources` reads
`['form']`, the kind alone. The Leads list and the lead page label that
chip `Form`; every other reader (`leadSources`, the convert route, the
reports) takes the array as strings. `submissionCount` is every submission
by the address on every form, named or not, never below one;
`firstSeenAtMs`/`lastSeenAtMs` bracket the facet's form interactions when
they carry `atMs`, else fall back to the contact's `createdAt` and
`updatedAt`.

Nothing else widens. The row is the same row; `submissionCount` counts the
host's submissions for the address on every form the run counts; the
marketing grant is copied on the same terms; `backfilledAtMs` is stamped;
no owner, no events. Every skip stands: erased, already a lead, already
worked past Lead (customers included), and a person the site met only
through an order or an opt-in is still `met through no lead surface`.

```sh
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --any-form
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --any-form --apply
```

`--any-form` without `--leads` exits 2 having written nothing. The report
names every form it counted only because of the flag, with why it would not
have counted otherwise, and counts the rows planned from the source kind
alone (`by source kind (no form id)`), marking each such row:

```
  leads (<hostId>): would create 9 — 1 routed form(s); via --any-form: 3 unrouted form(s); via --any-form: 2 by source kind (no form id); 2 already a lead; 4 already worked past Lead; 1 met through no lead surface (no form, no booking)
      via --any-form: Contact us (<formId>)  routing off — turn it on
      via --any-form: Wholesale enquiry (<formId>)  archived
      via --any-form: <formId>  no form document
      3f2a9c1b0e7d…  form:<formId>  captures 2  seen 2026-03-11 → 2026-05-02
      8b1e04c7d2a5…  form:<formId>  (by source kind)  captures 1  seen 2025-11-02 → 2025-11-02
      c9d3f10a6e42…  form  (by source kind)  captures 1  seen 2025-10-19 → 2026-01-08
…
Dry run: …; 9 lead(s) created (…); via --any-form: 3 unrouted form(s) counted as lead surfaces; via --any-form: 2 by source kind (no form id); ….
```

**Run it once, for the backlog.** The flag is a statement about the past —
that every form capture before routing existed was a lead. A later run with
it would make the same statement about every capture an unrouted form has
taken since, which is the decision the form's own page exists to make, one
form at a time. So, after the apply: switch lead routing on for each
`routing off` form that still exists — the Leads section offers **Turn on
lead routing** beside every form that can route — so the doors file the next
capture themselves. The archived and deleted forms need nothing: their
captures are filed and they take no new ones. A second dry run with the flag
proves the backlog is done — every candidate reads `already a lead` — and
the ordinary run without it is the one to keep using.

## What it refuses, and why

`--apply` is refused unless the tree it runs from still says what the script
assumes, read from the sources rather than trusted: `CONTACT_LIFECYCLE_STAGES`
lists the same stages in the same order; `advanceContactLifecycleStage` still
keeps the later stage; every capture door still names its floor
(`initialLifecycleStage`); `personKey` is still the full sha256 of the
normalized address; `addHostLead` still keys by it; the field names
(`facets`, `formIds`, `capturedByHostIds`, `companyIds`, `contactsCount`,
`marketingConsent`, `marketingConsentByHost`, `suppressions`, `erasure`) are
still spelled the same. A backfill that fills a field nothing maintains going
forward reports success on the day and is wrong from the next capture on.

## What it does not do

- It emits no events. A stage stamped here fires no `contactChangedStage`
  automation and a lead created here fires no `contactCreated`, exactly as
  the commerce backfills reuse no live path.
- It bumps no `updatedAt`, so a list ordered by edits does not reshuffle to
  put every historical row on top.
- It never deletes, and never writes a refusal of consent — a refusal lives
  on the suppression list already.
- It cannot tell a paid booking from a request on a facet the payment
  webhook never stamped money onto (a paid booking that predates AGL-1755).
  Such a facet reads as a lead, and the next order advances it.

## Idempotence and interruption

The stage pass writes only a facet that holds no usable stage, so the second
run finds nothing. A lead is created with `create()` after the plan has
already skipped every address the host holds a row for. A company count is
set to the re-derived figure. An interruption leaves a partially written org,
which is the state a re-run finishes.

## Emulator proof — 2026-09-06

Against the seeded emulator (`docs/E2E_LOCAL.md`), with a routed form, a
two-submission contact carrying a grant, an erased contact, a pre-form-entity
capture, a buyer, a member, a booking request, an unrouted-form contact, a
person already held under an older auto-id lead, and a company counted at
zero planted beside the seed: the dry run planned 8 facet stages (customer 1,
lead 6, subscriber 1), 4 leads with every skip class exercised (1 erased,
1 already a lead, 5 already worked past Lead, 3 through no lead surface), and
the one company at `0 → 1` with the orphan id left; `--apply` wrote exactly
that; the second dry run planned nothing. Three seeded rows with no facet map
at all were reported and left.

## Production runs

- **2026-09-06, dry run (`--leads --companies`)**: 15 facet stages planned,
  0 leads — every candidate `met through no lead surface`, because the forms
  that captured them predate lead routing and several no longer exist. That
  is what `--any-form` is for.
- **2026-09-06, dry run (`--leads --any-form --companies`)**: still 0 leads,
  every candidate `met through no lead surface (no form, no booking)`. The
  records were inspected read-only: the pre-CRM contacts carry no `formIds`
  mirror, and the facet's `interactions` name no submission and no form —
  the only record of the form is `facets.{hostId}.sources.form`. That is
  what the source-kind rule above answers; record its dry run and the apply
  here.
