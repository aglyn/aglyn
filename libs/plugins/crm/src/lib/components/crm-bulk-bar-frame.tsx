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
 * THE CHROME EVERY BULK BAR SHARES (AGL-2621).
 *
 * The contacts bar (AGL-2603) settled how a bar over a table reads: it
 * appears only for a selection and says how many, its actions sit in one
 * wrapping row with Clear at the end, and whatever the last action could
 * not do is listed by name in an alert under it until dismissed. Companies,
 * deals and tasks each have a bar now, and each would be the same frame
 * around different buttons, so the frame lives here and each bar supplies
 * its actions and its dialog's field.
 */

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import type { CrmBulkSkip } from '../model/crm-bulk-writes'

/** How a bar names its rows — "1 company", "3 deals". */
export interface CrmBulkNoun {
  singular: string
  plural: string
}

/** "1 company" or "3 companies". */
export function countNoun(count: number, noun: CrmBulkNoun): string {
  return count === 1
    ? `1 ${noun.singular}`
    : `${count.toLocaleString()} ${noun.plural}`
}

export interface CrmBulkBarFrameProps {
  count: number
  noun: CrmBulkNoun
  busy: boolean
  onClear: () => void
  /** What the last action could not do, by name, until dismissed. */
  report: readonly CrmBulkSkip[] | null
  onDismissReport: () => void
  /** The action buttons, in order. */
  children: ReactNode
  /** Anything the bar mounts beside itself — a dialog, a confirm. */
  extras?: ReactNode
}

export function CrmBulkBarFrame(props: CrmBulkBarFrameProps) {
  const { count, noun, busy, onClear, report, onDismissReport, children, extras } =
    props
  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 1,
          p: 1,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Typography variant="body2" sx={{ mr: 1 }}>
          {`${count.toLocaleString()} selected`}
        </Typography>
        {children}
        <Button size="small" disabled={busy} onClick={onClear}>
          {'Clear'}
        </Button>
      </Stack>
      {report ? (
        <Alert severity="warning" onClose={onDismissReport}>
          <Typography variant="body2">
            {report.length === 1
              ? `One ${noun.singular} was not changed:`
              : `${report.length} ${noun.plural} were not changed:`}
          </Typography>
          {report.map((row) => (
            <Typography key={`${row.label}:${row.reason}`} variant="caption" component="div">
              {`${row.label} — ${row.reason}`}
            </Typography>
          ))}
        </Alert>
      ) : null}
      {extras}
    </Stack>
  )
}
CrmBulkBarFrame.displayName = 'CrmBulkBarFrame'

export interface CrmBulkValueDialogProps {
  open: boolean
  title: string
  count: number
  noun: CrmBulkNoun
  busy: boolean
  /** Whether Apply may be pressed — the field has a value the action can use. */
  canApply: boolean
  applyLabel?: string
  onClose: () => void
  onApply: () => void
  children: ReactNode
}

/**
 * The one small dialog a value-taking action opens: what it applies to,
 * the field, Cancel and Apply. Closing is refused while the action runs.
 */
export function CrmBulkValueDialog(props: CrmBulkValueDialogProps) {
  const { open, title, count, noun, busy, canApply, applyLabel, onClose, onApply, children } =
    props
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {`Applies to ${countNoun(count, noun)} selected.`}
          </Typography>
          {children}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" disabled={busy || !canApply} onClick={onApply}>
          {applyLabel ?? 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CrmBulkValueDialog.displayName = 'CrmBulkValueDialog'
