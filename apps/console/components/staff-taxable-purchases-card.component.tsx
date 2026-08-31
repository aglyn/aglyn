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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { COMPACT_FIELD_WIDTH } from '../constants/shared'
import {
  TAXABLE_PURCHASES_NOTE_MAX,
  type TaxablePurchasesEntry,
} from '../utils/taxable-purchases'

interface TaxablePurchasesBody {
  role: string
  period: string
  entry: TaxablePurchasesEntry | null
  limits: { noteMax: number }
}

/**
 * ITEM 3, TAXABLE PURCHASES — the one figure a person carries in by hand.
 *
 * Every other line of the return is summed from records this platform keeps.
 * Use tax on Aglyn's OWN purchases is not among them, so the return prints
 * `not computed` and the filer types a number into Webfile from the expense
 * records — with nothing in the product recording what they entered or why,
 * every quarter, forever.
 *
 * ## The zero this card must never print
 *
 * **An unentered period still reads `not computed`.** That is the whole
 * constraint, and a storage layer is the easiest place in the world to break
 * it: a `?? 0` anywhere between the document and the form turns "nobody has
 * derived this" into "the answer is nothing", and a zero arriving from storage
 * reads as derived in a way a blank never does. So there is no default, the
 * amount field starts empty for a period with no entry, and the route refuses
 * an empty amount rather than storing it as zero.
 *
 * An operator who genuinely means zero types `0.00`, and that is stored,
 * marked as entered, and audited — because somebody looked, and that is a
 * different fact from nobody having looked.
 *
 * ## Per period, and the period is the identity
 *
 * A quarter's purchases are not the next quarter's. The period is the storage
 * key, and this card re-reads on every period change and clears what was typed
 * — a figure half-entered for one quarter must not be submitted against
 * another by a later click, and a stale response must not paint under a new
 * heading.
 *
 * ## Reading is staff, writing is `super`
 *
 * Both enforced in `/api/admin/tax-purchases`, not here. A component that
 * hides a button is a suggestion; the form below is absent for a support
 * reader because there is nothing they can do with it, and the route would
 * refuse them anyway.
 */
export default function StaffTaxablePurchasesCard({
  period,
  onSaved,
}: {
  period: string
  /** Re-fetch the return, so the figures card shows the entry immediately. */
  onSaved?: () => void
}) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<TaxablePurchasesBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  /**
   * The signed-in user, read through a ref rather than a dependency.
   *
   * `useUser()` does not guarantee a stable object across renders, and this
   * card CLEARS what is typed when it reloads — so a `user` in the dependency
   * list makes the reset run on every render, blanking a half-entered figure
   * under the operator's hands. The reload is a function of the PERIOD; the
   * user is only how the request is signed.
   */
  const userRef = useRef(user)
  userRef.current = user

  const load = useCallback(async () => {
    if (!period) return
    try {
      const response = await authorizedFetch(
        userRef.current,
        `/api/admin/tax-purchases?period=${encodeURIComponent(period)}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error ?? 'Could not load the taxable purchases entry')
        setData(null)
        return
      }
      setError(null)
      /*
       * A response for a period that is no longer the selected one is
       * discarded. Two fetches in flight across a period change can land in
       * either order, and the late one would paint one quarter's figure under
       * another quarter's heading — which on this page is indistinguishable
       * from a real answer.
       */
      const body = payload as TaxablePurchasesBody
      if (body.period !== period) return
      setData(body)
      // The field starts from what is stored, or EMPTY when nothing is —
      // never `0.00`. See the note above.
      setAmount(body.entry ? body.entry.amountDollars : '')
      setNote('')
    } catch {
      setError('Could not load the taxable purchases entry')
      setData(null)
    }
  }, [period])

  useEffect(() => {
    // Cleared before the fetch, not after it: leaving the previous period's
    // figure in the box while the new one loads invites a save against the
    // wrong quarter.
    setData(null)
    setAmount('')
    setNote('')
    void load()
  }, [load])

  const entry = data?.entry ?? null
  const isSuper = data?.role === 'super'
  const noteMax = data?.limits?.noteMax ?? TAXABLE_PURCHASES_NOTE_MAX

  /**
   * Why the save is refused, or null.
   *
   * Named rather than left to a greyed button: the amount and the reason are
   * both required, and a disabled control with an asterisk beside it is a
   * dead end for somebody who has typed one of the two.
   */
  const blockedReason = !amount.trim()
    ? 'Enter the amount from the expense records. A blank field is not zero — ' +
      'an unentered period reports “not computed”, which stays the honest ' +
      'answer until somebody derives one.'
    : !note.trim()
      ? 'Add a reason above to save. It records which expense records the ' +
        'figure came from, and cannot be added afterwards.'
      : null

  const submit = async (method: 'PUT' | 'DELETE') => {
    if (busy || !data) return
    setBusy(true)
    try {
      const response = await authorizedFetch(
        userRef.current,
        '/api/admin/tax-purchases',
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            period,
            ...(method === 'PUT' ? { amount: amount.trim() } : {}),
            note: note.trim(),
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Could not save the entry', {
          variant: 'warning',
          allowDuplicate: true,
        })
        return
      }
      enqueueSnackbar(
        method === 'PUT'
          ? `Item 3 recorded for ${period}`
          : `Item 3 cleared for ${period} — it reads “not computed” again`,
        { variant: 'success', persist: false },
      )
      // Re-read rather than trusting the click: this card states the
      // post-condition, so what it shows is what is stored.
      await load()
      onSaved?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Item 3 — Taxable purchases'}
      help={docsHelp('salesTaxReturn', {
        anchor: '#taxable-purchases',
        excerpt:
          'Use tax on Aglyn’s own purchases. Not in platformRevenue and never ' +
          'computed here — entered per period from the expense records, and ' +
          'audited.',
      })}
      subheader={`Use tax on Aglyn’s own purchases, for ${period || 'the selected period'}.`}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !data ? (
        <Typography variant="body2">Loading…</Typography>
      ) : (
        <Stack spacing={2}>
          <Alert severity="info">
            {'This figure is not in platformRevenue and cannot be derived from ' +
              'it — that collection records sales. Entering it here does not ' +
              'compute it; it records what you filed and why, so the next ' +
              'quarter has the previous one to check against.'}
          </Alert>

          {/*
            THE STATE OF THE PERIOD, said in the same words the return says
            it. An operator reading "not computed" on the form and something
            else here would have two answers for one line.
          */}
          {entry ? (
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2">
                  {'Item 3 for this period: '}
                  <strong>{`$${entry.amountDollars}`}</strong>
                </Typography>
                <Chip size="small" color="primary" label="Entered, not computed" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {[
                  entry.enteredBy ? `Entered by ${entry.enteredBy}` : 'Entered',
                  entry.enteredAt ? `on ${entry.enteredAt.slice(0, 10)}` : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`Reason given: ${entry.note}`}
              </Typography>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2">
                {'Item 3 for this period: '}
                <strong>not computed</strong>
              </Typography>
              <Chip size="small" variant="outlined" label="Nobody has entered one" />
            </Stack>
          )}

          {isSuper ? (
            <Stack spacing={2}>
              <TextField
                label="Taxable purchases (USD)"
                size="small"
                value={amount}
                disabled={busy}
                onChange={(event) => setAmount(event.target.value)}
                sx={{ width: COMPACT_FIELD_WIDTH }}
                placeholder="1234.56"
                helperText="Dollars and cents. Blank is not zero."
              />
              <TextField
                label="Why (audited)"
                size="small"
                fullWidth
                required
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                placeholder="From the Q4 expense ledger, taxable purchases tab"
                slotProps={{ htmlInput: { maxLength: noteMax } }}
              />
              {blockedReason ? (
                <Typography variant="caption" color="text.secondary">
                  {blockedReason}
                </Typography>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={() => void submit('PUT')}
                  disabled={busy || !amount.trim() || !note.trim()}
                >
                  {entry ? 'Update Item 3' : 'Record Item 3'}
                </Button>
                <Button
                  color="warning"
                  onClick={() => void submit('DELETE')}
                  disabled={busy || !entry || !note.trim()}
                >
                  Clear — back to “not computed”
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {'Every change is written to adminAudit with the figure before, ' +
                  'the figure after and the reason above. The figure is ' +
                  'recorded because it goes onto a public filing — unlike a ' +
                  'registration number, which never appears in an audit row.'}
              </Typography>
            </Stack>
          ) : (
            <Alert severity="info">
              <AlertTitle>{'Entering this needs the super staff role'}</AlertTitle>
              {'The same bar as where the platform files, and for the same ' +
                'reason: this number goes onto a return signed under penalty ' +
                'of perjury.'}
            </Alert>
          )}
        </Stack>
      )}
    </CardDisplay>
  )
}
StaffTaxablePurchasesCard.displayName = 'StaffTaxablePurchasesCard'
