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
 * Step 8, Results: what happened, a per-row result file to download, and
 * Undo while its window is open.
 *
 * Undo first asks the server what it would do. A record edited since the
 * import is never silently put back: each one is listed with what it holds
 * now and what undo would restore, and the person chooses — keep it as it
 * is, or restore it anyway — before undo runs.
 */

import { escapeCsvCell } from '@aglyn/aglyn/app-utils/csv'
import { transferUndoExpiresAt } from '@aglyn/aglyn/data-transfer'
import type {
  TransferRowOutcome,
  TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
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
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import type {
  TransferUndoDecision,
  TransferUndoResponse,
} from './transfer-client'
import { downloadTransferFile } from './transfer-export-dialog.component'
import {
  OUTCOME_WORDS,
  REASON_WORDS,
  countOf,
  displayTransferValue,
  rowNumber,
} from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

const OUTCOMES: readonly TransferRowOutcome[] = [
  'created',
  'updated',
  'unchanged',
  'skipped',
  'failed',
]

/** Every row's result as a CSV: the row, what happened, the record and why. */
export function transferResultsCsv(rows: readonly TransferRowResult[]): string {
  const lines = [
    ['Row', 'Result', 'Record ID', 'Why'].join(','),
    ...rows.map((row) =>
      [
        escapeCsvCell(String(rowNumber(row.row)), { numeric: true }),
        ...[
          OUTCOME_WORDS[row.outcome],
          row.recordId ?? '',
          row.message ??
            (row.reason && row.reason in REASON_WORDS
              ? REASON_WORDS[row.reason as keyof typeof REASON_WORDS]
              : (row.reason ?? '')),
        ].map((cell) => escapeCsvCell(cell)),
      ].join(','),
    ),
  ]
  return `${lines.join('\r\n')}\r\n`
}

export interface ImportResultsStepProps {
  wizard: TransferImportWizardController
  /** Saves the result file; defaults to a browser download. */
  download?(fileName: string, body: Blob): void
  onDone?(): void
}

export function ImportResultsStep({
  wizard,
  download = downloadTransferFile,
  onDone,
}: ImportResultsStepProps) {
  const { results, job } = wizard
  const [preview, setPreview] = useState<TransferUndoResponse | null>(null)
  const [resolutions, setResolutions] = useState<
    Record<string, TransferUndoDecision>
  >({})
  const [undoError, setUndoError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  const expires = job ? transferUndoExpiresAt(job) : null
  const undone = job?.status === 'undone'

  const openUndo = async () => {
    if (!job) return
    setUndoError(null)
    try {
      setPreview(await wizard.client.undo({ jobId: job.id, mode: 'preview' }))
      setResolutions({})
    } catch (reason) {
      setUndoError(
        reason instanceof Error
          ? reason.message
          : 'Undo could not be prepared.',
      )
    }
  }
  const runUndo = async () => {
    if (!job) return
    setUndoing(true)
    setUndoError(null)
    try {
      // Undo runs chunk by chunk; each call carries on where the last stopped.
      let step = await wizard.client.undo({
        jobId: job.id,
        mode: 'apply',
        decisions: resolutions,
        otherwise: 'keep',
      })
      while (!step.done) {
        step = await wizard.client.undo({
          jobId: job.id,
          mode: 'apply',
          decisions: resolutions,
          otherwise: 'keep',
        })
      }
      setPreview(null)
      await wizard.refreshResults()
    } catch (reason) {
      setUndoError(reason instanceof Error ? reason.message : 'Undo failed.')
    } finally {
      setUndoing(false)
    }
  }
  const unresolved = preview
    ? preview.conflicts.filter((conflict) => !resolutions[conflict.recordId])
        .length
    : 0

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardHeader
          title={undone ? 'This import was undone' : 'Import finished'}
          action={
            results ? (
              <Button
                onClick={() =>
                  download(
                    `${job?.fileName?.replace(/\.[^.]+$/, '') || 'import'}-results.csv`,
                    new Blob([transferResultsCsv(results.rows)], {
                      type: 'text/csv',
                    }),
                  )
                }
              >
                Download results
              </Button>
            ) : undefined
          }
        />
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
            aria-label="Results"
          >
            {OUTCOMES.map((outcome) => (
              <Chip
                key={outcome}
                variant="outlined"
                color={
                  outcome === 'failed' && results?.summary.failed
                    ? 'error'
                    : 'default'
                }
                label={`${OUTCOME_WORDS[outcome]}: ${(results?.summary[outcome] ?? 0).toLocaleString()}`}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
      {!undone ? (
        <Card variant="outlined">
          <CardHeader
            title="Undo"
            subheader={
              wizard.undoOpen && expires
                ? `Puts back what this import changed and removes what it created, until ${new Date(expires).toLocaleString()}.`
                : 'The undo window for this import has closed.'
            }
            action={
              <Button
                color="warning"
                disabled={!wizard.undoOpen}
                onClick={() => void openUndo()}
              >
                Undo import
              </Button>
            }
          />
          {undoError && !preview ? (
            <CardContent>
              <Alert severity="error">{undoError}</Alert>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
      {onDone ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={onDone}>
            Done
          </Button>
        </Stack>
      ) : null}
      <Dialog
        open={Boolean(preview)}
        onClose={undoing ? undefined : () => setPreview(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="transfer-undo-title"
      >
        <DialogTitle id="transfer-undo-title">Undo this import?</DialogTitle>
        <DialogContent dividers>
          {preview ? (
            <Stack spacing={2}>
              {undoError ? <Alert severity="error">{undoError}</Alert> : null}
              <Typography variant="body2">
                {countOf(preview.counts.restore, 'record')} put back as{' '}
                {preview.counts.restore === 1 ? 'it was' : 'they were'} ·{' '}
                {countOf(preview.counts.delete, 'created record')} removed
                {preview.counts.nothing
                  ? ` · ${countOf(preview.counts.nothing, 'record')} already back or gone`
                  : ''}
                .
              </Typography>
              {preview.conflicts.length ? (
                <Alert severity="warning">
                  {countOf(preview.conflicts.length, 'record')}{' '}
                  {preview.conflicts.length === 1 ? 'was' : 'were'} edited after
                  the import. Choose for each: keep it as it is now, or undo
                  anyway.
                </Alert>
              ) : null}
              {preview.conflicts.map((conflict) => (
                <Stack
                  key={conflict.recordId}
                  spacing={0.5}
                  role="group"
                  aria-label={conflict.label ?? conflict.recordId}
                >
                  <Typography variant="subtitle2">
                    {conflict.label ?? conflict.recordId}
                  </Typography>
                  {conflict.fields.map((fieldId) => (
                    <Typography
                      key={fieldId}
                      variant="body2"
                      color="text.secondary"
                    >
                      {wizard.fieldLabel(fieldId)}: now “
                      {displayTransferValue(conflict.current[fieldId])}”
                      {conflict.action === 'updated' &&
                      fieldId in conflict.restore
                        ? `, undo puts back “${displayTransferValue(conflict.restore[fieldId])}”`
                        : ', undo removes the record'}
                    </Typography>
                  ))}
                  <RadioGroup
                    row
                    aria-label={`Undo ${conflict.label ?? conflict.recordId}`}
                    value={resolutions[conflict.recordId] ?? ''}
                    onChange={(event) =>
                      setResolutions((current) => ({
                        ...current,
                        [conflict.recordId]: event.target
                          .value as TransferUndoDecision,
                      }))
                    }
                  >
                    <FormControlLabel
                      value="keep"
                      control={<Radio />}
                      label="Keep it as it is now"
                    />
                    <FormControlLabel
                      value="revert"
                      control={<Radio />}
                      label="Undo it anyway"
                    />
                  </RadioGroup>
                </Stack>
              ))}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)} disabled={undoing}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            disabled={undoing || unresolved > 0}
            onClick={() => void runUndo()}
          >
            {unresolved > 0
              ? `Choose for ${countOf(unresolved, 'record')}`
              : 'Undo import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default ImportResultsStep
