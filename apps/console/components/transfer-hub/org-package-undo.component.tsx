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
 * Undoing a workspace package import (AGL-3535): what undo would do, asked
 * first, and each item edited since the import listed with a choice — keep
 * the edit or undo it too. Nothing edited since is reverted unless the
 * person says so.
 */

import { TransferChoiceSelect, countOf } from '@aglyn/aglyn-transfer-ui'
import type { TransferPackageUndoPlanResponse, TransferUndoDecision } from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { Alert, Button, CircularProgress, Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { TransferHubClient } from '../../utils/transfer-hub-client'
import { errorText } from './hub-dialog.component'

export interface OrgPackageUndoProps {
  client: TransferHubClient
  jobId: string
  /** Each resource's label, by key. */
  labels?: Readonly<Record<string, string>>
  onUndone?(): void
}

const UNDO_CHOICES = [
  { value: 'keep' as const, label: 'Keep the edit', description: 'Leave it as it is now.' },
  { value: 'revert' as const, label: 'Undo it too', description: 'Put it back, or delete it, as undo would.' },
]

export function OrgPackageUndo({ client, jobId, labels, onUndone }: OrgPackageUndoProps) {
  const [plan, setPlan] = useState<TransferPackageUndoPlanResponse | null>(null)
  const [choices, setChoices] = useState<Record<string, TransferUndoDecision>>({})
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    client
      .undoPlan(jobId)
      .then((answer) => active && setPlan(answer))
      .catch((caught) => active && setError(errorText(caught)))
    return () => {
      active = false
    }
  }, [client, jobId])

  const undo = async () => {
    setBusy(true)
    setError(null)
    try {
      const answer = await client.undo(jobId, { decisions: choices, otherwise: 'keep' })
      const { counts } = answer.undo
      setDone(
        `Undone: ${countOf(counts.restore, 'item')} put back, ${countOf(counts.delete, 'item')} removed` +
          (counts.conflict ? `, ${countOf(counts.conflict, 'item')} kept as edited.` : '.'),
      )
      onUndone?.()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Alert severity="success">{done}</Alert>
  if (!plan) return error ? <Alert severity="error">{error}</Alert> : <CircularProgress size={24} />
  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="body2">
        {`Undo puts back ${countOf(plan.counts.restore, 'replaced item')} and removes ${countOf(plan.counts.delete, 'created item')}.` +
          (plan.counts.nothing
            ? ` ${countOf(plan.counts.nothing, 'item')} ${plan.counts.nothing === 1 ? 'needs' : 'need'} nothing: already back, or gone.`
            : '')}
      </Typography>
      {plan.conflicts.length > 0 && (
        <>
          <Alert severity="warning">
            {`${countOf(plan.conflicts.length, 'item')} changed since the import. Each is kept as it is unless you choose to undo it too.`}
          </Alert>
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Item'}</TableCell>
                <TableCell>{'What undo would do'}</TableCell>
                <TableCell>{'Choice'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plan.conflicts.map((conflict) => (
                <TableRow key={conflict.key}>
                  <TableCell>
                    <Typography variant="body2">{conflict.name ?? conflict.id}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {labels?.[conflict.resource] ?? conflict.resource}
                    </Typography>
                  </TableCell>
                  <TableCell>{conflict.action === 'created' ? 'Delete it' : 'Put back what it held'}</TableCell>
                  <TableCell>
                    <TransferChoiceSelect
                      label="Choice"
                      hideLabel
                      value={choices[conflict.id] ?? 'keep'}
                      options={UNDO_CHOICES}
                      onChange={(value) => setChoices((current) => ({ ...current, [conflict.id]: value }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        </>
      )}
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="contained" color="warning" onClick={undo} disabled={busy}>
          {busy ? 'Undoing…' : 'Undo the import'}
        </Button>
      </Stack>
    </Stack>
  )
}

export default OrgPackageUndo
