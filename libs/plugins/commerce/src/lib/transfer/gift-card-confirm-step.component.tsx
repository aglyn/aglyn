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

import type { PlannedTransferRow, TransferPlanRowsResponse } from '@aglyn/aglyn/data-transfer'
import type { TransferWizardStepProps } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { giftCardMoney, typedDollarsToCents, type GiftCardPlannedRow, type GiftCardRowPlan } from './records-transfer'

/**
 * THE GIFT CARD IMPORT'S CONFIRM STEP (AGL-3551), after Conflicts: every
 * card the dry run will issue, with its code and value, and the total typed
 * back. The step is complete only when the typed total is exactly the total
 * of the cards listed; the server reads the same answer from `extras` and
 * issues nothing unless it is the total it counted itself.
 *
 * The answer also says whether each recipient is emailed their code. It is
 * off by default: cards moved from another platform carry codes shoppers
 * already hold.
 */

/** The step's answer, as it rides in `extras`. */
interface ConfirmAnswer {
  typed: string
  totalCents?: number
  email: boolean
}

const PAGE = 25
/** The plan route's largest page. */
const ROWS_PAGE = 200

function readAnswer(value: unknown): ConfirmAnswer {
  const answer = (value && typeof value === 'object' ? value : {}) as Partial<ConfirmAnswer>
  return { typed: String(answer.typed ?? ''), email: answer.email === true }
}

export function GiftCardConfirmStep(props: TransferWizardStepProps) {
  const { orgId, jobId, value, setValue, setComplete } = props
  const { data: user } = useUser()
  const answer = readAnswer(value)
  const [cards, setCards] = useState<GiftCardRowPlan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  // Every card the dry run issues, page by page from the stored plan.
  useEffect(() => {
    if (!user || !orgId || !jobId) return undefined
    let live = true
    void (async () => {
      try {
        const found: GiftCardRowPlan[] = []
        let offset: number | null = 0
        while (offset !== null) {
          const response = await authorizedFetch(user, '/api/transfer/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId, jobId, action: 'rows', offset, limit: ROWS_PAGE, verdicts: ['create'] }),
          })
          const payload = (await response.json().catch(() => ({}))) as Partial<TransferPlanRowsResponse> & { error?: string }
          if (!response.ok || !payload.rows) throw new Error(payload.error ?? 'The cards could not be read.')
          for (const row of payload.rows.rows as PlannedTransferRow[]) {
            const card = (row as GiftCardPlannedRow).giftCard
            if (card && !card.problem) found.push(card)
          }
          offset = payload.rows.next
        }
        if (live) setCards(found)
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : 'The cards could not be read.')
      }
    })()
    return () => {
      live = false
    }
  }, [user, orgId, jobId])

  const totalCents = useMemo(() => (cards ?? []).reduce((sum, card) => sum + card.amountCents, 0), [cards])
  const typedCents = typedDollarsToCents(answer.typed)
  const matches = cards !== null && typedCents === totalCents

  useEffect(() => {
    // Nothing to issue needs no total: the review says why each row is held.
    setComplete(cards !== null && (cards.length === 0 || matches))
  }, [cards, matches, setComplete])

  const save = (next: Partial<ConfirmAnswer>) => {
    const merged = { ...answer, ...next }
    const cents = typedDollarsToCents(merged.typed)
    setValue({ typed: merged.typed, email: merged.email, ...(cents !== null && cents > 0 ? { totalCents: cents } : {}) })
  }

  if (error) return <Alert severity="error">{error}</Alert>
  if (cards === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Reading the cards this import issues…'}
      </Typography>
    )
  }
  if (!cards.length) {
    return (
      <Alert severity="info">
        {'No card in this file can be issued. The review lists every row with the reason.'}
      </Alert>
    )
  }

  const madeCodes = cards.filter((card) => card.newCode || card.madeCode).length
  const shown = cards.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <Stack spacing={2}>
      <Alert severity="warning">
        <AlertTitle>
          {`${cards.length.toLocaleString('en-US')} gift card${cards.length === 1 ? '' : 's'} worth ${giftCardMoney(totalCents)}`}
        </AlertTitle>
        {'Each card is spendable money the moment it is issued. Check every code and value, then type the total ' +
          'to issue them.'}
      </Alert>
      <ScrollTable size="small" aria-label="Gift cards this import issues">
        <TableHead>
          <TableRow>
            <TableCell>Code</TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell>Recipient</TableCell>
            <TableCell>Note</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {shown.map((card) => (
            <TableRow key={card.code}>
              <TableCell>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {card.code}
                  </Typography>
                  {card.newCode ? <Chip size="small" label="New code: the file's was taken" /> : null}
                  {card.madeCode ? <Chip size="small" label="New code" /> : null}
                </Stack>
              </TableCell>
              <TableCell align="right">{giftCardMoney(card.amountCents)}</TableCell>
              <TableCell>{card.recipientEmail ?? '—'}</TableCell>
              <TableCell>{card.note ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ScrollTable>
      {cards.length > PAGE ? (
        <TablePagination
          component="div"
          count={cards.length}
          page={page}
          onPageChange={(_event, next) => setPage(next)}
          rowsPerPage={PAGE}
          rowsPerPageOptions={[PAGE]}
        />
      ) : null}
      <TextField
        label="Type the total value to issue these cards"
        value={answer.typed}
        onChange={(event) => save({ typed: event.target.value })}
        error={Boolean(answer.typed) && !matches}
        helperText={
          answer.typed && !matches
            ? `That is not the total. These cards add up to ${giftCardMoney(totalCents)}.`
            : `Type ${giftCardMoney(totalCents)}.`
        }
        autoComplete="off"
        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
      />
      <FormControlLabel
        control={<Checkbox checked={answer.email} onChange={(event) => save({ email: event.target.checked })} />}
        label={
          <Typography variant="body2">
            {'Email each recipient their code as the card is issued.'}
            {madeCodes
              ? ` ${madeCodes.toLocaleString('en-US')} card${madeCodes === 1 ? ' has' : 's have'} a new code nobody holds yet: email them, or share the codes yourself.`
              : ' Leave this off when the shoppers already hold these codes.'}
          </Typography>
        }
      />
    </Stack>
  )
}
GiftCardConfirmStep.displayName = 'GiftCardConfirmStep'

export default GiftCardConfirmStep
