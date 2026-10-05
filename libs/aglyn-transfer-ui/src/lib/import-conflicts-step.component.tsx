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
 * Step 5, Conflicts: what a row does to the record it matched.
 *
 *  - Record defaults: on a match (update, skip, duplicate), on no match
 *    (create, skip), on several matches (choose per row, or skip).
 *  - Field policy: for each mapped field, how the file's value meets the
 *    record's (overwrite, fill blanks, keep, append to a list) and what a
 *    blank cell means (leave, clear). A plugin's locked rule shows disabled
 *    with its reason.
 *  - The conflicts themselves: every matched row whose file values differ
 *    from values its record already holds, before → after under the policy,
 *    with a per-row action and per-field override; and every row several
 *    records matched, with the record to update chosen here.
 *
 * Each change re-plans, so the "after" column is always what will happen.
 */

import {
  isTransferFieldWritable,
  isTransferListType,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferBlankMeans,
  TransferField,
  TransferFieldMode,
  TransferFieldPolicy,
  TransferOnAmbiguous,
  TransferOnMatch,
  TransferOnNew,
  TransferRowOverride,
} from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import type { TransferConflict } from './transfer-client'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import type { TransferChoiceOption } from './transfer-choice-select.component'
import { conflictsStepProblems, draftPolicy } from './transfer-wizard-state'
import type {
  TransferWizardDraft,
  TransferWizardPolicy,
} from './transfer-wizard-state'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import {
  BLANK_WORDS,
  MODE_WORDS,
  ON_AMBIGUOUS_WORDS,
  ON_MATCH_WORDS,
  ON_NEW_WORDS,
  SOURCE_WORDS,
  displayTransferValue,
  rowNumber,
} from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

const PAGE = 10
const AS_SET = '__asSet'

function modeOptions(
  field: TransferField | undefined,
): TransferChoiceOption<TransferFieldMode>[] {
  return (Object.keys(MODE_WORDS) as TransferFieldMode[])
    .filter(
      (mode) => mode !== 'append' || (field && isTransferListType(field.type)),
    )
    .map((mode) => ({ value: mode, ...MODE_WORDS[mode] }))
}

const BLANK_OPTIONS = (Object.keys(BLANK_WORDS) as TransferBlankMeans[]).map(
  (value) => ({ value, ...BLANK_WORDS[value] }),
)

function ConflictRow({
  conflict,
  wizard,
  update,
}: {
  conflict: TransferConflict
  wizard: TransferImportWizardController
  update(policy: (current: TransferWizardPolicy) => TransferWizardPolicy): void
}) {
  const labels = wizard.planResponse?.recordLabels ?? {}
  const override = wizard.draft.policy.rows[conflict.row] ?? {}
  const setOverride = (
    patch: (current: TransferRowOverride) => TransferRowOverride,
  ) =>
    update((policy) => {
      const next = patch(policy.rows[conflict.row] ?? {})
      const rows = { ...policy.rows }
      if (
        !next.action &&
        !next.recordId &&
        !Object.keys(next.fields ?? {}).length
      )
        delete rows[conflict.row]
      else rows[conflict.row] = next
      return { ...policy, rows }
    })
  const name = labels[conflict.recordId] ?? conflict.recordId
  return (
    <Box
      sx={{ py: 1.5 }}
      role="group"
      aria-label={`Row ${rowNumber(conflict.row)} and ${name}`}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{
          alignItems: { sm: 'center' },
          justifyContent: 'space-between',
          mb: 1,
        }}
      >
        <Typography variant="subtitle2">
          Row {rowNumber(conflict.row)} · {name}
        </Typography>
        <TransferChoiceSelect
          label={`Row ${rowNumber(conflict.row)}`}
          value={override.action ?? AS_SET}
          options={[
            { value: AS_SET, label: 'As set above' },
            { value: 'update', label: 'Update the record' },
            { value: 'skip', label: 'Skip this row' },
            { value: 'create', label: 'Create a new record instead' },
          ]}
          onChange={(action) =>
            setOverride((current) => ({
              ...current,
              action:
                action === AS_SET
                  ? undefined
                  : (action as TransferRowOverride['action']),
            }))
          }
        />
      </Stack>
      <ScrollTable
        size="small"
        aria-label={`Row ${rowNumber(conflict.row)} field by field`}
      >
        <TableHead>
          <TableRow>
            <TableCell>Field</TableCell>
            <TableCell>Record has</TableCell>
            <TableCell>File has</TableCell>
            <TableCell>Result</TableCell>
            <TableCell>For this row</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {conflict.fields.map((change) => {
            const field = wizard.fields.find(
              (entry) => entry.id === change.fieldId,
            )
            const locked = wizard.info?.locked.find(
              (rule) => rule.fieldId === change.fieldId,
            )
            const rowMode = override.fields?.[change.fieldId]?.mode
            return (
              <TableRow key={change.fieldId}>
                <TableCell>{wizard.fieldLabel(change.fieldId)}</TableCell>
                <TableCell>{displayTransferValue(change.before)}</TableCell>
                <TableCell>{displayTransferValue(change.incoming)}</TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {displayTransferValue(change.after)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {MODE_WORDS[change.mode].label} ·{' '}
                    {SOURCE_WORDS[change.source]}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                  <TransferChoiceSelect
                    hideLabel
                    fullWidth
                    label={`Row ${rowNumber(conflict.row)}, ${wizard.fieldLabel(change.fieldId)}`}
                    value={rowMode ?? AS_SET}
                    disabled={Boolean(
                      locked?.forced?.mode || locked?.refuseValues,
                    )}
                    options={[
                      { value: AS_SET, label: 'As set for the field' },
                      ...modeOptions(field),
                    ]}
                    onChange={(mode) =>
                      setOverride((current) => {
                        const fields = { ...(current.fields ?? {}) }
                        if (mode === AS_SET) delete fields[change.fieldId]
                        else
                          fields[change.fieldId] = {
                            ...fields[change.fieldId],
                            mode: mode as TransferFieldMode,
                          }
                        return { ...current, fields }
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </ScrollTable>
    </Box>
  )
}

export function ImportConflictsStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const { draft, info, planResponse, fields, fieldLabel } = wizard
  const [page, setPage] = useState(0)
  const policy = draft.policy
  const mappedFields = [...new Set(Object.values(draft.mapping))]
    .map((id) => fields.find((field) => field.id === id))
    .filter((field): field is TransferField =>
      Boolean(field && isTransferFieldWritable(field)),
    )
  const conflicts = planResponse?.conflicts ?? []
  const ambiguous = planResponse?.ambiguous ?? []
  const labels = planResponse?.recordLabels ?? {}
  const locked = info?.locked ?? []

  const update = (
    change: (current: TransferWizardPolicy) => TransferWizardPolicy,
  ) => {
    const next: TransferWizardDraft = { ...draft, policy: change(draft.policy) }
    wizard.setDraft(() => next)
    void wizard.replan(next)
  }
  const setField = (fieldId: string, patch: Partial<TransferFieldPolicy>) =>
    update((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [fieldId]: { ...current.fields[fieldId], ...patch },
      },
    }))

  const blockers = conflictsStepProblems(
    draftPolicy(draft, locked),
    fields,
    ambiguous,
  )

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardHeader title="When a row…" />
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TransferChoiceSelect
              fullWidth
              label="Matches a record"
              value={policy.record.onMatch}
              options={(Object.keys(ON_MATCH_WORDS) as TransferOnMatch[]).map(
                (value) => ({ value, label: ON_MATCH_WORDS[value] }),
              )}
              onChange={(onMatch) =>
                update((current) => ({
                  ...current,
                  record: { ...current.record, onMatch },
                }))
              }
            />
            <TransferChoiceSelect
              fullWidth
              label="Matches nothing"
              value={policy.record.onNew}
              options={(Object.keys(ON_NEW_WORDS) as TransferOnNew[]).map(
                (value) => ({ value, label: ON_NEW_WORDS[value] }),
              )}
              onChange={(onNew) =>
                update((current) => ({
                  ...current,
                  record: { ...current.record, onNew },
                }))
              }
            />
            <TransferChoiceSelect
              fullWidth
              label="Matches several records"
              value={policy.record.onAmbiguous}
              options={(
                Object.keys(ON_AMBIGUOUS_WORDS) as TransferOnAmbiguous[]
              ).map((value) => ({ value, label: ON_AMBIGUOUS_WORDS[value] }))}
              onChange={(onAmbiguous) =>
                update((current) => ({
                  ...current,
                  record: { ...current.record, onAmbiguous },
                }))
              }
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="When the record already has a value"
          subheader="Nothing is replaced or cleared unless you choose it here."
        />
        <CardContent>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ mb: 2 }}
          >
            <TransferChoiceSelect
              fullWidth
              label="Every field, unless set below"
              value={policy.fieldDefault.mode}
              options={modeOptions(undefined)}
              onChange={(mode) =>
                update((current) => ({
                  ...current,
                  fieldDefault: { ...current.fieldDefault, mode },
                }))
              }
            />
            <TransferChoiceSelect
              fullWidth
              label="A blank cell, unless set below"
              value={policy.fieldDefault.blank}
              options={BLANK_OPTIONS}
              onChange={(blank) =>
                update((current) => ({
                  ...current,
                  fieldDefault: { ...current.fieldDefault, blank },
                }))
              }
            />
          </Stack>
          <ScrollTable size="small" aria-label="Each field">
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>File value meets record value</TableCell>
                <TableCell>A blank cell</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappedFields.map((field) => {
                const rule = locked.find((entry) => entry.fieldId === field.id)
                const chosen = policy.fields[field.id]
                const mode =
                  rule?.forced?.mode ??
                  chosen?.mode ??
                  (isTransferListType(field.type)
                    ? 'append'
                    : policy.fieldDefault.mode)
                const blank =
                  rule?.forced?.blank ??
                  chosen?.blank ??
                  policy.fieldDefault.blank
                const reason = rule
                  ? rule.refuseValues
                    ? `Never set from a file: ${rule.reason}`
                    : rule.reason
                  : undefined
                return (
                  <TableRow key={field.id}>
                    <TableCell>{field.label}</TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <TransferChoiceSelect
                        hideLabel
                        fullWidth
                        label={`${field.label}: file value meets record value`}
                        value={mode}
                        options={modeOptions(field)}
                        disabled={Boolean(
                          rule?.forced?.mode || rule?.refuseValues,
                        )}
                        helperText={
                          rule?.forced?.mode || rule?.refuseValues
                            ? reason
                            : undefined
                        }
                        onChange={(next) => setField(field.id, { mode: next })}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <TransferChoiceSelect
                        hideLabel
                        fullWidth
                        label={`${field.label}: a blank cell`}
                        value={blank}
                        options={BLANK_OPTIONS}
                        disabled={Boolean(
                          rule?.forced?.blank || rule?.refuseValues,
                        )}
                        helperText={
                          rule?.forced?.blank && !rule.forced.mode
                            ? reason
                            : undefined
                        }
                        onChange={(next) => setField(field.id, { blank: next })}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        </CardContent>
      </Card>

      {ambiguous.length ? (
        <Card variant="outlined">
          <CardHeader
            title={`Rows that match several records (${ambiguous.length})`}
            subheader="Choose the record each one updates, or what to do instead."
          />
          <CardContent>
            <Stack spacing={1.5}>
              {ambiguous.map((entry) => {
                const override = policy.rows[entry.row] ?? {}
                const value = override.recordId
                  ? `record:${override.recordId}`
                  : (override.action ?? '')
                return (
                  <Stack
                    key={entry.row}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Typography variant="body2" sx={{ minWidth: 220 }}>
                      Row {rowNumber(entry.row)} ·{' '}
                      {fieldLabel(entry.via.fieldId)} “{entry.via.value}”
                    </Typography>
                    <TransferChoiceSelect
                      label={`Row ${rowNumber(entry.row)} updates`}
                      value={value}
                      placeholder={
                        policy.record.onAmbiguous === 'ask'
                          ? 'Choose…'
                          : 'Skipped'
                      }
                      options={[
                        ...entry.recordIds.map((id) => ({
                          value: `record:${id}`,
                          label: labels[id] ?? id,
                        })),
                        { value: 'skip', label: 'Skip this row' },
                        { value: 'create', label: 'Create a new record' },
                      ]}
                      onChange={(picked) =>
                        update((current) => ({
                          ...current,
                          rows: {
                            ...current.rows,
                            [entry.row]: picked.startsWith('record:')
                              ? {
                                  ...current.rows[entry.row],
                                  action: undefined,
                                  recordId: picked.slice('record:'.length),
                                }
                              : {
                                  ...current.rows[entry.row],
                                  recordId: undefined,
                                  action: picked as 'skip' | 'create',
                                },
                          },
                        }))
                      }
                    />
                  </Stack>
                )
              })}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="outlined">
        <CardHeader
          title={`Rows that disagree with their record (${conflicts.length})`}
          subheader={
            conflicts.length
              ? 'Before → after for each field, as set above; change any row or field here.'
              : 'No matched row has a value that differs from its record.'
          }
        />
        {conflicts.length ? (
          <CardContent>
            {conflicts
              .slice(page * PAGE, page * PAGE + PAGE)
              .map((conflict) => (
                <ConflictRow
                  key={conflict.row}
                  conflict={conflict}
                  wizard={wizard}
                  update={update}
                />
              ))}
            {conflicts.length > PAGE ? (
              <TablePagination
                component="div"
                count={conflicts.length}
                page={page}
                rowsPerPage={PAGE}
                rowsPerPageOptions={[PAGE]}
                onPageChange={(_event, next) => setPage(next)}
              />
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      <TransferWizardNav
        busy={wizard.busy}
        blockers={blockers}
        onBack={wizard.back}
        onNext={() => void wizard.next()}
      />
    </Stack>
  )
}

export default ImportConflictsStep
