# Consent groups (AGL-3320)

A **consent group** names the sites of one organization that are **one sender**.
Undeclared, every site is its own group of one: a grant reaches only the site it was
given to and an opt-out holds only that site. Declared, a signup on a form that showed
the group's name may be mailed by every site in it, an opt-out on any of them holds all
of them, and the CRM keeps one record per person for the whole group.

The declaration is one org field, `org.consentGroups` (`{ [groupId]: { name, hostIds } }`),
read only through `readConsentGroups` / `consentGroupForHost`
(`libs/aglyn/src/lib/app-utils/consent-groups.ts`). The rules deny it to every client.
The only writer is the change executor below; the console's editor asks it for a change
and never writes Firestore.

Two rules decide everything that follows:

- **Restrictive facts are read across the CURRENT group** — an opt-out stored on one
  site holds every site the group names today. So a site **joining** inherits every
  refusal with no data change, and sites **separating** would lose each other's
  refusals unless they are copied. A change copies them, both ways, before it takes
  effect.
- **Permissive facts are written narrowly and never widened** — a grant records the
  group as disclosed when it was given, and `visibleTo` is stamped at capture. A change
  never copies, re-keys or revokes a grant and never widens visibility.

## Where everything lives

| Piece | File |
| --- | --- |
| Declaration model, disclosure text, readers | `libs/aglyn/src/lib/app-utils/consent-groups.ts` |
| Planner — types, validation, `planConsentGroupChange`, id minting, constants (pure) | `libs/aglyn/src/lib/app-utils/consent-group-change.ts` |
| Participant seam | `libs/aglyn/src/lib/plugin-manager/plugin-consent-group-change.ts` |
| Executor — preview, start, advance, cancel, status, cron sweep | `libs/tenant/data/admin/src/lib/server/consent-group-change.ts` |
| Carries C1–C3 (site suppressions, topic opt-outs, pace) | `libs/tenant/data/admin/src/lib/server/consent-group-carry.ts` |
| CRM participant — C4 and the facet moves | `libs/plugins/crm/src/lib/server/consent-group-participant.ts` |
| Route — `POST /api/orgs/consent-groups` | `apps/console/app/api/orgs/consent-groups/route.ts` |
| Cron backstop | `apps/console/app/api/admin/consent-group-changes/route.ts` |
| Console editor | `libs/plugins/email/src/lib/components/consent-groups-card.tsx`, `consent-group-dialog.tsx`, `consent-group-change-progress.tsx`, `site-consent-group-card.tsx` |
| The editor's copy of the wire contract | `libs/plugins/email/src/lib/components/consent-groups-api.ts` |
| User docs | `apps/docs/docs/marketing-and-automation/email-campaigns/overview.md#consent-groups` |

## Inventory: what a change has to look after

### Restrictive facts — carried when sites separate

| # | Fact | Stored at | Carry |
| --- | --- | --- | --- |
| R1 | Site suppression rows (unsubscribe, manual, bounce, complaint, erasure) | `hosts/{h}/suppressions/{personKey}` | **C1** — create the row on the other site when it has none, keeping `reason`, `email`, dates, `note`, `campaignId`, `topicId`, plus `carriedFromHostId`, `carriedByChangeId`, `carriedAt`. Never overwrites a row the site already has. Because `reason` is kept, only unsubscribe rows stay liftable, and a group-wide resubscribe lifts a carried row like an original. |
| R2 | Live topic opt-outs | `hosts/{h}/topicOptOuts/{key}.topics.{t}` | **C2** — where the other site's state for the topic is not `opted-out`, set `optedOutAt` from the source, `resubscribedAt: null`, `carriedFromHostId`. |
| R3 | Pace (cadence) | `hosts/{h}/emailFrequency/{key}` | **C3** — the most recent choice wins (`cadenceSetAtMs`), `lastSentAtMs` takes the max, `cadenceCarriedFromHostId` records it. `sentAtMs` / `firstSentAtMs` are never touched. |
| R4 | Per-site marketing refusal on a contact | `orgs/{o}/contacts/{id}.marketingConsentByHost.{h}` with `marketingConsent === false` | **C4** (CRM participant) — a dotted-path write of the refusal onto the other site, with `carriedFromHostId`, `carriedByChangeId` and the entry it replaced as `supersededEntry`. |
| R5 | Pending confirmation (double opt-in) | `topics.{t}.pendingAt` without `confirmedAt` | **Not carried.** The confirm link confirms only the site that asked; the preview counts the holds that end. |
| R6 | Unscoped refusal `contacts.marketingConsent === false` | contact top level | Unaffected — it already stands against every site. |

Carries run for every pair `(a, b)` that is together before and apart after, **in both
directions**: the site that leaves keeps the refusals it honored as part of the group,
and the sites that stay keep the leaver's. Leads, list members and site members carry
grants only, so R4 applies to contacts alone.

### Permissive facts — never widened

| # | Fact | Rule |
| --- | --- | --- |
| P1 | Grant entries `marketingConsentByHost.{h}` stamped with `consentGroupId` / `consentGroupName` | Never copied, re-keyed or rewritten; the stamps are evidence and keep the old name after a rename. A site that leaves keeps its entries. A grant covers the group only when the capture showed the group's disclosure (`consentGroupDisclosureKey`); otherwise it is recorded for the capturing site alone. |
| P2 | Grandfathering by capture under a `forward` policy | Computed against the current group; the preview warns when a site joins under `forward`. |
| P3 | `visibleTo` on contacts, leads, companies, deals, tasks, activities | Stamped at capture, never widened; unchanged when a site leaves. |
| P4 | Disclosure text and the preference page's sender | Rendered live from the declaration. |

### Records keyed by the group — re-homed

| # | Record | Rule |
| --- | --- | --- |
| B1 | Contact facet `facets.{groupId}` — profile, owner, stage, tags, notes, campaign ids, lead source, company link, custom values, order figures, engagement stamp, media, timeline | **MOVE** when every site of a key maps to one new key: fold into the target (existing target first; for a new group, capture order) and delete the source in the same write, so figures sum once. **SPLIT** otherwise: each successor whose sites captured the person gets a copy without figures and with its own timeline entries; figures go to a successor only when every capturing site maps to it, otherwise they stay with the old key, or are dropped and counted when it dies. |
| B2 | Company mirror `companyIds` and `companies.contactsCount` | Recomputed in the same write. |
| B3 | Timeline entries' `hostId` | Split copies keep only their own sites' entries. |

Everything else resolves the group per request or per send and is correct the moment
the declaration flips. Platform suppressions, the outreach do-not-contact list, send
counters, campaigns, form submissions, lists and the topic catalog are unaffected.

## A change, step by step

The org marker `consentGroupsChange: { changeId, phase, hostIds, startedAtMs,
declaredAtMs? }` is authoritative. The job document
`orgs/{orgId}/consentGroupChanges/{changeId}` holds the raw before and after, the plan,
the change lines, per-step cursors and counts, the lease, failures and the last error.

1. **Start** (one org-document transaction): the stored raw declaration equals the
   `expected` the editor sent, and no marker exists. Set the marker at `phase: 'carry'`,
   create the job, log "Started a consent group change". A rename-only change skips to
   step 4.
2. **Carry**: C1–C3 for every `(a ← b)`, then every participant's `carry` (C4).
3. **Pre-flip catch-up**: C1–C3 again for rows written since the carry began (by
   `suppressedAt`, `updatedAt`, `cadenceSetAtMs`, from five minutes before), and C4 in
   full.
4. **Declare** (transaction): marker matches, phase is `carry`, stored raw equals the
   job's `before`. `update()` the org with the new `consentGroups` and the marker at
   `phase: 'rehome'` with `declaredAtMs`. One activity line per change line.
5. **Post-flip catch-up**: step 3 again.
6. **Re-home**: participants' `rehome` — the facet moves. They run after the flip on
   purpose: every facet writer keys by the current declaration, so new writes land on
   the final key and the move folds the old key in.
7. **Sweep**, once `now ≥ declaredAtMs + 6 min`: a full idempotent re-run of C1–C4
   (this catches rows a client wrote without `suppressedAt`) and participants' `sweep`,
   the straggler pass.
8. **Done** (transaction): delete the marker, finalize the job, log "Finished a consent
   group change".

Only one change runs per org, sweep included; the route answers `409` with the running
`changeId` to a second one, and the console says "Finishing the last change". A change
can be canceled only in `carry`, which deletes the marker and leaves carried rows in
place — a carried refusal never lets anybody be mailed who could not be before.

While the marker is in `rehome` or `sweep`, a list built from a rule that reads facets
of a site named in `marker.hostIds` returns incomplete and removes nobody.

## Who drives it

- **The console.** While the Consent groups card is open for a member who may change
  groups, `ConsentGroupChangeProgress` listens to the job document and posts `continue`
  whenever no runner holds the lease (a 50 s budget per call, at least 3 s apart, and not
  before the sweep may run).
- **The cron**, every 15 minutes: `/api/admin/consent-group-changes` (240 s budget),
  guarded by `isCronAuthorized` / `isCronDryRun`, dispatched with the other fast console
  crons and listed in the health report's scheduled jobs. It queries orgs whose marker
  is in a running phase.

Closing the page never strands a change; it only slows it to the cron's pace.

## When a change stalls

- A unit that throws releases the lease, increments `failures`, records a sanitized
  `lastError` and retries from its cursor on the next call.
- After **5 consecutive failures** the job is `stalled: true`, one activity line says so,
  and the card shows the error with **Retry now**. The cron keeps trying.
- **Before the flip** the old declaration is still in force, so a stall costs nothing
  but time. Cancel is available.
- **After the flip** the new declaration is in force and records may be half moved.
  Fix the cause (read `lastError` and the cursors on the job document, then the function
  logs), deploy, and press **Retry now** or wait for the cron. The job resumes from its
  cursor; every step is idempotent.

⛔ Never edit `consentGroups` by hand — that skips the carries and loses refusals, which
is the one thing this machinery exists to prevent. Never delete the marker by hand after
the flip — the facet moves and the sweep only run from the executor, so the CRM would be
left split across keys. Deleting it before the flip is what cancel does; use cancel.

## Adding a participant

A plugin that stores data keyed by group, or a restrictive fact read across the group,
registers a participant from its server declarations (lazily, as the CRM does in
`registerCrmServerDeclarations`):

```ts
registerPluginConsentGroupParticipant(
  {
    preview({ orgId, plan }) { /* → [{ id, text, count, severity }] */ },
    run({ orgId, changeId, plan, phase, cursor, deadlineMs, dryRun }) {
      /* → { done, cursor, counts } */
    },
  },
  { pluginId: '<bundle id>' },
)
```

- **`preview` writes nothing** and counts with aggregations. Its lines are printed in the
  review as written, so write them for an admin, in American English, with no brand
  name; namespace the ids (`crm.combine`). The editor folds the CRM's six line ids into
  its own sentences and prints every other line as-is.
- **`run` is idempotent and resumable**: a second pass writes nothing, a cursor resumes
  where the last call stopped, and the call returns before `deadlineMs`.
- **Put each write in the right phase.** Restrictive facts in `carry` (before the flip),
  records keyed by group in `rehome` (after it), and a full re-run plus stragglers in
  `sweep`.
- **Throw rather than skip.** Unlike person erasure, participants are not isolated: a
  throw stalls the change, because a skipped carry is a lost refusal.
- A new store read across the group must be carried. The guard spec
  `consent-group-carry-coverage.spec.ts` fails when a file that reads a group's opt-out
  hosts reads a subcollection outside the carried set.

## Invariants and where they are pinned

| | Invariant | Pinned by |
| --- | --- | --- |
| I1 | A carry for every co-member pair that separates; none for a pair still together | planner spec (property) |
| I4 | The flip never happens before every carry and catch-up step is done | executor spec |
| I5 | A second run of any step writes nothing; a cursor resumes | carry and participant specs |
| I6 | Every key whose sites all map to one new key produces exactly one MOVE; no flow targets a solo key of a site grouped after the change | planner spec |
| I7 | Of concurrent starts, exactly one wins | emulator spec |
| I8 | Every store read across a group is carried; `consentGroups` is written only by the declare step | `consent-group-carry-coverage.spec.ts` |
| I9 | A site in a group, or in a running change, cannot be deleted (`/api/hosts/delete` answers `409`) | emulator and route specs |
| I10 | A member scoped to some sites of a group lists the CRM with only those sites' tokens | `use-crm-scope` spec |
| I11 | Removing a site from a group leaves every refusal honored on both sides, and the site holds its own copy of the CRM record | `apps/console/specs/consent-group-change.emulator.spec.ts` |

And throughout: grants are never widened, visibility is never widened, and nothing
changes for an organization that declares no group.

## The console

- **Emails → Consent groups** at the organization level: the editor
  (`ConsentGroupsCard`) and, under it, the switch that makes a group's sites wait for
  each other's confirmation (`ConsentGroupConfirmationCard`). Both need `org.settings`
  and `data.manage` (`useConsentGroupAccess`). A site's own section shows
  `SiteConsentGroupCard`, read-only.
- The dialog posts the complete next declaration with the raw one it was opened
  against. A `409` with `current` means somebody else changed it; the dialog reloads and
  asks again. The review's sentences come from `consent-group-review.ts`, with every
  number taken from the preview.
- The editor's request and response types in `consent-groups-api.ts` are a copy of the
  route's contract. Change both together.
