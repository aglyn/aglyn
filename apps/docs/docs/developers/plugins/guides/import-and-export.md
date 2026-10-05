---
sidebar_position: 6
title: "Guide: import and export screens"
description: Render the field-picking export dialog and the eight-step import wizard for your plugin's records, with your own steps and locked rules.
---

# Import and export screens

`@aglyn/aglyn-transfer-ui` is the import wizard and the export dialog every
surface uses. Your plugin brings what is particular to its records — the
fields, the keys that find an existing record, the rules a file may not
break — and the kit does the rest the same way for every resource.

## What a person sees

- **Export** offers every field, grouped and searchable. Presets fill the
  picker: Re-importable (the default — the Aglyn ID and your match keys
  first, so the file comes back in and finds its records), Everything,
  Minimal, and presets the person saves. They choose the records (the
  selection, the current filter, or all), the format (CSV, JSON, NDJSON)
  and the column order; the choice is remembered.
- **Import** is eight steps: Upload, Columns, Values, Matching, Conflicts,
  Review, Import and Results. Each column, unknown list value, unresolved
  reference, match and conflict is shown with a choice. The Review step is
  a dry run: counts, a before → after table, and every class of warning,
  each needing its own "I understand" before Import enables. Importing
  pauses and resumes; an applied import can be undone for seven days, and a
  record edited since is asked about rather than overwritten.

## Open it

Your plugin never renders the screens itself: the console does, and hands
your plugin a launcher. Ask for it with `useTransferLauncher()` from
`@aglyn/aglyn` and open the wizard or the dialog on the resource you
declared in `transferResources`:

```tsx
import { useTransferLauncher } from '@aglyn/aglyn'

function ItemsHeaderActions({ hostId, selectedIds, currentFilter }) {
  const transfer = useTransferLauncher()
  // Outside the console there is no launcher: show no Import or Export.
  if (!transfer) return null
  return (
    <>
      <Button
        onClick={() =>
          transfer.openImport({ resource: 'my-plugin.items', scope: 'host', hostId, mappingZone: 'items' })
        }
      >
        Import
      </Button>
      <Button
        onClick={() =>
          transfer.openExport({
            resource: 'my-plugin.items',
            scope: 'host',
            hostId,
            selection: selectedIds,
            filter: { label: 'Status is open', value: currentFilter },
          })
        }
      >
        Export
      </Button>
    </>
  )
}
```

- `jobId` on `openImport` resumes an import where the person left it; the
  draft of every choice is saved per job.
- `mappingZone` draws the `importMapping` zone under the Columns step, so an
  assistant plugin can propose a mapping from the headers and the shape of
  each column. It never sees a cell.
- `onFinished` is called when the person leaves the wizard from its results.
- `title` names what is being moved ("Import into Products") where the
  resource's label alone would not.

### One instance at a time

A resource whose records come in separate sets — a dataset's records, one
dataset at a time — is declared once with `instances: true` and opened on
the key that names the set, `<key>:<instance>`:

```tsx
transfer.openImport({ resource: `data.dataset:${datasetId}`, scope: 'org', title: `Import into ${name}` })
```

The job, the person's remembered export fields and the one-running-import
rule are then each kept per set. Your server half reads which set from
`transferResourceInstanceOf(ctx)` and answers its fields and match keys for
it: `matchKeys(ctx)` may return `{ keys, defaults }`, the keys that set
offers and the ones a person starts with.

## Add a step of your own

A step goes after any step before Review. Register it with your resource's
client half, from your console registrar. Its component is handed the job
and its answer; what it passes to `setValue` is sent to the server with the
dry run under the step's id in `extras`, where your server half checks it,
and Next waits for `setComplete(true)`.

The server half reads the answers as `ctx.extras`: in your `plan` hook,
those sent with this dry run; in `apply` and after, those the plan was made
with. They are what the person said in the browser, so check every value,
and never let one say WHO said it — the email plugin's statement of
permission records its attester from the session that made the dry run, on
its own ledger, and every write reads it from there. `ctx.headers` holds the
file's column names, mapped or not.

```tsx
registerPluginTransferResourceUi('my-plugin.items', {
  label: 'Items',
  extraSteps: [{ id: 'consent', label: 'Consent', after: 'conflicts', component: ConsentStep }],
})

function ConsentStep({ value, setValue, setComplete }: TransferWizardStepProps) {
  return (
    <Checkbox
      checked={value === true}
      onChange={(event) => {
        setValue(event.target.checked)
        setComplete(event.target.checked)
      }}
    />
  )
}
```

## Warn about what only you can see

The core warns about what it can see — a guessed date, a value to be
replaced, a row repeated. What only your records' rules can see — the email
plugin's shared mailboxes and column names that read as a bought list — is
the `screening` warning class: your `plan` hook adds it to the plan's
warnings with a `detail` on each sample, and the person acknowledges it like
every other class before Import enables. A sample about the whole file (a
column's name) has the row `TRANSFER_FILE_SAMPLE_ROW` and is shown without
one.

## Lock a rule

A rule your records keep whatever a file says — a stage never moves
backward, consent is never set from a file — is a `TransferLockedRule` your
server half returns with the fields. The Conflicts step shows the field
disabled with your reason, and the Review step counts the values it held
back.

## Resolve a column that names another record

A field of type `lookup` names a record of another resource — a contact's
company, a deal's contact, a task's owner — through `lookup: { resource,
by, creatable }`. The import resolves each distinct value the file holds
through the TARGET's `lookup` hook: first by Aglyn ID when the cell could
be one, then by each `by` field in order, using the target's match-key
normalizer for that field. A value that names exactly one record becomes
that record's id. The rest are listed on the Values step with the records
they may mean — the records a value named several of, then whatever the
target's optional `suggest(ctx, { by, values })` hook offers — and the
person chooses for each: create it (only when `creatable`), use one of
them, leave the field blank (nothing is written; a blank chosen here never
clears a value), or refuse the rows.

What your `apply` receives for the field is the record id, or — for a value
the person chose to create — `transferLookupNewValue(name)`, which
`transferLookupNewName` reads back. Create that record on your own write
path, once however many rows name it, and find the one an earlier attempt
created when a chunk is retried.

A target no resource moves — the workspace's members an owner column names
— is answered by the resource itself: list it under `lookupTargets` with
its own `lookup` (and `suggest`, and the `matchKeys` its fields compare
with), keyed by the name the field's `lookup.resource` uses.

A resource of the WORKSPACE (`scope: 'org'`) may still be opened with a
`hostId`: the job keeps that site, your hooks get it as `ctx.hostId`, and
the transfer routes check the person's permission on that site — how a
workspace's records are read through one site's view and imported as that
site's captures.

## What an export asks of your server half

The export reads your records through your `readPage`, a page at a time,
holding only the fields the person chose. Honor every option it passes:
`ids` (the selection), `filter` (the list's filter, in your own terms) and
`scopeTokens` — present when the reader is a collaborator scoped to some
sites, and the only thing standing between them and the rest of the
workspace, because the export reads past the rules. Register `count` too
if you can: the file then carries its row count and the download is
checked whole however large it is.

## Try it without a server

The console's own specs drive the wizard with `createMemoryTransferClient`,
which runs the whole job in memory over the records it is given, so every
step can be walked before a resource's server half exists.
