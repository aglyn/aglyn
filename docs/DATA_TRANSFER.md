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
| Field-selectable export route | `apps/console/app/api/transfer/export`; the engine half `libs/tenant/data/admin/src/lib/server/transfer-export.ts`; the file format in the core's `export-file.ts` | AGL-3525 |
| UI kit: export dialog, import wizard | `libs/aglyn-transfer-ui` | AGL-3526 |
| Console client and the core launcher plugins open the kit through | `apps/console/utils/transfer-http-client.ts`; `libs/aglyn/src/lib/app-utils/transfer-launcher-context.ts`; the shell's `transfer-launcher-provider.component.tsx` | AGL-3539 |
| Site packages: a site's items as one file, planned and undone | core `data-transfer/site-package.ts`; routes `apps/console/app/api/hosts/{export,import}` | AGL-3533 |
| Workspace packages: sequences, campaigns, automations, email templates as one file | core `data-transfer/package-plan.ts`; engine `libs/tenant/data/admin/src/lib/server/transfer-packages.ts`; route `apps/console/app/api/transfer/package` | AGL-3535 |
| Email topics as package items | `libs/plugins/email/src/lib/transfer/topics-package*.ts` | AGL-3550 |
| The Import & export hub: every resource, workspace packages, the history | `settings/(sections)/data`; `components/settings/org-data-transfer-card` and `org-transfer-history-card`; route `apps/console/app/api/transfer/jobs` | AGL-3535 |
| Each resource | the owning plugin's `src/lib/transfer/` — datasets: `libs/plugins/data/src/lib/transfer/` (AGL-3530) | AGL-3527–3535 |

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
`json`, `ndjson`), `limits`, and `instances` for a resource moved one
instance at a time (one dataset's records): every key reaching it names the
instance as `<key>:<instance>` (`transferResourceInstanceKey`,
`parseTransferResourceKey`, `transferResourceInstanceOf(ctx)`), so a job, a
person's remembered choices and the one running import are each kept per
instance. `exportOnly` marks a resource that is exported and never imported
(a CRM's logged activities, its pipelines — AGL-3528): its plugin registers
no `apply` or `revert`, the upload refuses it, and `transferResourceImports`
tells a surface whether to offer Import. `transferResourceProblems` checks
one at registration so a malformed declaration fails at startup.

`TransferField` is one field: `id`, `label`, `group`, a `type` (`text`,
`longText`, `email`, `phone`, `url`, `number`, `integer`, `currency`,
`percent`, `boolean`, `date`, `datetime`, `picklist`, `multiPicklist`,
`tags`, `list`, `address`, `lookup`, `json`) and flags — `required`, `readOnly`,
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
default: the id and match keys first — the id once, even when a match key
names it — then every writable field) and
`minimal`, or resolves a saved preset and reports the field ids that no
longer exist. `groupTransferFields`, `searchTransferFields` and
`moveTransferField` back the picker. A `TransferResourcePreset` is a preset a
resource offers itself — a saved preset's shape with a `description` and,
for a layout another product imports, `headers` (that product's column name
per field); `transferExportHeaders` keeps the names a request may use (the
chosen fields only, trimmed, at most 120 characters, never two fields under
one name).

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
  and lists split on `,` `;` `|` and line breaks — `tags` lower-cased, a
  `list` of free items kept as typed.

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
`phone`, `externalId`, `aglynId`, `caseless`, `trim`, `exact`, and `instant`
(a moment to the minute, in UTC, from epoch milliseconds, ISO text or a
`Date`, so a file's text and a record's stored milliseconds meet). A key
with `with` is compound: an event's title AND its start, so a weekly class
is several events. A row carries it only when every part has a value, and
`matchKeyValue` joins the normalized parts (`MATCH_KEY_PART_SEPARATOR`); a
compound key is named by its first field everywhere a key is named.
`matchLookupRequests` lists the distinct values the plugin's `lookup` must
query; the answer comes back as a `MatchLookup` (or is built from records
with `buildMatchLookup`). `matchRows` returns one `RowMatchOutcome` per row:
`new`, `matched` (by the first key that found anything, with `alsoMatched`
when a lower key points elsewhere), `ambiguous`, or `duplicateInFile` (any
key value an earlier row carried).

### `lookup.ts` — a cell that names another record

A `lookup` field's cell names a record of another resource. The job engine
resolves each distinct value (see `analyze` and `plan` below); this module
holds what both sides share. `transferLookupKey` is the key a person's
`TransferLookupChoice` is filed under (the text trimmed and lowercased);
`mayBeTransferRecordId` says whether a cell is worth asking for by id;
`transferLookupNewValue(name)` is what a row carries for a record the person
chose to create (`new:` + the name — no Aglyn id holds a colon) and
`transferLookupNewName` reads it back; `rankTransferLookupSuggestions` orders
candidate records by `textSimilarity` for a resource's `suggest` hook.

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
`applyFieldPolicy` computes one field's outcome, deciding "changed" with the
`equal` it is handed. `TransferPolicyDefaults` is where a resource starts the
person (`transferPolicyDefaultsFor` keeps what holds for a catalog,
`startingTransferPolicy` is the wizard's opening policy,
`withTransferPolicyDefaults` lays a request's choices over it), and
`TransferValuesComparator` / `compareTransferValues` let a resource say two
values are the same as it stores them — see
[A resource's own defaults and matching](#a-resources-own-defaults-and-matching-agl-3548).

### `plan.ts` — the dry run

`buildTransferPlan({ fields, rows, matches, existing, policy, limits })`
gives every row a verdict — `create`, `update`, `unchanged`, `skip`, `fail` —
with a reason, the field diff (before → after, mode, where the policy came
from), the fields a locked rule held back, and its warnings. Warnings are
typed, counted, and sampled: `derivation`, `ambiguousDate`,
`unmatchedPicklist`, `newPicklistValue`, `unresolvedLookup`,
`ambiguousMatch`, `duplicateInFile`, `lockedRule`, `droppedCell`,
`overwriteNonBlank`, `clearValue`, `planLimit`, and `screening` — what a
resource's own `plan` found that only its rules can see (each sample's
`detail` says what; a sample about the whole file, such as a column's name,
has the row `TRANSFER_FILE_SAMPLE_ROW`), and `resourceRule` (below). Every class but a plain
`derivation` must be acknowledged; a `derivation` class holding a flagged
guess must be too. `missingAcknowledgements` and `canApplyTransferPlan` gate
Apply. Earlier wizard steps (picklists, lookups) pass what they decided as
row `notes`; a note with `refuse` fails the row.

`resourceRule` is the owning plugin's own finding about a row that no field
policy can say — a redirect that loops, an off-site destination, a value its
write path refuses. A resource's `plan` hook builds the plan and folds its
findings in with `withTransferResourceFindings(plan, findings)`: each
finding (`{ row, detail, fieldId?, value?, refuse? }`) is a sampled warning
with its sentence, and `refuse` fails a row that would have written (reason
`resourceRule`).

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

### `package-plan.ts` — what importing a workspace package would do

`planTransferPackage({ manifest, ownedKinds, existing, references, decisions,
dependencyChoices, problems, newId })` is the whole dry run of a workspace
package, pure. Items of a kind no enabled package resource owns are set aside
(`unknownKinds`). Every other item is matched (`matchPackageItems`) and
proposed a decision; one that differs waits (`needsChoice`) — replacing is
never assumed. Each item that will write is given its id first — its own,
the matched item's for a replace, `newId()` for keep both (with
`keepBothSlug` and `keepBothName`, "(copy)") — and a skipped matched item
points at the workspace's, so `idMap` rewrites every reference up front.
A dependency neither the package (as written) nor the workspace (`existing`
for owned kinds, `references` for the rest — `site` is
`TRANSFER_SITE_KIND`) satisfies becomes a `TransferPackageReference` with
its choices: `import` (the package's skipped copy), `mapTo` a target,
`dropReference` (`''` in `idMap`; `remapPackageReference` makes it `null`)
or `skipItem` (skipping every item that needs it, transitively). An item
the plugin objects to (`problems`) fails. The verdicts are `create`,
`replace`, `keepBoth`, `skip`, `fail`; `blocking` lists what still needs a
choice; `acknowledgementsRequired` is `replace`, `dropReference`, `failed`
as they occur; `canApplyTransferPackage` gates Apply.
`existingPackageItemsOf` hashes what a resource holds the way an export
hashes it.

### `source.ts` — the uploaded file as rows

`readTransferSource(text, format, options?)` reads a file into
`{ headers, rows }` the same way in the browser and on the server: CSV per
RFC 4180 with the delimiter detected from the header line (comma, semicolon
or tab) unless `options.delimiter` names one (a pipe too), `options.headerRow:
false` reading the first line as a row under "Column 1", "Column 2"…, a
byte-order mark dropped and blank lines skipped, and a cell an export
guarded against running as a spreadsheet formula (`'=…`) read back without
its one `'` (`restoreCsvFormulaCell`); JSON as an array of
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

### `export-file.ts` — the export file

`transferExportCsvHeader` (each field's label, so the file maps straight
back in), `transferExportCsvLine` (given each field's type) and
`transferExportCsvCell`, and `transferExportCellText` (a list as
its items joined by `; `, an object as JSON, a blank as an empty cell),
`transferExportRecord` (JSON and NDJSON rows keyed by field id),
`transferExportFileName` (`<resource>-<day>.<ext>`),
`countTransferExportRows` (what a download holds, per format, for the
shortfall check) and `normalizeTransferPrefs` (a stored or sent
`TransferPrefs`, dropping whatever is not its shape).

**Formula cells (AGL-3548).** Every CSV the platform writes — exports,
result files, CRM sections and reports, the AI usage file, the staff audit
and tax working papers — goes through `escapeCsvCell` in
`app-utils/csv.ts`, which writes a cell opening with `=`, `+`, `-`, `@`, a
tab or a carriage return (after any `'`s) with one more leading `'`, so a
spreadsheet shows it as text. A genuine number is let through when the
writer says the cell is numeric (`{ numeric: true }`): a number value, or a
`number`, `integer`, `currency` or `percent` field whose text reads as a
plain number, so `-5` stays `-5`. JSON and NDJSON are written as they are.
Both CSV readers (`parseTransferCsv`, `parseCsv`) take exactly one `'` off a
cell that opens with `'` and then one of those characters, so an export
imported again is unchanged.

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
`TransferCatalogInput`, `matchKeys` (`MatchKeySpec[]`, or `matchKeys(ctx)`
answering `{ keys, defaults }` when an instance's own fields are its keys —
read through `transferResourceMatchKeys`), `aliases`
(`TransferAliasDictionary[]`), `presets` (`TransferResourcePreset[]`, listed
after the built-in ones; refused under a built-in id, repeated, or empty),
`readPage(ctx, cursor, fieldIds, options)`,
`lookup(ctx, requests)` returning the `MatchLookup` and the found records'
current values, optional `suggest(ctx, { by, values })` (records named like
a lookup column's unresolved values) and `lookupTargets` (lookup targets
the resource answers itself, such as the workspace's members, each with
its own `lookup`, `suggest` and `matchKeys`), optional `plan`,
`lockedRules` and `invariants`, optional `defaultPolicy`, `match` and
`valuesEqual` (see [A resource's own defaults and matching](#a-resources-own-defaults-and-matching-agl-3548)),
`apply(ctx, chunk, writer)` through the plugin's own write paths, and
`revert(ctx, snapshot, decisions)`. Every hook's `ctx` names the
organization, the site, the acting member and the job, and — from the job —
the plugin steps' `extras` (in `plan`, those sent with this dry run;
afterwards, those the plan was made with) and the file's `headers`. A package kind registers `items`,
`dependencies`, `remapIds`, `readItems`, `writeItems` and `revertItems` (and optionally `problems`, `referenceTargets` and `rules`). Registration runs
`transferResourceProblems` and refuses a kind whose hooks are missing. The `fields` hook alone is handed
`ctx.filter`, the list filter an export dialog was opened on, so a resource
whose columns follow the records read (one form's questions) answers for
them. From
its console registrar it registers the client half with
`registerPluginTransferResourceUi(key, { label, icon, extraSteps })`.
`resolveTransferResource(key)` joins a declaration to its server half — for
an instance key, under the whole key with its `instance` — and throws
`TransferResourceUnavailableError` for one declared and never registered; `listTransferResourcesFor` lists what a workspace or site can move
under its plugin enablement and release flags.

**AGL-3524, the job engine.** See [The job engine](#the-job-engine) below.

**AGL-3526, the UI kit.** Built; see [The UI kit](#the-ui-kit) below.

**AGL-3539, the console client and the launcher.** See
[Opening the kit](#opening-the-kit) below.

## A plugin's own steps, and what reaches its hooks

A plugin's wizard steps (`extraSteps`) answer in the browser; the answers
ride to the dry run as `extras` and reach every hook as `ctx.extras`, by step
id — in `plan`, those sent with that dry run, and from then on those the plan
was made with. They are what the person said, so a hook checks every value
and never takes one as WHO said it: the email plugin's `email.list-members`
(AGL-3529) records the attester of its statement of permission from the
session that made the dry run, on its own ledger, and every write reads it
from there. `ctx.headers` is the file's column names, mapped or not — what
its purchase-tell screen reads. What only a plugin's rules can see is the
`screening` warning class its `plan` adds.

## A resource's own defaults and matching (AGL-3548)

Three optional records hooks let a resource make the wizard show what its
write will do, rather than what the core would do in its place:

- **`defaultPolicy`** — where the Conflicts step starts. The core's start
  (update, create, ask; fill blanks, leave on blank) never replaces a value
  somebody has, which is wrong for a record the file is the definition of.
  The fields route serves it as `TransferResourceInfo.defaultPolicy`, the
  kit opens a new draft on it (`createTransferWizardDraft(defaults)`) and
  says why on the step (its `note`), and the dry run lays a request's
  choices over it (`withTransferPolicyDefaults`): each part of the record
  policy and the field default is the person's where sent, the resource's
  otherwise, and field choices sent at all are the person's whole set.
- **`match`** — which record each row is about, when key-by-key matching is
  not how the resource tells records apart. The engine runs the core's
  `matchRows` and then this (`matchTransferResourceRows`) in analyze and
  in plan, so the Matching step, the Conflicts step and the dry run show
  one outcome, and `plan` gets it as `input.matches`. A records map it
  answers is merged into what `lookup` read (labels, the conflicts' before).
- **`valuesEqual`** — whether two values of a field are the same as the
  resource stores them, or `undefined` for the core's `transferValuesEqual`.
  `transferPlanConflicts` and `buildTransferPlan` (via
  `planTransferResourceRows`) both use it, so a folded value is neither a
  conflict nor a change.

What each importable records resource starts from, reviewed per resource:

| resource | starts from | why |
| -- | -- | -- |
| `redirects` | **overwrite**, leave on blank | A redirect file says where each path goes; a re-imported rule with a new destination is meant to point there. Also `match` (one rule per mode at a from-path, so `/blog` names the exact or the prefix rule by the row's mode) and `valuesEqual` (paths and destinations as the page stores them, a mode by its canonical name, status and priority as numbers). |
| `events` | core (fill blanks) | An event is edited on its page; a stale file should not move its time or place unasked. `valuesEqual` folds the status's case, as `plan` does. |
| `crm.contacts`, `crm.companies`, `crm.leads`, `crm.deals`, `crm.tasks` | core | Records people edit by hand; the CRM's locked rules already force what must move one way (stage, do-not-call, consent). |
| `data.dataset` | core | Data people edit in the console. |
| `email.list-members`, `email.suppressions` | core | Consent and suppression records; their locked rules keep the evidence and notes. |
| `outreach.do-not-contact` | core | The list only grows; its note is locked to keep. |
| `commerce.products`, `commerce.categories`, `commerce.discounts`, `commerce.coupons`, `commerce.gift-cards` | core | A catalog file from another store is a starting point, not the truth for prices, stock or balances already set here; product locks already force fill blanks where it matters. |

Export-only resources (`forms.submissions`, `bookings`, `crm.activities`,
`crm.pipelines`, `crm.fields`, and `commerce.orders`, now declared so, which
the hub had offered an Import that every row of failed) take no file, and package resources decide
per item, so neither has a field policy.

## The job engine

`@aglyn/tenant-data-admin/server/transfer-jobs` runs an import as a durable
job; the eight console routes are wiring over it, behind one gate
(`apps/console/utils/server/transfer-gate.ts`): `POST`, a verified Bearer ID
token, a per-member rate limit per route (`rate-limit-store`), the
workspace's lockdown verdict (`status`, `fields` and `export` ask with a read intent, so a read-only lock still lets a workspace take its data out), and
the member's access for the route's intent (`data-transfer/access.ts`,
AGL-3546) — on the job's site for a site's records, on the workspace
otherwise. Importing (upload, analyze, plan, apply, status, undo) needs
`data.manage`. Exporting (`export`, and `fields`, which the export dialog
opens with) asks what the resource declares: `readableByMembers` admits any
member, or a collaborator who reaches the named site (datasets); a
`readPermission` admits its holders and `data.manage`; a resource that
declares neither keeps `data.manage`. A resource stricter than
`data.manage` names its `importRoles` (AGL-3554): an import — every step,
the job's resource included — also needs the member's role where the
records are to be one of them (`hostRoleFor` on the named site, the
workspace role otherwise; `transferImportRoleAllowed`), refused in the
words of `transferImportRoleRefusal`. Gift cards declare `["admin"]`: a
workspace's owners and admins, and a site's admins. The export route passes a
collaborator's `scopeTokens`, and each resource's `readPage` and `count`
read only what they reach. Then the resource's plugin must run for the
request (AGL-3548), the plugin dispatcher's own two questions: switched on
for the named site (the workspace's set minus the site's) or, with no site,
for the workspace, and released to the workspace (`release_*`, staff
preview a dark plugin) — a 404 `notFound` otherwise. An export a resource
keeps open on every plan (`featureFlagExempt: ["export"]`, the people files)
is not asked: taking out the people a workspace holds is owed whether or not
the plugin is on, the dispatcher's `portability` rule. Workspace packages
leave out a plugin that is off or unreleased the same way. Last, the
workspace's plan (AGL-3555): a
resource that declares a `featureFlag` is refused on a plan without that
feature — the route's resource is the body's, or the job's — for every
intent its `featureFlagExempt` does not list, with 403 `{ error, reason:
'plan_required', code: <feature> }` (the plugin's own `planGate` answer, else
`transferPlanRequired`), staff included. A lookup column into such a
resource asks the same question as an import, and a workspace package
leaves out a package resource its plan does not carry. Every resource
declares the plan feature its plugin's own pages are gated by — see
[Who may move what, by plan](#who-may-move-what-by-plan). The
console's launcher answers the same rules synchronously as
`can('import' | 'export', target)`, so a list offers only what the route
will do. Plan, apply and undo write an `adminAudit` row
(`data.transfer.plan`, `data.transfer.apply` when a job starts or resumes,
`data.transfer.undo`).

### Who may move what, by plan

Each resource declares the plan feature its plugin's console surfaces and
routes are gated by (AGL-3548), so a transfer refuses exactly what the
plugin's own pages refuse. A feature no plan carries (an add-on) is refused
as the add-on it is, never as an upgrade (`transferPlanRequired`).

| resource | `featureFlag` (the plugin's own gate) | exempt | refusal | checked again inside the hooks |
| -- | -- | -- | -- | -- |
| `crm.contacts`, `crm.leads` | `crm` (CRM suite, from Starter) | export | `planGate`: `suite-gate.ts` | `requireCrmSuite` where a hook reads or writes |
| `crm.companies`, `crm.deals`, `crm.tasks`, `crm.activities`, `crm.pipelines`, `crm.fields`, `crm.email-templates` | `crm` | — | `planGate`: `suite-gate.ts` | as above |
| `data.dataset` | `dataStore` (Data page, from Starter) | — | core | the `release_data_store` flag, for the sweep |
| `bookings` | `bookings` (Bookings page, from Starter) | — | core | — (export only) |
| `events` | `eventCalendar` (the Event Calendar add-on) | — | core, as an add-on | `apply`, for the sweep (`requireEntitled`) |
| `redirects` | `redirects` (Redirects page, from Starter) | — | core | `plan` and `apply` refuse rows (`readSite`) |
| `commerce.gift-cards` | `giftCards` (gift cards, from Business) | export | `planGate`: the issue route's sentence (`gift-cards-plan.ts`) | `plan`, `apply` and undo (`issuerOf`), in the same body |
| `outreach.sequences`, `outreach.do-not-contact` | `outreach` (the Sequences add-on) | — | `planGate`: `outreachEntitlementRefusal` | each hook's access check, for the sweep |
| `workflows.org-automations` | `actions` (org automations, from Pro) | — | core | `problems` and `writeItems` (`importerRefusal`) |
| `forms.submissions`, `commerce.products`, `commerce.categories`, `commerce.orders`, `commerce.discounts`, `commerce.coupons`, `email.list-members`, `email.suppressions`, `email.topics`, `marketing.campaigns` | — (their pages are on every plan) | — | — | products cap new products at the plan's quota |

Every one of them also asks that its plugin runs (above). The checks kept
inside hooks are defense in depth for the one caller that never passes the
gate: the sweep that resumes an `applying` job.

### What is stored where

| path | what |
| -- | -- |
| `users/{uid}/transferPrefs/{resourceKey}` | a person's `TransferPrefs` for a resource: the last export choice and saved presets. The owner reads and writes it from the export dialog (the only client-written path here); the `fields` route reads it |
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
list and the collection-group `(status ↑, updatedAt ↑)`, `(undo.status ↑,
updatedAt ↑)` and `(retention ↑, retainUntil ↑)` the sweep asks.

### The routes

The request and response types are the core's (`transfer-api.ts`), so the
UI kit's client and the routes cannot disagree. A `host` resource needs the
site named (`hostId`); a workspace (`org`) resource may be given one too,
and then the job keeps it and every hook sees it as `ctx.hostId` — how a
workspace's records are read through one site's view and imported as that
site's captures — after the gate has checked `data.manage` on that site
(`transferHostIdFor`). Every refusal is a
`TransferErrorResponse` (`{ error, code, details? }`).

| route | does | request → response |
| -- | -- | -- |
| `fields` | what a resource offers (for the list `filter` an export was opened on, when the body names one): its descriptor, every field and group, its match keys (each a default, in order, and the presets' match-key hint), its own presets (`resourcePresets`, each holding only fields the catalog has), its locked rules and aliases, and the person's `TransferPrefs` from `users/{uid}/transferPrefs/{resourceKey}`. | `TransferFieldsRequest` → `TransferFieldsResponse` |
| `export` | the chosen fields (checked against the catalog, in the person's order) of the selection (at most 10,000 ids), the list's filter or every record, read page by page through the resource's `readPage` and streamed as CSV (labels as the header, or the `headers` a resource preset names; an optional byte-order mark), JSON or NDJSON. The rows are counted before the first byte — by the resource's `count` hook, or by reading ahead 5,000 rows — and sent as `X-Aglyn-Export-Rows`; a resource that cannot count and holds more goes without. An org-wide member reads everything; a collaborator scoped to some sites must reach a named site and is read through their `scopeTokens` (`memberScopeTokens`), which `readPage` must honor — the Admin SDK passes the rules. Audited as `data.transfer.export` with counts, never content. 20 a minute. | `TransferExportRequest` → the file, or `TransferErrorResponse` |
| `upload` | stores a file whole, or one part of at most 3 MB (`part`, `parts`, then `jobId`), with the CSV `delimiter` and `headerRow` the person confirmed on the first part (kept as the job's `read`); inspects each part and the whole; refuses a format the resource does not take (415), more than 24 MB or the resource's `maxBytes` (413), more rows than its `maxRows` (default 50,000; 413). Makes the job, `draft`. | `TransferUploadRequest` → `TransferUploadResponse` |
| `analyze` | header proposal (`matchHeaders` with the resource's aliases), 20 sample rows, the catalog, match keys, locked rules, and each mapped picklist column's values against the workspace's list (`picklists` hook) with a proposed choice per unmatched value. `mapping` re-reads the values under the person's mapping and adds every mapped field's `derivations` over the whole file, each mapped lookup column's `lookups` (see below), the rows `matches` against existing records under `matchKeys` (each key, by default) and `recordLabels`; `dateOrders` reads a field's dates in the order the person chose. → `analyzed`. | `TransferAnalyzeRequest` → `TransferAnalyzeResponse` |
| `plan` | refuses a mapping `mappingProblems` blocks, and any unmatched picklist value or unresolved lookup value without a usable choice (`choicesNeeded`, by field); reads every row, resolves picklists and lookups into row notes, looks matches up in slices of 500 values, runs `matchRows` over the whole file (so an in-file duplicate is caught across chunks) and the resource's plan, fails the rows an invariant refuses, and stores the chunks. Writes no record. → `planned`. Answers the summary, the warnings, 50 rows of each verdict (`sample`), the first 500 `conflicts` (and `conflictCount`), the `ambiguous` rows and `recordLabels`; keeps `dateOrders` and the plugin steps' `extras` on the job. `action: 'rows'` pages the stored plan, by verdict. | `TransferPlanRequest` → `TransferPlanResponse`; `TransferPlanRowsRequest` → `TransferPlanRowsResponse` |
| `apply` | the first call needs `canApplyTransferPlan` (`acknowledgementsMissing` lists the rest); refuses while another job of the same resource is `applying` or another driver holds this one's lease (`busy`). Adds the chosen picklist values (`addPicklistValues`), then writes chunks for 45 seconds and answers the progress and the `results` of the chunks it wrote; called until `done`. A plugin `apply` that throws fails the job naming the chunk; calling again resumes it. | `TransferApplyRequest` → `TransferApplyResponse` |
| `status` | the job, `TransferProgress`, and whether undo is open; `include: 'results'` adds every written row's result; `download: 'results'` answers the result file (the file's own columns, then `Outcome`, `Reason`, `Record ID`) as CSV with `X-Aglyn-Export-Rows`. | `TransferStatusRequest` → `TransferStatusResponse` or `text/csv` |
| `package` | workspace packages (AGL-3535): `list`, `export` (both read; export audited as `data.transfer.export`, counts only), `plan`, `apply`, `undoPlan`, `undo` — see [Workspace packages](#workspace-packages). Only the package resources of plugins the workspace runs (`listTransferResourcesFor`). | `TransferPackage*Request` → `TransferPackage*Response` |
| `jobs` | the workspace's imports, newest first, a page at a time (`createdAt` cursor), each a `TransferJobSummary`: its label, status, counts, who (`createdByEmail`, from Auth), when, whether its result file and undo are open. With `sitePackages` on the first page, each site's latest `hosts/{hostId}/packageImports` too. Read. With `unfinished: true` instead, the caller's own records imports that have written nothing (`retention: 'expire'`), newest first — a query on `(createdBy, retention, updatedAt ↓)` — for Resume (AGL-3549), read; with `action: 'discard'` and a `jobId`, one of those thrown away now (`discardTransferJob`: the caller's own, never one that wrote), a write. | `TransferJobsRequest` → `TransferJobsResponse` \| `TransferUnfinishedImportsResponse` |
| `undo` | for seven days after `applied`. `action: 'plan'` reads every touched record through `lookup` by id and runs `planTransferUndo`: counts of restore, delete, conflict and nothing, and the conflicts (what the record holds now, what undo would restore), paged; writes nothing. `action: 'apply'` reverts chunk by chunk through `revert`, each record with the person's `decisions[recordId]` or `otherwise`; called until `done`, then `undone`. | `TransferUndoPlanRequest` → `TransferUndoPlanResponse`; `TransferUndoApplyRequest` → `TransferUndoApplyResponse` |

### Lookup columns (AGL-3541)

For each mapped `lookup` field the engine finds the target — the
resource's own `lookupTargets[field.lookup.resource]`, or the declared
resource of that key, asked in the same workspace and site — and asks its
`lookup` hook for every distinct value: by `id` (`aglynId`) when
`mayBeTransferRecordId` holds, then by each `field.lookup.by` field with the
target's match-key normalizer for it (caseless when none names it), in
slices of 500. The first key that names exactly ONE record resolves the
value. A value that names several, or none, is unresolved: `analyze` answers
it as a `TransferLookupReview` row — the value, its key, its count, up to 20
rows, and up to five suggestions (the records it named several of, then the
target's `suggest`), with `resolved` counting the values that did resolve.
`plan` needs a `lookupChoices[fieldId][key]` for every unresolved value:
`mapTo` a record (looked up by id, refused if gone), `create` (refused unless
the field's `lookup.creatable`), `leaveBlank` or `refuseRow`. Rows then carry
the record id, `transferLookupNewValue(text)` for a create, nothing for
leave-blank (never a clear), and an `unresolvedLookup` note with what was
decided (`refuse` fails the row). The choices are kept on the job.

A `list` field with a `lookup` (`isTransferLookupField`) holds several
records — a dataset's multi-reference (AGL-3556). Each item is resolved and
decided on its own, counted once per row; the row carries the list of ids
(each record once), an item left blank is dropped, a list whose every item
was left blank is not written, and one refused item refuses the row.

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
same engine, and every undo left running for two minutes, with the
person's own decisions (each `undo` apply call stores them on
`undo.decisions`; anything they did not name follows `otherwise`).

It also cleans up (AGL-3540). Every job write stamps `retention` and
`retainUntil` (`transferJobRetention`):

| the job | `retention` | `retainUntil` | when it is due |
| -- | -- | -- | -- |
| never wrote (`draft`, `analyzed`, `planned`, or `failed` before its first write) | `expire` | last touched + 7 days (`TRANSFER_DRAFT_RETENTION_MS`) | the job, its subcollections and its file (and any parts) are deleted |
| wrote (`applied`, `undone`, or `failed` after writing) | `trim` | applied + 7 days, when undo closes (`TRANSFER_UNDO_WINDOW_MS`) | its dry run, undo snapshots, ledger and file are cleared; the job and its per-row results stay, with `trimmedAt`, and the result file is refused from then on |
| `applying`, or undoing | — | — | resumed above, never cleaned |

A trimmed job carries no `retention`, so it never matches again. The
sweep reads each due job again before acting on it, and handles at most 50
of each kind per run. A GET lists what it would do and does nothing. The
indexes are `(undo.status ↑, updatedAt ↑)` and `(retention ↑,
retainUntil ↑)`, collection group.

## Workspace packages

A workspace package (AGL-3535) is an `aglyn-package` v2 file of the
workspace's own items: sequences (`outreach.sequences`), campaigns
(`marketing.campaigns`), org automations (`workflows.org-automations`),
CRM email templates (`crm.email-templates`) and email topics
(`email.topics`, AGL-3550). Each item's kind is the key of the `package`
transfer resource that owns it, so one file carries several plugins' items
and the references between them (a sequence step's template, an
automation's campaign, a campaign's topic).

Email topics are read as the catalog every reader sees
(`mergeSubscriptionTopics`), so a built-in nobody changed is an item too and
a campaign or automation naming one always resolves. A campaign's `topicId`
and an automation step's `topicId` are `email.topics` dependencies, so a
kept-both topic is what the campaign or step in the same package points at,
and a topic neither carries nor holds is asked about like any other
reference. Email lists name no topic and are not package items, so they
are only ever mapped, left out or skipped.

It runs as a job of the row engine — `orgs/{orgId}/transferJobs/{jobId}`,
`kind: 'package'`, `resource: 'package'` — and so shares its lease (one
package import per workspace at a time), its ledger, its audit rows, the
history, the sweep's resume and its cleanup. It does not share the row
routes: there is no column to map, and a package is planned whole.

| step | what `transfer-packages.ts` does |
| -- | -- |
| plan | Reads the file (each item's content must match its hash), stores it as the job's source, reads what the workspace holds of every owned kind the items carry or name (`items`), the sites (`site`) and every other kind they name (`referenceTargets`), plans (`planTransferPackage`), asks each written item's plugin what it would refuse (`problems`, on the item as it would be written), plans again with the objections and stores the plan in `chunks/0`. Writes no item. Re-planning takes the person's `decisions` and `dependencyChoices` by job id. |
| apply | Refuses while anything blocks (`choicesNeeded`) or a warning is unacknowledged. Takes the undo snapshot BEFORE the first write (`undo/0`: each replaced item's content through `readItems`, each entry `created` or `updated`), then hands each owner its run of items in dependency order (`writeItems`, references rewritten by `remapIds`), through the ledger; then reads each written item's hash (`items`) into the snapshot, so undo can tell the import's own content from a later edit. |
| undo | For seven days. An item the import created and nobody touched is deleted; one it replaced and nobody touched is put back; one edited since (its hash is neither the written nor the previous one) is a conflict, reverted only when the person says so; one gone or already back needs nothing. The plugin carries the steps out (`revertItems`) and may refuse one its own rules forbid — a sequence that has started sending stays. |

Each plugin writes through its own save, so an import can store nothing that
save would refuse, and keeps its own rules: an imported sequence is a draft
(`saveOutreachSequence`); an org automation lands switched off
(`createOrgAutomationRecord`); every campaign email is a draft with no
audience or send time (the campaign draft writer's fields); a personal
template becomes the importer's own; a topic is written as the topic page
writes it (`emailTopicDocument`, the document `writeEmailTopic` stores) and
nothing else — no opt-out, no confirmation, nothing under a site — and undo
retires a topic the import added rather than deleting it, because an
unsubscribe link sent under it must go on naming it.

### Resuming an import (AGL-3549)

A person who closes the tab mid-wizard, before Apply, comes back to the
job from where they started it: every import surface draws the core's
`TransferResumeImport` beside its Import button with the same target, and
the hub lists every one of theirs under **Unfinished imports**. Both read
the launcher's `unfinished(target?)` — the jobs route's `unfinished`
answer, read once the first surface asks and again whenever the wizard
closes, only for a holder of `data.manage` — and Resume is
`openImport({ jobId })`, which reopens the wizard on the job's step with
every choice saved on it. **Discard** is `discard(jobId)`. A colleague's
unfinished import is never listed, and never resumable from a surface: a
statement of permission made in it is theirs.

Plugin-side records an import leaves expire with it. The email plugin's
list import ledger (`orgs/{orgId}/lists/{listId}/imports/{jobId}`: sample
shared-mailbox addresses and who stated permission) is stamped
`expiresAt: listImportLedgerExpiry(...)` by every dry run — 15 days, the 7
a planned import may wait, its 7-day undo window and a day — under a
Firestore TTL policy on the `imports` collection group
(`docs/FIRESTORE_MANUAL_CONFIG.md`, `docs/DATA_RETENTION.md`). No other
plugin keeps a per-import record: the rest stamp the job's id on the
records they write.

## The hub

`Settings → Import & export` (`/[orgSlug]/settings/data`, shown to whoever
may export something — `data.manage`, or a resource whose records the
person may read on a plan that moves them, `useTransferHubVisible`, AGL-3554)
lists every resource the workspace's plugins declare —
the workspace's and, for the site picked, that site's — grouped by plugin,
leaving out a plugin switched off there or whose release flag is off for
the workspace (AGL-3548), as the routes refuse it.
Records open the wizard and the export dialog through the shell's launcher,
each button — a dataset's per-instance rows too — only where `can` says the
person may; packages, and the history, are for `data.manage` alone, which
their routes ask. Packages open the workspace package export and import; each site links to
its Backup & restore. The history (`/api/transfer/jobs`) lists every import
— rows, workspace packages, each site's package imports — with its result
file and Undo while the window is open. It loads the `transferResources`
slot's registrars, so every resource's client half is registered before the
hub names it.

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
| `fields` | `{ resource, filter? }` (the dialog's filter value) | `TransferResourceInfo`: the descriptor, every field in catalog order, the groups, the match keys (and default keys), preset hints, locked rules, alias dictionaries, the person's `TransferPrefs`, whether a custom field may be created |
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
  Minimal, the resource's own — whose `headers` are sent while the preset is
  chosen as it stands — saved, "save these fields as"), the grouped and searchable
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
Its `export` reads the file's bytes (keeping a byte-order mark) and refuses
one holding fewer rows than `X-Aglyn-Export-Rows` promised; its `savePrefs`
is the surface's `saveTransferPrefs` (`apps/console/utils/transfer-prefs-store.ts`),
which merges over the stored document and writes it back normalized.

## Site packages

A site package (`aglyn-package` v2, `package.ts`) is a site's designable
items as one file: a manifest of `{ kind, $id, slug?, name?, contentHash,
deps }` and each item's content by `<kind>/<id>`. The whole-site backup is
the package's everything preset. The site-specific half is
`@aglyn/aglyn/data-transfer/site-package` — its own subpath, not re-exported by
`@aglyn/aglyn/data-transfer`, because it reads the compiled plugin
declarations the generic core does not.

### Kinds

| source | kinds |
| -- | -- |
| platform | `settings` and `theme` (singletons of the site's fields), `page` and `email` (screens, split by `kind`), `emailTemplate` (the site's own emails, keyed by catalog key), `layout`, `component`, `author`, `collection` (with its entries), `mediaFolder`, `media`, `siteMediaFolder`, `siteMedia`, `savedTheme` (the theme library) |
| a host collection's `siteExport.package` | `form`, `redirect`, `event`, `experiment`, `overlay`, `service`, `function`, `variable`, `workflow`, `action` |
| a backup section's `package` | `dataset` |

A plugin declares its kind beside its data in `plugins.config.json`: the
kind, a plural label, the slug or name field an item with a new id is matched
by, the fields holding other items' ids, the binding token (`var`, `fn`) that
names its items, and the node props that place one (`placements`). A section
also registers `package.dependencies(item)` and `package.remapIds(item, idMap)`
with its answers; registering a section without them is refused. The
generator gives every kind one owner and refuses a platform kind.

An item's content is the document a v1 backup carried, without `$id`: a page
with its published `version` and its routing-map address as `route`, a
collection with its `entries`, a section's item as the plugin exported it.
`siteBundleItems` reads a v1 backup into items (and caps each array where the
restore always capped it); `siteWritesToBundle` turns resolved writes back into
the v1 shape the restore's writers take, so there is one write path.

### Dependencies and moving references

`siteItemDependencies` lists what an item names: typed references (a page's
`layoutId`, a collection's entry screens, a declared `references` field), a
reusable component placement's `refId`, a declared placement (a `form` node's
`formId`, a node's `repeatDataset`), the `{{var:id}}` and `{{fn:id(…)}}`
tokens, the section's own answer, and any other string or map key in the
content that is, or holds as a whole token, the id of a known item (links like
`screen:<id>`, media references). Ids that are words — a catalog key,
`default` — are never searched for, and inside text only ids of at least eight
characters are. `remapSiteReferences` is the same walk rewriting through an id
map; a dropped reference becomes `null` in a field, leaves a list, a map or a
binding token, and empties any other string.

### Hashes

The console hashes an item over what an import would WRITE
(`siteItemProjection`, `_lib/site-package-read.ts`): its allow-list, its
version's and its entries', its address, no stamps, node trees decoded and
dates in one wire form. So an item restored yesterday and exported today is
`identical` to the file it came from, and a besigner-saved page compares
equal whichever storage form either side holds.

### Export — `GET|POST /api/hosts/export`

`{ hostId, items?, dependencies?, list? }`. No `items`: everything. `items`
names item keys; `dependencies` adds what they need (`packageDependencyClosure`).
`list` answers the manifest and the kinds alone, for a picker. Every manifest
entry keeps its full dependency list, so an import can say which ones the file
does not carry. The file is v2 only.

### Import — `POST /api/hosts/import`

`{ hostId, action, package | bundle, mode?, decisions?, dependencyChoices?,
mergeChoices?, keys?, importId?, otherwise? }`. A v1 `aglyn-site-export` backup is converted in
memory. An item of a kind this site does not read (a plugin it lacks) is set
aside and named in `unknownKinds`; a site email under a key the platform does
not send is named in `notSent`.

| action | does |
| -- | -- |
| `plan` | Reads the site the same way the export does, hashes both sides, and answers `planSitePackageImport`: each item matched by id, then slug, then name, within its kind; `new`, `identical`, `differs` or `missingDependency`; the proposed decision (create new, skip everything else) and the decisions it may take. With the person's decisions it also answers `capRefusal`: the sentence an apply would be refused with, counting only what the import adds. Writes nothing. |
| `compare` | Writes nothing either. For each of `keys` (one to ten item keys), the file's item and the site item it was matched to, each through `siteItemProjection` — what an import would write: `{ items: [{ key, kind, id, incoming, existing: { id, content } \| null }] }`. The package wizard asks for one item at a time, when the person opens it, to diff it and render both sides (AGL-3534). |
| `apply` | `mode: 'decide'` (default with an action): each item's decision — `create`, `replace`, `keepBoth`, `skip`, `merge` (settings and theme) — or the proposed one; `dependencyChoices[<kind>/<id>]` is `import` (the package's copy of a skipped new item), `{ mapTo }`, `drop` or `keep`; `mergeChoices[<item key>][<key>]` is `site` or `package`, for a merged item's top-level keys. `mode: 'restore'`, and a request with no `action` at all: every item under its own id, as a v1 restore wrote. Then the restore's write path: pre-checks, the undo snapshot, the screens leg in one transaction, every other collection on batches, the plugin sections item by item, whole-host revalidation, an activity entry and an `adminAudit` row (`site.package.apply`). |
| `undoPlan` / `undo` | For seven days: what undo would do (`restore`, `delete`, `conflict`), then do it — write each replaced item back through the same writers, and delete every document the import wrote that the undo did not write back. An item with a document updated after the import finished is a conflict, reverted only when `decisions[key]` or `otherwise` says `revert`. Audited as `site.package.undo`. |

`resolveSitePackageImport` turns decisions into writes. Keep both gives the
item a new id (`createResourceUid`) and slug (`keepBothSlug`), and a page a
moved address; every incoming reference to it is rewritten. A replace or skip
of an item matched by slug or name points incoming references at the site's
item. A replace of a page, layout or site email writes the incoming design as a
NEW version when the site holds that version id with a different design, so no
version the site has is overwritten and the one it published stays in its
history. Merge fills what the site has not set and keeps every value it has, except
the keys `mergeChoices` names: `package` takes the file's value, `site` keeps
the site's.
A media item kept as a copy keeps its own stored file's address.

### The wizard — `PackageImportWizard` (AGL-3534)

The kit (`@aglyn/aglyn-transfer-ui`) holds the screens; the console's backup
card opens them. They talk to the routes above through a `SitePackageClient`
the surface hands them (`site-package-client.ts`; the console's is
`apps/console/utils/site-package-http-client.ts`). Upload → Items (grouped by
kind; a decision per item from its own choice, then the default for its kind
of change, then the plan's proposal; every item's decision is sent) → Missing
items (`packageDependencyPrompts`: a dependency of a written item that the
file carries but is skipped, or that neither side holds) → Changes (`compare`,
rendered side by side through `previewHref` and diffed value by value; a merge
key by key) → Review (re-planned with every decision; `capRefusal` blocks;
each warning class acknowledged) → Import, with undo (`PackageImportUndo`,
each edited-since conflict asked about). `PackageExportDialog` picks items by
kind and shows `packageDependencyClosure` before the file downloads.

The rendered diff uses the console's document preview route: each side is
written as a preview snapshot under its own version id (`package-site`,
`package-file`), never a real version's, and the route renders the snapshot
(`apps/console/utils/site-package-preview.ts`). Both sides are drawn without
a page's layout chain.

A kind a plugin previews itself — a form, a site email — is drawn by that
plugin's widget in the `sitePackageItemPreview` zone (AGL-3545). The zone is
one its host gates (`CONSOLE_HOST_GATED_WIDGET_SLOTS`, AGL-3554): the
widget draws only the item it is handed, on a card already gated on what
the import requires, so the console asks the widget's own `permission` and
not its extension's — the Email plugin's `data.manage`, which guards its
audiences, no longer hides the email preview from the site editor
importing it.

### The ledger — why these routes and not the job engine

`hosts/{hostId}/packageImports/{importId}` records who imported what, each
item's decision and target, and the window; `snapshots/{n}` holds every
replaced or merged item's previous content and `writtenPaths/{n}` every path
written per item, as JSON pieces of at most 900,000 characters. Admin SDK
only: the rules name `packageImports` in the host catch-all's read and write
exclusions. Every document of it — the record and each piece, since TTL does
not cascade — carries an `expiresAt` the undo window and a day after it was
written (`packageLedgerExpiry`, AGL-3543), and TTL policies on
`packageImports`, `snapshots` and `writtenPaths` delete it.

A package is a site's items rather than rows of a file, and its writes are the
restore's: the allow-lists, the atomic screens leg (AGL-2370), the plugin
sections and the whole-host revalidation. So it keeps its own routes with the
engine's guarantees — a plan that writes nothing, an undo for seven days, an
audit row per apply and undo — rather than teaching the row engine items. An
apply is one request, with no chunk cursor to lease; two imports are
serialized where it matters by the screens transaction, as before.

## Commerce (AGL-3531)

The commerce plugin's six resources live in `libs/plugins/commerce/src/lib/transfer/`;
every one is a site's records (`scope: host`), registered from the console's
server declarations, with the store-touching hooks loaded on first use.

| resource | import | the record |
| -- | -- | -- |
| `commerce.products` | yes | a product, a row per variant (`product-transfer.ts`, `products.server.ts`) |
| `commerce.categories` | yes | a product category; parent by slug or name |
| `commerce.discounts` | yes | a discount; new ones start switched off |
| `commerce.coupons` | yes | a coupon, its id being its code; new ones start switched off |
| `commerce.orders` | no | an order, its money from `totals` (AGL-1747) |
| `commerce.gift-cards` | by issuing (AGL-3551) | a gift card, its id being its code |

**Products fold rows.** The resource's `plan` groups the rows of one handle
(or ID) into a product: the first row's product fields and match (handle,
then SKU, then ID) decide the product, planned with `buildTransferPlan`; every
row's variant fields are planned against the variant it names (SKU, then the
option values, then a single-variant product's one variant). Each row keeps
its verdict and diff, and carries `commerce` — the product id (minted at plan
time for a new product, so a retried create finds what it wrote), the variant
id, and for a new product its whole document — for the apply. A product the
model's `validateProduct` would refuse is failed by the `product-storable`
invariant with the reason. The lookup's record is the product's fields by
field id plus `$variants` and `$variant:<id>`, so undo restores variants one
by one and sees a sale since the import as an edit.

**Writes keep the product write path's rules**: a create counted against
`productsPerHost` in the transaction that creates it, born live with its
stamps and creator, the derived search, stock and collection keys on every
write, an activity entry per product, and a stock change logged as a
`correction` in `inventoryAdjustments`. Locked: an existing product's handle
and option names. Held back with a warning: a stock count kept by location.

**Lists hand over their query.** The products page and the orders tab pass
their plan's predicates and order (`commerceListFilter`); the server re-checks
every path against the list's declaration (`readCommerceListFilter`) before
reading through the Admin SDK, and pages by `[orderValue, id]`.

**Export-only resources** declare `records`, make every field read-only, and
refuse a row that would write with an invariant, so a dry run says why.

**Gift cards import by issuing (AGL-3551).** `gift-cards.server.ts` never
writes a balance: its `plan` (`planGiftCardRows`) stamps each create with
`giftCard` — the code it is issued under (the file's, joined and upper-cased;
minted at plan time for a blank cell, or for a taken code whose row chose
"create a new record"), the amount in cents, US dollars only, at most
`GIFT_CARD_ISSUE_MAX_CENTS` — and turns a row that would change an existing
card into a refusal the `gift-card-issuable` invariant fails. A code the
match missed (spaced or cased differently) is read once and refused too. The
total of every card is stamped on each row and stated in a `screening`
warning; the plugin's own wizard step (`gift-card-total`, after Conflicts)
lists every card from the stored plan and sends the typed total in `extras`.
Apply reads it again and issues a row only when it equals the planned total,
each card through `issueGiftCard` (`server/gift-card-issue.ts`, the same
path the Gift cards card's Issue uses: `create`, never `set`; `issuedBy`;
an activity line per card under `commerce:giftCard`; email only when the
step asked). A retried row finds its own card by `importJobId` and
`importRow`. Plan, Apply and Undo each refuse anybody but the workspace's
owners and admins and the site's admins (`canImportGiftCards`), and a plan
without the `giftCards` entitlement. Undo voids (zeroes, never deletes) a
card nobody has spent from; a card with a redemption or a hold is a conflict
that is never voided, whatever the decision.

**Shopify.** The Shopify product CSV headers are the products resource's alias
dictionary (source `Shopify`), and its `shopify` preset writes Shopify's
columns in Shopify's order under Shopify's names.

## The resources

| resource | plugin | scope | moves | matched on |
| -- | -- | -- | -- | -- |
| `forms.submissions` | forms | site | export only: the submission's details and the answers; opened on one form, that form's questions | — |
| `bookings` | bookings | site | export only: service, times, customer, status, payment | — |
| `redirects` | redirects | site | both ways; off-site destinations approved in the importer's name, loops refused, chains and live pages flagged | Aglyn ID, then the from-path normalized as the redirects page normalizes it |
| `events` | events-calendar | site | both ways, through the same write rule as the events page | Aglyn ID, then title and start together |
| `outreach.do-not-contact` | outreach | workspace | import adds addresses and domains and never changes an entry; export holds the domains (an address is kept only as a fingerprint) | Aglyn ID, then the address or domain |
