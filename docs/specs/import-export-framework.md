# Import and export everywhere

Status: the core (AGL-3522), the extension point (AGL-3523) and the job
engine (AGL-3524) are built; everything else in the build plan below is
open. Linear project P-AGL-140.
The architecture of the core, and how the rest plugs into it, is in
[`docs/DATA_TRANSFER.md`](../DATA_TRANSFER.md).

## The decision

Decided by: the founder, 2026-10-05.

1. **Export offers every field, and the person chooses which.** Standard,
   custom, derived and system fields are all offered; nothing is exported
   that the person did not pick.
2. **Import matches columns to fields, and rows to the records that already
   exist.** Both for every resource that can be imported or exported: leads,
   contacts, deals, tasks, companies, pages, layouts, components, emails,
   sequences, and every other surface below.
3. **Nothing is decided silently.** Every conflict, step, value derivation,
   and new-versus-old value comes with a warning and a "choose how to handle
   it" prompt: merge, overwrite, keep, skip, add, and so on.

## Where things stand (survey, 2026-10-04, at `6f659ac364`)

Import and export exist today as about eight separate, partial
implementations, mostly CSV. The best are the CRM drawers and the email list
import; only the CRM drawers and the AI mapping zone share code. Nothing lets
a person choose which fields to export. Only one import (datasets) lets a
person choose how it matches existing records, and it only offers overwrite.
No import has a per-conflict choice, a server-side dry run, or undo.

### Shared pieces that already exist

| Piece | Path | What it does |
| -- | -- | -- |
| CSV parser and escaper | `libs/aglyn/src/lib/app-utils/csv.ts` | `parseCsv`, `escapeCsvCell`, and the check that a download is not shorter than the row count the server promised (`X-Aglyn-Export-Rows`) |
| Mapping helpers | `libs/aglyn/src/lib/app-utils/csv-import.ts` | Guesses a column → field mapping from an alias table (custom fields win), `custom:<key>` targets, sums chunk results, writes a skipped-rows CSV. 5,000 rows per file, 200 rows per request, 2 MB per request |
| Upload cap | `libs/aglyn/src/lib/app-utils/csv-upload.ts` | 8M characters |
| AI mapping slot | `importMapping` zone, filled by the AI plugin | The AI proposes a column mapping (CRM only) |
| Whole-site backup extension points | `plugin-manager/plugin-site-export.ts`, `plugin-site-bundle.ts` | Declared in `plugins.config.json`, registered from `serverDeclarations`; a declared section never registered fails the export or restore |
| Picklist engine | `libs/aglyn/src/lib/app-utils/picklists.ts` | Standard and organization picklist values (AGL-3510) |

### Surfaces

**FS** = choose the fields to export · **Map** = column → field screen ·
**Match** = matching existing records · **Conflict** = choices when a row
matches · **Dry** = dry-run preview · **Undo**

| Surface | Format | Today | Missing |
| -- | -- | -- | -- |
| CRM contacts (import) | CSV | Map with aliases and custom fields; 10-row preview; matches on email; fills blanks on a match (phone never replaced, lifecycle stage only moves forward); in-file duplicates skipped; company looked up by name and created; owner by email; skipped-rows CSV | Conflict choices, Dry, Undo, resumable job, other products' header aliases |
| CRM companies (import) | CSV | Matches on domain, then name; overwrites on a match and unions tags; custom fields | Conflict, Dry, Undo, parent company and the newer standard fields |
| CRM leads (import) | CSV | Keyed on the person key; overwrites status, owner, reason and notes; refuses `qualified` and consent columns | Custom fields, Conflict, Dry, Undo |
| CRM deals (import) | CSV | Always creates, so re-importing duplicates every row; pipeline and stage by name | Match (no id column), links to people and companies, custom fields |
| CRM tasks (import) | CSV | Always creates; an unknown assignee refuses the row | Match, links, custom fields |
| CRM exports (five objects) | CSV | Fixed columns; contacts and companies add custom fields; streamed and audited | FS, an Aglyn ID column, JSON, every field |
| CRM activities, notes, pipelines, views, field definitions, picklists, email templates | — | None | Everything |
| CRM reports | CSV | Exports the table as shown | FS (minor) |
| Email list members (import) | CSV or pasted | The most mature: preview → start (consent attestation) → run with a cursor → status; staged and resumable; flags role accounts and purchased-list columns; 50k cap; in-file dedupe; people already on the list unchanged | Map beyond email and opt-in, contact field updates, Undo |
| Email list members (export), suppressions, topics | — | None | Everything |
| Datasets | CSV/JSON both ways | Paste or upload; auto-maps by field id or name with no remap; optional key field updates existing records (overwrite only, written from the browser) | Map, FS, Conflict, server job, per-row errors, Undo |
| Products | CSV (a common storefront format) | Requires Handle and Title; a colliding slug gets a suffix (always creates); written from the browser | Match by handle or SKU, updates, Map, FS, server job |
| Orders (export) | CSV | What the list query matches, up to 5,000 | FS, streaming past 5,000 |
| Discounts, coupons, gift cards, categories, suppliers, locations, subscriptions, site members, inventory | — | None | Everything |
| Whole-site backup | JSON (`aglyn-site-export` v1) | All or nothing: settings, pages and layouts, components, authors, collections, media manifest, plugin collections and datasets; import overwrites by id with an allow-list, checks plan caps | Choosing items, Dry, collision choices, version diff, dependencies, Undo. Not carried: email templates, forms, redirects, products, events, experiments and overlays, themes |
| Templates and marketplace installs | Internal copy | Copies into the site library | Collision prompts, file import |
| One page, component or layout as a file | — | None | Everything |
| Outreach sequences and enrollments, campaigns, automations | — | None | Everything |
| Forms, bookings, events | — | None (kept out of the site backup as personal data) | Submissions and bookings export; definitions in packages |
| Redirects | — | None | CSV both ways, matched on the from-path |
| "Download my data" | JSON (+ CSVs) | Per user and per workspace, with a coverage block | Stays separate: a legal obligation, never plan-gated, and its coverage has to match what erasure removes |
| Staff-only exports, REST v1, CLI | Various | Operational; no bulk endpoints | Out of scope (bulk endpoints later) |

## The design

### Where each part lives

- **Core (pure, domain-neutral):** `libs/aglyn/src/lib/data-transfer/` —
  resources and fields, the field catalog and presets, header matching,
  value derivations, picklist mapping, record matching, conflict policy, the
  plan, job types and packages. Other products' header dictionaries live in
  the plugin that owns the resource, never in core.
- **Extension point (AGL-3523):** `plugin-manager/plugin-transfer-resources.ts`,
  the same shape as `plugin-site-bundle.ts`. A plugin declares
  `transferResources` in `plugins.config.json` and registers the server half
  (`fields`, `matchKeys`, `readPage`, `lookup`, `plan`, `apply`, `invariants`,
  `revert`; for packages `items`, `dependencies`, `remapIds`) from
  `serverDeclarations` and the client half from its console registrar. A
  declared resource that never registered fails loudly. Writes keep going
  through each plugin's own write paths, so plan bands, consent rules and
  activity logging cannot be bypassed.
- **Job engine (AGL-3524):** `apps/console/app/api/transfer/{upload,analyze,plan,apply,status,undo,export}`;
  state in `orgs/{orgId}/transferJobs/{jobId}` with `chunks`, `results` and
  `undo` subcollections; the uploaded file in Storage under
  `orgs/{orgId}/transfers/{jobId}/source`, inspected like every upload.
- **UI kit (AGL-3526):** a new lib `libs/aglyn-transfer-ui`
  (`scope:core type:ui`): the export dialog, the import wizard, conflict
  lists, the diff table, warning acknowledgements, results and undo. Any
  plugin can use it; the `importMapping` zone moves into it.

### Export

- A field picker over every field (standard, custom, derived, system),
  grouped, searchable, select all or none, drag to reorder.
- Presets: Everything, Re-importable (the default — always carries the
  Aglyn ID and the match keys), Minimal, and named presets a person saves.
  The last choice is remembered per person and resource.
- Scope: the selection, the current filter, or everything. Formats: CSV
  (optional byte-order mark for spreadsheets), JSON, NDJSON.
- A streamed route that keeps today's row-count header and shortfall
  check, and writes an audit entry.

### The import wizard

1. **Upload.** Delimiter, encoding and header row detected; row and column
   counts; a file that is too big is refused before anything is sent.
2. **Mapping.** Each column gets a confidence badge: alias, then fuzzy, then
   type inference, then the AI proposal. Remap, ignore, or create a custom
   field inline. Two columns on one field, and required fields with no
   column, must be resolved first.
3. **Values.** Each picklist's unmatched values: map, add to the list, leave
   blank, or refuse the row. What each parser did, with counts and samples.
   Name-split rules. Unresolved lookups: create, map, leave blank, or refuse.
4. **Matching.** Match keys in priority order (Aglyn ID, external id, email,
   domain, name, slug, SKU) with counts of matched, new, ambiguous and
   in-file duplicates.
5. **Conflicts.** On match: update, skip or duplicate; on no match: create or
   skip; on ambiguous: skip or choose per row. Per field: overwrite, fill
   blanks, keep, append; and whether a blank cell leaves or clears. Any row
   or field can override. A plugin's rules appear locked, with the reason.
6. **Dry run.** The server plans every row without writing: counts, a
   filterable before → after table, and every warning class. Each class is
   acknowledged before Apply is enabled.
7. **Apply** as a job: 200-row chunks, a cursor in Firestore, driven by the
   browser and resumed by a sweep; a per-row ledger so a retry never writes
   twice; live progress; a downloadable per-row result file.
8. **Undo** for seven days: previous values of touched fields and the ids
   of created records are snapshotted; a record edited since comes back as a
   conflict prompt.

### Packages (`aglyn-package` v2)

- A manifest of items (`kind`, `$id`, slug or name, content hash,
  dependencies) plus the items.
- Kinds: pages, layouts, components, email templates, forms, collections,
  datasets, media manifest, redirects, workflows and actions, functions and
  variables, sequences, campaigns, automations, theme.
- Export picks items and can include their dependencies; the whole-site
  backup becomes a preset.
- Import matches each item by id, then slug or name: new, identical,
  differs, or missing a dependency. Per item: replace (as a new version),
  keep both (new id and slug, references rewritten), skip, or merge (for
  kinds that merge key by key). Missing dependencies: import, map to an
  existing item, or drop the reference with a warning. A rendered and a
  JSON diff side by side.

### Cross-cutting

- **Permissions:** `data.manage` for import and undo; read access for export,
  scoped by what the member can see; packages need site-edit rights and the
  site-export entitlement.
- **Limits:** plan bands enforced where records are written and reported per
  row; per-plan file limits; one running job per resource per organization;
  rate-limited routes.
- **Audit:** export, plan, apply and undo are audited; imported records carry
  an "Imported from …" timeline entry.
- **Firestore:** batches of at most 500 writes, eight at once, inside a time
  budget. `transferJobs` and `transferPrefs` are written only by the server.

## Build plan

| Issue | What | Depends on |
| -- | -- | -- |
| AGL-3522 | Core: field catalog, header matching, derivations, picklist mapping, record matching, policy, plan, job and package types | AGL-3510 |
| AGL-3523 | Transfer-resource extension point | AGL-3522 |
| AGL-3524 | Job engine and routes: upload, analyze, plan, apply, status, undo; ledger; sweep; audit; rate limit | AGL-3522, AGL-3523 |
| AGL-3525 | Field-selectable streamed export: presets, remembered choices, CSV/JSON/NDJSON | AGL-3523, AGL-3524 |
| AGL-3526 | UI kit: export dialog, eight-step wizard, warnings, results and undo | AGL-3522 |
| AGL-3527 | CRM contacts and companies on the framework | AGL-3524–3526 and the CRM field work |
| AGL-3528 | CRM leads, deals, tasks, activities and pipelines | AGL-3527 |
| AGL-3529 | Email lists and suppressions | AGL-3524, AGL-3526 |
| AGL-3530 | Datasets | AGL-3524–3526 |
| AGL-3531 | Commerce | AGL-3524–3526 |
| AGL-3532 | Form submissions, bookings, redirects, events, do-not-contact domains | AGL-3524–3526 |
| AGL-3533 | Site package v2: selective export, dependency graph, content hashes; the backup becomes a preset | AGL-3522, AGL-3523 |
| AGL-3534 | Package import wizard | AGL-3526, AGL-3533 |
| AGL-3535 | Organization packages and the Import & Export hub | AGL-3524, AGL-3526, AGL-3533 |

Order: 3522 → 3523 → (3524 ∥ 3526) → 3525 → 3533 → 3529–3532 in any order →
3527 → 3528 → 3534 → 3535.
