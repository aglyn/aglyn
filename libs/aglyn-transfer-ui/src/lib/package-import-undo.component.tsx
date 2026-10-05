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
 * Undoing a package import (AGL-3534): what undo would do, asked first, and
 * each item edited since the import listed with a choice — keep the edit or
 * undo it too. Nothing is reverted over an edit unless the person says so.
 */

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import type {
  SitePackageClient,
  SitePackageUndoAnswer,
  SitePackageUndoChoice,
  SitePackageUndoPlan,
} from './site-package-client'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import { countOf } from './transfer-words'

export interface PackageImportUndoProps {
  client: SitePackageClient
  importId: string
  onUndone?(answer: SitePackageUndoAnswer): void
}

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'

export function PackageImportUndo({ client, importId, onUndone }: PackageImportUndoProps) {
  const [plan, setPlan] = useState<SitePackageUndoPlan | null>(null)
  const [choices, setChoices] = useState<Record<string, SitePackageUndoChoice>>({})
  const [done, setDone] = useState<SitePackageUndoAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Alert severity="success">
        {`Undone: ${countOf(done.reverted, 'item')} put back` +
          (done.kept ? `, ${countOf(done.kept, 'edited item')} left as edited.` : '.')}
      </Alert>
    )
  }

  if (!plan) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Button
          color="warning"
          disabled={busy}
          onClick={() => void run(async () => setPlan(await client.undoPlan(importId)))}
        >
          {busy ? 'Checking…' : 'Undo this import…'}
        </Button>
      </Stack>
    )
  }

  const conflicts = plan.conflicts
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {`Undo puts back ${countOf(plan.counts.restore, 'item')} the import replaced or merged into ` +
          `and removes ${countOf(plan.counts.delete, 'item')} it added.`}
      </Typography>
      {conflicts.length ? (
        <>
          <Alert severity="warning">
            {`${countOf(conflicts.length, 'item has', 'items have')} been edited since the import. ` +
              'Each is left as edited unless you choose to undo it too.'}
          </Alert>
          <ScrollTable size="small" aria-label="Items edited since the import">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell>Undoing it</TableCell>
                <TableCell>Choose</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {conflicts.map((conflict) => {
                const name = conflict.name || conflict.targetId
                return (
                  <TableRow key={conflict.key}>
                    <TableCell>
                      <Typography variant="body2">{name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {conflict.kind}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {conflict.step === 'restore' ? 'Puts back what it held before' : 'Removes it'}
                    </TableCell>
                    <TableCell>
                      <TransferChoiceSelect<SitePackageUndoChoice>
                        label={`Undo for ${name}`}
                        hideLabel
                        value={choices[conflict.key] ?? 'keep'}
                        onChange={(choice) => setChoices((current) => ({ ...current, [conflict.key]: choice }))}
                        options={[
                          { value: 'keep', label: 'Keep my edits' },
                          { value: 'revert', label: 'Undo it too' },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        </>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {busy ? <CircularProgress size={20} aria-label="Working" /> : null}
        <Button disabled={busy} onClick={() => setPlan(null)}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const decisions: Record<string, SitePackageUndoChoice> = {}
              for (const conflict of conflicts) decisions[conflict.key] = choices[conflict.key] ?? 'keep'
              const answer = await client.undo(importId, { decisions, otherwise: 'keep' })
              setDone(answer)
              onUndone?.(answer)
            })
          }
        >
          Undo import
        </Button>
      </Stack>
    </Stack>
  )
}

export default PackageImportUndo
