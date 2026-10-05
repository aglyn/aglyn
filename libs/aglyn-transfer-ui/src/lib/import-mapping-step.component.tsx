/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use client'

/**
 * Step 2, Mapping: which field each column fills.
 *
 * Each column shows its header, a few of its values, the proposed field
 * and why it was proposed — the same name, a similar name, or values that
 * look like the field — with the confidence. Any column can be remapped or
 * ignored, and a custom field can be created for one that has no home.
 * Two columns on one field, and a required field no column fills, block
 * Next until the person resolves them.
 *
 * The `importMapping` zone renders under the table through the console's
 * zone renderer, so an assistant plugin can propose a mapping from the
 * headers and the shape of each column — never a cell.
 */

import {
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { isTransferFieldImportable } from '@aglyn/aglyn/data-transfer'
import type {
  HeaderMatchProposal,
  InferredCellType,
  TransferFieldType,
} from '@aglyn/aglyn/data-transfer'
import type { ConsoleImportColumnShape } from '@aglyn/aglyn/plugin-manager/record-zone-props'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'

import { TransferChoiceSelect } from './transfer-choice-select.component'
import { mappingStepGate } from './transfer-wizard-state'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import { MATCH_REASON_WORDS, displayTransferValue } from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

/** Where the `importMapping` zone renders, in the owning plugin's words. */
export interface TransferImportMappingZone {
  /** What the file is imported as, as the zone's widgets know it (`contacts`). */
  collection: string
  hostId: string | null
  orgId: string | undefined
}

const SHAPES: Readonly<Record<InferredCellType, ConsoleImportColumnShape>> = {
  email: 'email',
  phone: 'phone',
  url: 'url',
  date: 'date',
  number: 'number',
  currency: 'number',
  boolean: 'yes-no',
  text: 'text',
}

const CUSTOM_FIELD_TYPES: readonly {
  value: TransferFieldType
  label: string
}[] = [
  { value: 'text', label: 'Text' },
  { value: 'longText', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'Web address' },
]

const IGNORE = '__ignore'

/** Draws the zone through the console's renderer, handed in rather than made here. */
function ZoneSlot({
  renderer: Renderer,
  ...props
}: { renderer: ConsoleWidgetSlotRenderer; slot: string } & Record<string, unknown>) {
  return <Renderer {...props} slot={props.slot} />
}

function confidenceColor(confidence: number): 'success' | 'info' | 'warning' {
  if (confidence >= 0.95) return 'success'
  if (confidence >= 0.72) return 'info'
  return 'warning'
}

function proposalChip(
  proposal: HeaderMatchProposal | undefined,
  current: string | undefined,
) {
  if (!current) return <Chip size="small" variant="outlined" label="Ignored" />
  if (!proposal || proposal.fieldId !== current || !proposal.reason)
    return <Chip size="small" variant="outlined" label="Your choice" />
  return (
    <Stack spacing={0.25}>
      <Chip
        size="small"
        variant="outlined"
        color={confidenceColor(proposal.confidence)}
        label={`${Math.round(proposal.confidence * 100)}% sure`}
      />
      <Typography variant="caption" color="text.secondary">
        {MATCH_REASON_WORDS[proposal.reason]}
        {proposal.alias && proposal.reason !== 'typeInference'
          ? ` (“${proposal.alias}”)`
          : ''}
        {proposal.source ? ` · ${proposal.source}` : ''}
      </Typography>
    </Stack>
  )
}

export function ImportMappingStep({
  wizard,
  zone,
}: {
  wizard: TransferImportWizardController
  zone?: TransferImportMappingZone
}) {
  const { analysis, draft, fields, fieldLabel, info } = wizard
  const Slot = useConsoleWidgetSlot()
  const [creating, setCreating] = useState<{
    column: number
    label: string
    type: TransferFieldType
  } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const importable = useMemo(
    () => fields.filter(isTransferFieldImportable),
    [fields],
  )
  const gate = mappingStepGate(draft.mapping, fields)
  const headers = analysis?.headers ?? []

  const setColumn = (column: number, fieldId: string) =>
    wizard.setDraft((d) => {
      const mapping = { ...d.mapping }
      if (fieldId === IGNORE) delete mapping[column]
      else mapping[column] = fieldId
      return { ...d, mapping }
    })

  /** A zone widget's proposal: unknown columns and fields dropped, one field per column. */
  const proposeMapping = (proposed: Readonly<Record<number, string>>) => {
    const taken = new Set<string>()
    const mapping: Record<number, string> = {}
    for (const [columnText, fieldId] of Object.entries(proposed).sort(
      ([a], [b]) => Number(a) - Number(b),
    )) {
      const column = Number(columnText)
      if (!Number.isInteger(column) || column < 0 || column >= headers.length)
        continue
      if (
        !importable.some((field) => field.id === fieldId) ||
        taken.has(fieldId)
      )
        continue
      taken.add(fieldId)
      mapping[column] = fieldId
    }
    wizard.setDraft((d) => ({ ...d, mapping }))
  }

  const createField = async () => {
    if (!creating || !wizard.client.createCustomField) return
    setCreateError(null)
    try {
      const field = await wizard.client.createCustomField({
        resource: wizard.resourceKey,
        label: creating.label.trim(),
        type: creating.type,
      })
      wizard.addField(field)
      setColumn(creating.column, field.id)
      setCreating(null)
    } catch (reason) {
      setCreateError(
        reason instanceof Error
          ? reason.message
          : 'The field could not be created.',
      )
    }
  }

  const sampleOf = (column: number): string =>
    (analysis?.sampleRows ?? [])
      .map((row) => row[column])
      .filter(
        (cell) =>
          cell !== null && cell !== undefined && String(cell).trim() !== '',
      )
      .slice(0, 3)
      .map((cell) => displayTransferValue(cell))
      .join(', ')

  const blockers = [
    ...gate.problems.duplicates.map(
      (entry) =>
        `${fieldLabel(entry.fieldId)} is chosen for ${entry.columns.map((column) => `“${headers[column] ?? column + 1}”`).join(' and ')}. Choose one column for it.`,
    ),
    ...(gate.problems.unmappedRequired.length
      ? [
          `Required ${gate.problems.unmappedRequired.length === 1 ? 'field' : 'fields'} with no column: ${gate.problems.unmappedRequired.map(fieldLabel).join(', ')}.`,
        ]
      : []),
    ...gate.problems.invalid.map(
      (entry) =>
        `“${headers[entry.column] ?? entry.column + 1}” is mapped to a field this import cannot write.`,
    ),
    ...(gate.mappedCount === 0
      ? ['Choose a field for at least one column.']
      : []),
  ]
  const canCreate = Boolean(
    info?.canCreateCustomField && wizard.client.createCustomField,
  )

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardHeader
          title="Match each column to a field"
          subheader={`${gate.mappedCount} of ${headers.length} columns matched`}
          action={
            canCreate ? (
              <Button
                onClick={() =>
                  setCreating({
                    column: Math.max(
                      0,
                      headers.findIndex(
                        (_header, column) => !draft.mapping[column],
                      ),
                    ),
                    label: '',
                    type: 'text',
                  })
                }
              >
                Create custom field
              </Button>
            ) : undefined
          }
        />
        <CardContent>
          {analysis?.proposal.conflicts.length ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {analysis.proposal.conflicts
                .map(
                  (conflict) =>
                    `${conflict.columns.map((column) => `“${headers[column]}”`).join(' and ')} both looked like ${fieldLabel(conflict.fieldId)}; the first keeps it.`,
                )
                .join(' ')}
            </Alert>
          ) : null}
          <ScrollTable size="small" aria-label="Column matching">
            <TableHead>
              <TableRow>
                <TableCell>Column</TableCell>
                <TableCell>Values</TableCell>
                <TableCell>Field</TableCell>
                <TableCell>Why</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {headers.map((header, column) => {
                const proposal = analysis?.proposal.proposals.find(
                  (entry) => entry.column === column,
                )
                const current = draft.mapping[column]
                return (
                  <TableRow key={column}>
                    <TableCell>
                      <Typography variant="body2">{header}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {sampleOf(column) || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <TransferChoiceSelect
                        hideLabel
                        fullWidth
                        label={`Field for column “${header}”`}
                        value={current ?? IGNORE}
                        onChange={(fieldId) => setColumn(column, fieldId)}
                        options={[
                          { value: IGNORE, label: 'Ignore this column' },
                          ...importable.map((field) => ({
                            value: field.id,
                            label: field.label,
                            description:
                              [
                                field.required ? 'Required' : null,
                                field.matchKey && !field.custom
                                  ? 'Finds existing records'
                                  : null,
                                field.description ?? null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || undefined,
                          })),
                        ]}
                      />
                    </TableCell>
                    <TableCell>{proposalChip(proposal, current)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        </CardContent>
      </Card>
      {zone && Slot && headers.length ? (
        <ZoneSlot
          renderer={Slot}
          slot="importMapping"
          hostId={zone.hostId}
          orgId={zone.orgId}
          collection={zone.collection}
          columns={headers.map((header, column) => {
            const inferred =
              analysis?.proposal.proposals.find(
                (entry) => entry.column === column,
              )?.inferredType ?? null
            return { header, shape: inferred ? SHAPES[inferred] : 'empty' }
          })}
          mapping={draft.mapping}
          proposeMapping={(proposed: Readonly<Record<number, string>>) =>
            proposeMapping(proposed)
          }
        />
      ) : null}
      <TransferWizardNav
        busy={wizard.busy}
        blockers={blockers}
        onBack={wizard.back}
        onNext={() => void wizard.next()}
      />
      <Dialog
        open={Boolean(creating)}
        onClose={() => setCreating(null)}
        aria-labelledby="transfer-create-field-title"
      >
        <DialogTitle id="transfer-create-field-title">
          Create a custom field
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {createError ? <Alert severity="error">{createError}</Alert> : null}
            <TextField
              label="Field name"
              value={creating?.label ?? ''}
              onChange={(event) =>
                setCreating((current) =>
                  current ? { ...current, label: event.target.value } : current,
                )
              }
            />
            <TransferChoiceSelect
              label="Kind of value"
              value={creating?.type ?? 'text'}
              options={CUSTOM_FIELD_TYPES}
              onChange={(type) =>
                setCreating((current) =>
                  current ? { ...current, type } : current,
                )
              }
            />
            <TransferChoiceSelect
              label="Fill it from column"
              value={String(creating?.column ?? 0)}
              options={headers.map((header, column) => ({
                value: String(column),
                label: header,
              }))}
              onChange={(column) =>
                setCreating((current) =>
                  current ? { ...current, column: Number(column) } : current,
                )
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!creating?.label.trim()}
            onClick={() => void createField()}
          >
            Create field
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default ImportMappingStep
