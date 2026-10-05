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
| Job engine: upload, analyze, plan, apply, status, undo | `apps/console/app/api/transfer/*`, the admin library | AGL-3524 |
| Field-selectable export route | `apps/console/app/api/transfer/export` | AGL-3525 |
| UI kit: export dialog, import wizard | `libs/aglyn-transfer-ui` | AGL-3526 |
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

**AGL-3524, the job engine.** Analyze runs `matchHeaders` and
`collectPicklistValues`; plan runs `deriveTransferRow`, the picklist
resolution, `matchRows` and `buildTransferPlan` chunk by chunk and stores
`PlannedTransferRow`s per `TransferChunk`; apply refuses until
`canApplyTransferPlan` holds, then writes chunk by chunk under the ledger,
storing `TransferChunkResult`s and `TransferUndoSnapshot`s; undo runs
`planTransferUndo` per entry and returns conflicts to the person. Job state
moves only through `transitionTransferJob`.

**AGL-3526, the UI kit.** The wizard steps render the core's outputs: the
mapping step `HeaderMatchProposal` (confidence, reason, source,
alternatives) and `MappingProblems`; the values step `Derivation` samples
and `PicklistMatchResult`; the matching step `summarizeMatches`; the
conflicts step `TransferPolicy` with locked rows; the dry-run step
`TransferPlan` (summary, diff table, warnings with acknowledgement); the
export dialog `TransferFieldCatalog` and the presets.
