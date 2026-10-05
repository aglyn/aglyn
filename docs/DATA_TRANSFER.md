# Data transfer

How Aglyn imports and exports: one pure core every surface plugs into. The
survey of what exists, the product design and the build plan are in
[`docs/specs/import-export-framework.md`](specs/import-export-framework.md);
this document is the architecture.

## The layers

| layer | where | issue |
| -- | -- | -- |
| Core: types and pure functions | `libs/aglyn/src/lib/data-transfer/` | AGL-3522 |
| Extension point: a plugin declares what it can move | `libs/aglyn/src/lib/plugin-manager/plugin-transfer-resources.ts` | AGL-3523 |
| Job engine: upload, analyze, plan, apply, status, undo | `libs/tenant/data/admin/src/lib/server/transfer-jobs.ts`; routes `apps/console/app/api/transfer/*`; the API's types in the core's `transfer-api.ts` | AGL-3524 |
| Field-selectable export route | `apps/console/app/api/transfer/export` | AGL-3525 |
| UI kit: export dialog, import wizard | `libs/aglyn-transfer-ui` | AGL-3526 |
| Console client and the core launcher plugins open the kit through | `apps/console/utils/transfer-http-client.ts`; `libs/aglyn/src/lib/app-utils/transfer-launcher-context.ts`; the shell's `transfer-launcher-provider.component.tsx` | AGL-3539 |
| Each resource | the owning plugin's `src/lib/transfer/` | AGL-3527–3535 |

The core knows nothing of any plugin. It holds no vendor's header names, no
plugin's collection, and no plugin's vocabulary; `check:plugin-domain-in-core`
holds that. A plugin brings its fields, its match keys, its alias
dictionaries (including other products' export headers) and its locked
rules, and the core does the rest the same way for every resource.

## Importing the core

```ts
import { matchHeaders, buildTransferPlan } from '@aglyn/aglyn/data-transfer'
```

`@aglyn/aglyn/data-transfer` is the module, and its only door: it is not
re-exported by `@aglyn/aglyn` or `@aglyn/aglyn/server`, so a screen that never
imports or exports pays nothing for it (`check:aglyn-barrel`). It has no Node
builtin and no React, so the browser wizard and the server job run the same
code. Content hashing
uses WebCrypto (`globalThis.crypto.subtle`), which both provide.

## The modules

### `resource.ts` — what can move, and its fields

`TransferResourceDescriptor` is a plugin's declaration: `key`, `label`,
`scope` (`org` or `host`), `kinds` (`records`, `package`), `formats` (`csv`,
`json`, `ndjson`) and `limits`. `transferResourceProblems` checks one at
registration so a malformed declaration fails at startup.

`TransferField` is one field: `id`, `label`, `group`, a `type` (`text`,
`longText`, `email`, `phone`, `url`, `number`, `integer`, `currency`,
`percent`, `boolean`, `date`, `datetime`, `picklist`, `multiPicklist`,
`tags`, `address`, `lookup`, `json`) and flags — `required`, `readOnly`,
`derived`, `system`, `custom`, `matchKey` — plus `aliases`, `picklistId`,
`lookup` and `maxLength`. The type decides how a cell is read, how a header
is guessed and which policies apply. Read-only, derived and system fields
export but are never written; a `matchKey` field (the Aglyn ID, `id`) may be
mapped on import to find a record, and is never written either.

### `field-catalog.ts` — every field, grouped

`buildTransferFieldCatalog({ standard, custom, derived, system, groups })`
returns every field in picker order, adding the Aglyn ID when absent. A
custom field's id is `custom:<key>`, the same target `csv-import.ts` uses.
`resolveTransferPreset` computes `everything`, `reimportable` (the export
default: the id and match keys first, then every writable field) and
`minimal`, or resolves a saved preset and reports the field ids that no
longer exist. `groupTransferFields`, `searchTransferFields` and
`moveTransferField` back the picker.

### `header-match.ts` — which field each column means

`matchHeaders(headers, fields, { dictionaries, samples, threshold })`
proposes one field per column with a `confidence` (0–1) and a `reason`:
`exactAlias` (1), `normalizedAlias` (0.95), `fuzzy` (token-set and
Damerau–Levenshtein similarity, at most 0.9, at least `threshold` = 0.72) or
`typeInference` (0.55, from what the sample cells look like, for a column
whose header says nothing). Sample cells also break near ties between fuzzy
candidates. Every field goes to one column; `conflicts` lists columns that
wanted the same field, and `unmappedRequired` the required fields no column
took. A plugin's `TransferAliasDictionary` names its `source`, and a match
from it carries that source to the badge. `mappingProblems` judges the
mapping the person leaves before it can be used.

### `derive.ts` — reading a cell, and saying how

Each parser returns a `DerivedValue`: the value, whether the cell was
blank, and a list of `Derivation` records — what changed and why (`Read as
day/month/year`, `Read "," as the decimal point`) — or a `problem` when the
cell is unreadable and dropped. A `flagged` derivation is a guess that could
be wrong; it has to be acknowledged.

- Dates: ISO, year-first, all-number with the order fixed by the person or
  read from a day above twelve (`ambiguousDate`, flagged, when either order
  fits), month names, two-digit years (flagged), spreadsheet serial days
  (flagged). Date-times: zoned ISO exact; a time without a zone read in the
  chosen offset (flagged); Unix seconds and milliseconds (flagged).
- Numbers: thousands separators, decimal commas, apostrophes and spaces,
  parentheses as a minus; a lone `1,234` under `auto` is flagged. Integers
  refuse a fraction. Currency: a symbol or ISO code on either side, minor
  units per currency, rounding flagged. Percent: `12%`, or a bare fraction
  read as a percent (flagged).
- Booleans: `parseImportFlag` lives here now; `csv-import.ts` re-exports it.
- Phones through the platform's `normalizePhone`; a number it cannot
  normalize is kept as typed (flagged); an extension is dropped (flagged).
- Email (lowercased, display name and `mailto:` removed, checked), URL
  (`https://` added to a bare domain), full-name splitting (with the rule
  used: `lastCommaFirst`, `lastWord`, `surnameParticle`, `singleWord`),
  one-line addresses into the platform's postal address (always flagged),
  and lists split on `,` `;` `|` and line breaks.

`deriveTransferRow(fieldsById, mappedCells)` reads a whole row into
`values` (a mapped blank cell is `null`, so "blank clears" can act on it),
located `derivations` and located `problems`. `mapTransferRow` turns a
line's cells into field id → raw cell under a mapping.

### `picklist-map.ts` — values a picklist does not hold

Built on `app-utils/picklists.ts`. `collectPicklistValues` counts a
column's distinct values (by the engine's label key). `matchPicklistValues`
matches them to the organization's effective list by label or id, noting an
inactive match, and suggests the closest values for the rest. For each
unmatched value the person picks a `PicklistValueChoice`: `mapTo` a value,
`addValue` (with a group, and a meaning on a list that has meanings),
`leaveBlank`, or `refuseRow`. `proposePicklistChoice` pre-fills one;
`picklistChoiceProblems` says what still blocks; `resolvePicklistChoices`
mints the added values (never colliding with a standard id) and resolves
every incoming value; `resolvePicklistCell` and `resolveMultiPicklistCell`
apply it to a cell.

### `match.ts` — which record a row is about

A `MatchKeySpec` is a field and a normalizer: `email`, `domain` (from a URL
or an address), `name` (accents, case and punctuation folded), `slug`,
`phone`, `externalId`, `aglynId`, `caseless`, `trim`, `exact`.
`matchLookupRequests` lists the distinct values the plugin's `lookup` must
query; the answer comes back as a `MatchLookup` (or is built from records
with `buildMatchLookup`). `matchRows` returns one `RowMatchOutcome` per row:
`new`, `matched` (by the first key that found anything, with `alsoMatched`
when a lower key points elsewhere), `ambiguous`, or `duplicateInFile` (any
key value an earlier row carried).

### `policy.ts` — what a row does to a record

`TransferRecordPolicy`: `onMatch` (`update`, `skip`, `duplicate`), `onNew`
(`create`, `skip`), `onAmbiguous` (`skip`, `ask`). `TransferFieldPolicy`:
`mode` (`overwrite`, `fillBlanks`, `keepExisting`, `append` for lists) and
`blank` (`leave`, `clear`). Defaults: update, create, ask; fill blanks and
leave — nothing existing is replaced or cleared unless the person chooses
it. `TransferLockedRule` is a plugin's rule on a field with a reason, a
forced policy, or `refuseValues` for a field a file may never set.
`resolveFieldPolicy` answers row R, field F in this order: locked rule, row
override, field choice, type default (lists append), overall default.
`applyFieldPolicy` computes one field's outcome.

### `plan.ts` — the dry run

`buildTransferPlan({ fields, rows, matches, existing, policy, limits })`
gives every row a verdict — `create`, `update`, `unchanged`, `skip`, `fail` —
with a reason, the field diff (before → after, mode, where the policy came
from), the fields a locked rule held back, and its warnings. Warnings are
typed, counted, and sampled: `derivation`, `ambiguousDate`,
`unmatchedPicklist`, `newPicklistValue`, `unresolvedLookup`,
`ambiguousMatch`, `duplicateInFile`, `lockedRule`, `droppedCell`,
`overwriteNonBlank`, `clearValue`, `planLimit`. Every class but a plain
`derivation` must be acknowledged; a `derivation` class holding a flagged
guess must be too. `missingAcknowledgements` and `canApplyTransferPlan` gate
Apply. Earlier wizard steps (picklists, lookups) pass what they decided as
row `notes`; a note with `refuse` fails the row.

### `job.ts` — jobs, chunks, the ledger and undo

The state machine is `draft → analyzed → planned → applying → applied →
undone`, with `failed` resumable into `applying` or back to planning
(`TRANSFER_JOB_TRANSITIONS`, `transitionTransferJob`). Constants:
`TRANSFER_CHUNK_ROWS` = 200, `TRANSFER_BATCH_WRITES_MAX` = 500,
`TRANSFER_WRITE_CONCURRENCY` = 8, `TRANSFER_UNDO_WINDOW_MS` = seven days.
`transferLedgerKey(jobId, row)` is `<jobId>:<row>`, the idempotency key the
engine records before acknowledging a row's write. `TransferUndoEntry`
keeps an update's previous values and the values written, and a create's
id; `planTransferUndo` restores, deletes, or reports a conflict for a record
edited since the import.

### `package.ts` — site items as one file

`PackageManifest` is `{ format: 'aglyn-package', version: 2, items }`, each
item `{ kind, $id, slug?, name?, contentHash, deps }`. `contentHash` is
`sha256:` + the hex digest of `stableJson` (keys sorted at every depth).
`readPackageManifest` validates untrusted JSON and reports every problem.
`packageDependencyOrder` orders dependencies first and reports missing
dependencies and cycles; `packageDependencyClosure` is "include
dependencies". `matchPackageItems` matches by id, then slug, then name, and
says `new`, `identical`, `differs` or `missingDependency`;
`proposePackageDecision`, `packageDecisionsFor` and `keepBothSlug` back the
replace / keep both / skip / merge choice.

### `source.ts` — the uploaded file as rows

`readTransferSource(text, format, options?)` reads a file into
`{ headers, rows }` the same way in the browser and on the server: CSV per
RFC 4180 with the delimiter detected from the header line (comma, semicolon
or tab) unless `options.delimiter` names one (a pipe too), `options.headerRow:
false` reading the first line as a row under "Column 1", "Column 2"…, a
byte-order mark dropped and blank lines skipped; JSON as an array of
objects (or `{ rows: [...] }`) and NDJSON one object per line, the header
being every key in first-seen order and nested values kept. A file it cannot
read answers a `TransferSourceProblem`. `transferFormatFromFileName`,
`sniffTransferFormat` and `transferContentType` name the format.

### `transfer-api.ts` — the job engine's API

The route paths (`TRANSFER_API_ROUTES`), the limits (3 MB a part, 24 MB a
file, 50,000 rows unless the resource says otherwise), the stored job
(`TransferJobRecord`), and every request and response the routes speak — see
[The job engine](#the-job-engine). It is the one definition of every shape
that crosses the wire, the kit's included: the person's
`TransferReadChoices` (mapping, date orders, picklist and lookup choices,
match keys), `TransferResourceInfo` and `TransferPrefs`, the review shapes
(`TransferDerivationSummary`, `TransferMatchReview`, `TransferConflict`,
`TransferAmbiguity`, `TransferLookupReview`) and the undo conflict.

### `review.ts` — what the wizard shows about a whole file

`summarizeTransferDerivations` counts each mapped field's derivations and
problems with a few examples and the dates that read either way;
`transferMatchReview` counts every match outcome and lists at most 100 rows
of each; `transferPlanConflicts` names, per matched row, each field whose
non-blank file value differs from a non-blank record value, with what the
policy makes of it; `transferAmbiguities`, `transferPlanSample` (50 rows of
each verdict), `transferDateOrderOptions` (a person's date order per field,
as `deriveTransferRow`'s per-field options) and `transferRowLabel`. The job
engine and the kit's in-memory client both answer from them.

## How the rest plugs in

**AGL-3523, the extension point** (`plugin-manager/plugin-transfer-resources.ts`).
A plugin declares `transferResources: [TransferResourceDescriptor]` in
`plugins.config.json`, which the generator checks and compiles into
`PLUGIN_TRANSFER_RESOURCES_DECLARED`, and lists `transferResources`
(`TRANSFER_RESOURCES_LOAD_POINT`) among its `console.slots`. From
`serverDeclarations` or `consoleServerDeclarations` it registers the server
half with `registerPluginTransferResource(key, impl)`: `fields(ctx)` returning
`TransferCatalogInput`, `matchKeys` (`MatchKeySpec[]`), `aliases`
(`TransferAliasDictionary[]`), `readPage(ctx, cursor, fieldIds, options)`,
`lookup(ctx, requests)` returning the `MatchLookup` and the found records'
current values, optional `plan`, `lockedRules` and `invariants`,
`apply(ctx, chunk, writer)` through the plugin's own write paths, and
`revert(ctx, snapshot, decisions)`; a package kind registers `items`,
`dependencies`, `remapIds`, `readItems` and `writeItems`. Registration runs
`transferResourceProblems` and refuses a kind whose hooks are missing. From
its console registrar it registers the client half with
`registerPluginTransferResourceUi(key, { label, icon, extraSteps })`.
`resolveTransferResource(key)` joins a declaration to its server half and
throws `TransferResourceUnavailableError` for one declared and never
registered; `listTransferResourcesFor` lists what a workspace or site can move
under its plugin enablement and release flags.

**AGL-3524, the job engine.** See [The job engine](#the-job-engine) below.

**AGL-3526, the UI kit.** Built; see [The UI kit](#the-ui-kit) below.

**AGL-3539, the console client and the launcher.** See
[Opening the kit](#opening-the-kit) below.

## The job engine

`@aglyn/tenant-data-admin/server/transfer-jobs` runs an import as a durable
job; the seven console routes are wiring over it, behind one gate
(`apps/console/utils/server/transfer-gate.ts`): `POST`, a verified Bearer ID
token, a per-member rate limit per route (`rate-limit-store`), the
workspace's lockdown verdict (`status` and `fields` ask with a read intent), and
`data.manage` — on the job's site for a site's records, on the workspace
otherwise. Plan, apply and undo write an `adminAudit` row
(`data.transfer.plan`, `data.transfer.apply` when a job starts or resumes,
`data.transfer.undo`).

### What is stored where

| path | what |
| -- | -- |
| `orgs/{orgId}/transferJobs/{jobId}` | the job, a `TransferJobRecord` (the core's `TransferJob` plus the upload state, the choices the plan was built from, warnings, the cursor, result counts, the lease and the undo state) |
| `…/chunks/{n}` | the dry run, 200 planned rows a chunk, as JSON (split into `pieces/{k}` past 900,000 characters) |
| `…/ledger/{jobId}:{row}` | one row's write, created the moment it lands; cleared once its chunk commits |
| `…/results/{n}` | a written chunk's `TransferRowResult`s |
| `…/undo/{n}` | a written chunk's `TransferUndoEntry`s, as JSON |
| Storage `orgs/{orgId}/transfers/{jobId}/source` | the file, after `inspectUploadBytes` (each part under `parts/{n}` until the last lands) |

Every document is written by the Admin SDK only. The rules let an org-wide
member read the job document (the wizard's progress panel listens to it)
when their role writes data and `data.manage` is not revoked, or when a
custom role stamps it; nobody writes. The subcollections match no rule, so
no client reads them — the routes serve the plan, the results and undo. Storage under `orgs/{orgId}/transfers/` is closed to clients. The
indexes are `transferJobs (resource ↑, createdAt ↓)` for a workspace's
list and the collection-group `(status ↑, updatedAt ↑)` the sweep asks.

### The routes

The request and response types are the core's (`transfer-api.ts`), so the
UI kit's client and the routes cannot disagree. Every refusal is a
`TransferErrorResponse` (`{ error, code, details? }`).

| route | does | request → response |
| -- | -- | -- |
| `fields` | what a resource offers: its descriptor, every field and group, its match keys (each a default, in order, and the presets' match-key hint), its locked rules and aliases, and the person's `TransferPrefs`. | `TransferFieldsRequest` → `TransferFieldsResponse` |
| `upload` | stores a file whole, or one part of at most 3 MB (`part`, `parts`, then `jobId`), with the CSV `delimiter` and `headerRow` the person confirmed on the first part (kept as the job's `read`); inspects each part and the whole; refuses a format the resource does not take (415), more than 24 MB or the resource's `maxBytes` (413), more rows than its `maxRows` (default 50,000; 413). Makes the job, `draft`. | `TransferUploadRequest` → `TransferUploadResponse` |
| `analyze` | header proposal (`matchHeaders` with the resource's aliases), 20 sample rows, the catalog, match keys, locked rules, and each mapped picklist column's values against the workspace's list (`picklists` hook) with a proposed choice per unmatched value. `mapping` re-reads the values under the person's mapping and adds every mapped field's `derivations` over the whole file, the rows `matches` against existing records under `matchKeys` (each key, by default) and `recordLabels`; `dateOrders` reads a field's dates in the order the person chose. → `analyzed`. | `TransferAnalyzeRequest` → `TransferAnalyzeResponse` |
| `plan` | refuses a mapping `mappingProblems` blocks and any unmatched picklist value without a choice (`choicesNeeded`, by field); reads every row, resolves picklists into row notes, looks matches up in slices of 500 values, runs `matchRows` over the whole file (so an in-file duplicate is caught across chunks) and the resource's plan, fails the rows an invariant refuses, and stores the chunks. Writes no record. → `planned`. Answers the summary, the warnings, 50 rows of each verdict (`sample`), the first 500 `conflicts` (and `conflictCount`), the `ambiguous` rows and `recordLabels`; keeps `dateOrders` and the plugin steps' `extras` on the job. `action: 'rows'` pages the stored plan, by verdict. | `TransferPlanRequest` → `TransferPlanResponse`; `TransferPlanRowsRequest` → `TransferPlanRowsResponse` |
| `apply` | the first call needs `canApplyTransferPlan` (`acknowledgementsMissing` lists the rest); refuses while another job of the same resource is `applying` or another driver holds this one's lease (`busy`). Adds the chosen picklist values (`addPicklistValues`), then writes chunks for 45 seconds and answers the progress and the `results` of the chunks it wrote; called until `done`. A plugin `apply` that throws fails the job naming the chunk; calling again resumes it. | `TransferApplyRequest` → `TransferApplyResponse` |
| `status` | the job, `TransferProgress`, and whether undo is open; `include: 'results'` adds every written row's result; `download: 'results'` answers the result file (the file's own columns, then `Outcome`, `Reason`, `Record ID`) as CSV with `X-Aglyn-Export-Rows`. | `TransferStatusRequest` → `TransferStatusResponse` or `text/csv` |
| `undo` | for seven days after `applied`. `action: 'plan'` reads every touched record through `lookup` by id and runs `planTransferUndo`: counts of restore, delete, conflict and nothing, and the conflicts (what the record holds now, what undo would restore), paged; writes nothing. `action: 'apply'` reverts chunk by chunk through `revert`, each record with the person's `decisions[recordId]` or `otherwise`; called until `done`, then `undone`. | `TransferUndoPlanRequest` → `TransferUndoPlanResponse`; `TransferUndoApplyRequest` → `TransferUndoApplyResponse` |

### Applying never writes a row twice

The plugin's `apply` gets a `TransferApplyWriter` backed by the ledger:
`alreadyApplied(row)` answers from the chunk's ledger entries and
`markApplied(result, undo)` creates the row's entry (`transferLedgerKey`)
the moment its write lands. A chunk is complete when every planned write
has an entry; then its results, its undo entries and the job's cursor and
counts commit in one batch, and only then are its ledger entries deleted. A
row the plugin answered for without marking is marked by the engine. The
engine's own deletes and chunk writes run eight at a time.

One driver at a time: each `apply` or undo request takes a lease on the job
for its budget plus 30 seconds and releases it when it answers.

### The sweep

`/api/admin/transfer-jobs` (cron secret; on the fifteen-minute
`consoleFastCrons` tick; `transfer-jobs` in `SCHEDULED_JOBS`) resumes every
`applying` job untouched for two minutes — a tab that closed between
requests, or a request that died and whose lease has lapsed — through the
same engine. A GET lists them and resumes nothing.

## The UI kit

`libs/aglyn-transfer-ui` (`@aglyn/aglyn-transfer-ui`, `scope:core`
`type:ui`) renders the core's outputs and never fetches: a surface hands it
a `TransferClient`. It imports the core only from
`@aglyn/aglyn/data-transfer`.

### The client every server implements

`transfer-client.ts` is the kit's port: the console's HTTP client
implements it over `api/transfer/*` and `createMemoryTransferClient` in
memory (the specs and stories run on it). Every shape that crosses the wire
is the core's and is re-exported from here; what the kit defines itself is
the client's side — requests without the organization (a client is bound to
one), the file as the browser read it, and the views a step renders,
composed of the core's shapes.

| method | takes | returns |
| -- | -- | -- |
| `fields` | `{ resource }` | `TransferResourceInfo`: the descriptor, every field in catalog order, the groups, the match keys (and default keys), preset hints, locked rules, alias dictionaries, the person's `TransferPrefs`, whether a custom field may be created |
| `upload` | `TransferFileUpload`: resource, file name, decoded text, bytes, the confirmed `TransferFileSettings` (format, encoding, delimiter, header row) | the new `draft` `TransferJob` |
| `analyze` | `TransferAnalysisRequest`: `{ jobId }`, optionally the `TransferReadChoices` | `TransferAnalysis`: headers, sample rows, `HeaderMatchResult`, the `TransferPicklistAnalysis`es; with a mapping, per-field `TransferDerivationSummary`, `TransferLookupReview`s, a `TransferMatchReview` and record labels |
| `plan` | `TransferDryRunRequest`: the read choices, the `TransferPolicy`, plugin step `extras` | `TransferDryRun`: the `TransferPlan` (its rows every row, or 50 of each verdict when `rowsComplete` is false), the `TransferConflict`s and `conflictCount`, the `TransferAmbiguity`s, record labels |
| `apply` | `{ jobId, acknowledged }` | `TransferApplyStep` (`results` of the chunks written, `rowsDone`, `rowCount`, `done`); refuses while `canApplyTransferPlan` does not hold |
| `status` | `{ jobId }` | the `TransferJob` |
| `results` | `{ jobId }` | every `TransferRowResult` and the summary |
| `undo` | `{ jobId, mode: 'preview' }` or `{ jobId, mode: 'apply', decisions, otherwise? }` | `counts` (restore, delete, conflict, nothing), every `TransferUndoConflict` (a record edited since: what it holds now, what undo would put back), and `done`; a decision is `keep` or `revert`, and `otherwise` (default `keep`) covers a record edited after the preview. The results step calls `apply` until `done`. |
| `export` | `TransferExportChoice`: field ids in order, scope (`selection` ids, `filter` value, `all`), format, byte-order mark | `{ fileName, rowCount, body: Blob }` |
| `savePrefs` | `{ resource, prefs }` (last export choice, saved presets) | the stored `TransferPrefs` |
| `createCustomField?` | `{ resource, label, type }` | the new `TransferField` (`custom:<key>`) |

### What it renders

- `TransferExportDialog`: presets (Re-importable by default, Everything,
  Minimal, saved, "save these fields as"), the grouped and searchable
  `TransferFieldPicker` with select all or none and up/down reordering,
  scope, format and byte-order mark; the choice is saved through
  `savePrefs`.
- `TransferImportWizard`, eight steps on a stepper of buttons (a passed
  step reopens until writing starts); every step lists what blocks Next
  beside it:
  1. Upload: file or paste, read in the browser (`transfer-file.ts` guesses
     format, encoding, separator and header row; each is changeable), a
     preview, and the byte and row limits enforced before upload.
  2. Columns: header, sample values, proposed field with confidence and
     reason (and the dictionary's source), remap or ignore, create a custom
     field; `mappingProblems` blocks. The `importMapping` zone renders below
     through `useConsoleWidgetSlot()` when the host passes
     `importMappingZone`, with each column's shape from `inferCellType`.
  3. Values: picklist values the list lacks (map, add with group and
     meaning, leave blank, refuse rows; proposals pre-filled by
     `proposePicklistChoice`), per-field derivation counts with samples and
     flagged guesses, the date order for dates that read either way, and
     unresolved lookups (create, use a similar record, leave blank, refuse).
  4. Matching: ordered match keys and the new / matched / ambiguous /
     repeated counts with the rows of each.
  5. Conflicts: record defaults, the per-field mode and blank policy with
     locked rules disabled and their reasons, the conflict list with a
     per-row action and per-field override, and a record chosen for each
     ambiguous row. Every change re-plans.
  6. Review: summary counts, `TransferDiffTable` filtered by verdict, and
     `TransferAcknowledgementList` — one "I understand" per class, Import
     enabled only by `canApplyTransferPlan`. A class whose count changes on
     a re-plan is asked again.
  7. Import: the browser drives `apply` chunk by chunk; pause stops after
     the chunk in flight, resume continues from the job's cursor; failed
     rows stream in.
  8. Results: counts, a per-row result CSV, Undo while
     `transferUndoAvailable`, with the edited-since prompt per record.
- The draft of every choice (`TransferWizardDraft`) is saved per job through
  a `TransferWizardStorage` (local storage by default), so a reload with
  the job id resumes on the same step.
- Plugin steps: `registerTransferWizardStep(resource, step)` or the
  `extraSteps` prop place a step after any step before Review; its answer
  rides in `extras`.
- Shared pieces for the package wizard (AGL-3534): `TransferDiffTable`,
  `TransferAcknowledgementList`, `TransferChoiceSelect`, `TransferWizardNav`.

The plugin guide is
[`apps/docs/docs/developers/plugins/guides/import-and-export.md`](../apps/docs/docs/developers/plugins/guides/import-and-export.md).

## Opening the kit

The kit is private and console-only; a published plugin never depends on
it. A plugin opens the wizard and the dialog through the core launcher
instead (`app-utils/transfer-launcher-context.ts`, in the `@aglyn/aglyn`
barrel and at `@aglyn/aglyn/app-utils/transfer-launcher-context`):

```tsx
const transfer = useTransferLauncher()
// null outside the console shell: hide Import and Export.
transfer?.openImport({ resource: 'crm.contacts', scope: 'host', hostId, mappingZone: 'contacts', onFinished })
transfer?.openExport({ resource: 'crm.contacts', scope: 'host', hostId, selection, filter: { label, value } })
```

The console shell mounts `TransferLauncherProvider` inside the org scope.
It binds to the workspace the URL names (off a workspace nothing opens),
and loads the surface — the kit and the HTTP client — as a separate chunk
the first time something opens. The wizard opens in a dialog (full screen
on a phone) titled with the resource's label from
`registerPluginTransferResourceUi`, whose `extraSteps` it shows when they
come before the review: each step's component is handed
`{ resource, orgId, hostId, jobId, value, setValue, setComplete }`, its
answer rides in the draft's `extras` to the dry run, and Next waits for
`setComplete(true)`.

`createHttpTransferClient({ orgId, hostId, getIdToken })`
(`apps/console/utils/transfer-http-client.ts`) is the kit's client over the
routes. It uploads in parts whose JSON-encoded size stays under 3 MB,
never splitting a character, with the delimiter and header row on the first
part; drops the locked rules from a plan request (the route applies the
resource's own); throws a job that failed while applying, so the wizard
stops and offers Resume; pages every undo conflict into the preview; and
throws every refusal as a `TransferRequestError` with the route's `code`.

