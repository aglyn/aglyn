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

## Render it

The kit never fetches. Give it a `TransferClient`; the console provides one
for the job engine's routes.

```tsx
import { TransferExportDialog, TransferImportWizard } from '@aglyn/aglyn-transfer-ui'

<TransferImportWizard
  client={client}
  resource="my-plugin.items"
  jobId={jobIdFromTheAddress}
  onJobChange={putTheJobIdInTheAddress}
  importMappingZone={{ collection: 'items', hostId, orgId }}
/>

<TransferExportDialog
  open={open}
  onClose={close}
  client={client}
  resource="my-plugin.items"
  selection={selectedIds}
  filter={{ label: 'Status is open', value: currentFilter }}
/>
```

- `jobId` and `onJobChange` let a reload resume the import where the person
  left it; the draft of every choice is saved per job.
- `importMappingZone` draws the `importMapping` zone under the Columns step,
  so an assistant plugin can propose a mapping from the headers and the
  shape of each column. It never sees a cell.

## Add a step of your own

A step goes after any step before Review. Its answer is kept under its id
and sent to the server with the plan, where your server half checks it.

```tsx
import { registerTransferWizardStep } from '@aglyn/aglyn-transfer-ui'

registerTransferWizardStep('my-plugin.items', {
  id: 'consent',
  label: 'Consent',
  after: 'conflicts',
  render: ({ value, setValue }) => <ConsentCheckbox checked={value === true} onChange={setValue} />,
  problems: ({ value }) => (value === true ? [] : ['Confirm these people agreed to hear from you.']),
})
```

Pass the same object in the wizard's `extraSteps` prop when your plugin
renders the wizard itself.

## Lock a rule

A rule your records keep whatever a file says — a stage never moves
backward, consent is never set from a file — is a `TransferLockedRule` your
server half returns with the fields. The Conflicts step shows the field
disabled with your reason, and the Review step counts the values it held
back.

## Try it without a server

`createMemoryTransferClient` runs the whole job in memory over records you
give it, so a story or a spec can walk every step before your server half
exists.
