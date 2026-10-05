# @aglyn/aglyn-transfer-ui

The import and export screens every Aglyn surface uses: the export dialog,
the eight-step import wizard, and the pieces they are built from. It is the
UI over the import/export core in `@aglyn/aglyn/data-transfer`, which holds
the header matching, value reading, record matching, conflict policy, the
dry-run plan and undo.

> Beta. Not yet on the registry: its first version is published by hand
> before any published package depends on it.

## Install

    npm install @aglyn/aglyn-transfer-ui@beta

Peer dependencies:

- `react`
- `@mui/material`
- `@mui/icons-material`

## What's in it

Components:

- `TransferExportDialog` offers every field of a resource, grouped and
  searchable, with select all or none and an order the person sets. Presets
  (Re-importable, the default; Everything; Minimal; and saved presets) fill
  the picker. Scope (the selection, the current filter, or everything),
  format (CSV with an optional byte-order mark, JSON, NDJSON) and the last
  choice are remembered through the client.
- `TransferImportWizard` walks a file through Upload, Columns, Values,
  Matching, Conflicts, Review, Import and Results. Each column, value, match
  and conflict is shown with a choice; each warning class needs its own
  acknowledgement before Import enables; applying pauses and resumes; an
  applied import can be undone while its window is open. The draft is
  saved per job, so a reload with the job id resumes.
- `TransferDiffTable`, `TransferAcknowledgementList`, `TransferChoiceSelect`,
  `TransferFieldPicker` and `TransferWizardNav` are the shared pieces, for a
  surface (a package import) that lays out its own steps.

The server:

- `TransferClient` is everything the kit asks of the server. The kit never
  fetches; the surface hands it a client.
- `createMemoryTransferClient` runs the core in memory, for specs, stories
  and resources with no server half yet.

Plugin steps: `registerTransferWizardStep(resource, step)`, or the wizard's
`extraSteps` prop, adds a step (a consent attestation) after any step
before Review. Its answer travels to the server with the plan.

Every file under `src/lib` is also reachable by subpath, for example
`@aglyn/aglyn-transfer-ui/transfer-client`.

## Usage

```tsx
import { TransferImportWizard } from '@aglyn/aglyn-transfer-ui'
import type { TransferClient } from '@aglyn/aglyn-transfer-ui'

export function PeopleImport({
  client,
  jobId,
  setJobId,
}: {
  client: TransferClient
  jobId: string | null
  setJobId(id: string | null): void
}) {
  return (
    <TransferImportWizard
      client={client}
      resource="people"
      jobId={jobId}
      onJobChange={setJobId}
    />
  )
}
```

## How it fits

This package sits in the `core` scope of the package map as a UI piece: it
imports `@aglyn/aglyn`, because it renders the core's import/export shapes,
and `@aglyn/shared-ui-jsx` for its scrolling tables. It knows no plugin and
no resource; each plugin brings its fields, match keys and locked rules
through its server half, and the AI mapping proposal arrives through the
`importMapping` zone the console renders.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/aglyn-transfer-ui
