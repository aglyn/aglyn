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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import {
  normalizeRefundReason,
  REFUND_NOTE_MAX,
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
  refundReasonNeedsNote,
  type RefundReasonCode,
} from '../constants/refund-reasons'
import { SuperStaffOnly } from './staff-super-only.component'

/** One refundable Stripe charge, as `/api/admin/org-refund` describes it. */
export interface RefundableCharge {
  id: string
  amountCents: number
  refundedCents: number
  currency: string
  created: string | null
  description: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  disputed: boolean
  paid: boolean
  /** What Stripe kept on the original charge and does not return. */
  feeCents: number
}

const money = (cents: number, currency: string): string =>
  `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`

/** Dollars in the text field → integer cents, or null for an unusable entry. */
export function parseRefundAmountCents(text: string): number | null {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length === 0) return null
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

/**
 * What is actually left to refund on a charge.
 *
 * A helper rather than an inline subtraction because both the amount default
 * and the over-refund guard read it, and a disagreement between those two is
 * a button that offers an amount the server will refuse.
 */
export function remainingRefundableCents(charge: RefundableCharge): number {
  return Math.max(
    0,
    Number(charge?.amountCents ?? 0) - Number(charge?.refundedCents ?? 0),
  )
}

export interface StaffOrgRefundCardProps {
  orgId: string
  /** Bumped after a settled refund so the page's billing panels re-read. */
  onRefunded?: () => void
}

/**
 * Issue a refund against one of the org's Stripe charges (AGL-2486).
 *
 * Refunds could previously only be done in the Stripe dashboard. Staff had
 * every other money-adjacent lever on this page — plan override, discount,
 * enterprise provisioning — and for the one that hands money back they left
 * Aglyn entirely, which cost the `adminAudit` row and the reason with it.
 *
 * THREE things this deliberately does before it moves anything:
 *
 *  - Names what will be refunded. The confirmation restates the amount, the
 *    currency, the charge and the invoice it belongs to. A confirmation that
 *    only says "are you sure" confirms nothing an operator can check.
 *  - Requires a reason, with the same code+note shape as the override dialog
 *    (AGL-1652), and the route refuses without one. The client gate exists so
 *    the button can be disabled with something actionable; the server gate is
 *    the one that holds.
 *  - States the cost. Stripe does NOT return its processing fee on a refund,
 *    and a dispute costs more still — the Pricing Decision Log settled that a
 *    refund is a loss and always was. The real fee from the charge's balance
 *    transaction is shown, so the operator sees the actual number rather than
 *    a general warning they will learn to skip.
 */
export default function StaffOrgRefundCard({
  orgId,
  onRefunded,
}: StaffOrgRefundCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [charges, setCharges] = useState<RefundableCharge[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasCustomer, setHasCustomer] = useState(true)
  const [chargeId, setChargeId] = useState('')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState<'' | RefundReasonCode>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken || !orgId) return
    try {
      const response = await fetch(
        `/api/admin/org-refund?orgId=${encodeURIComponent(orgId)}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Load failed (${response.status})`)
      }
      setHasCustomer(payload.hasCustomer !== false)
      // A Stripe failure is NOT an empty charge list (AGL-940). Kept apart so
      // the card never says "nothing to refund" about an org whose charges it
      // could not read — that sentence would send staff away satisfied.
      setLoadError(payload.stripeError ?? null)
      setCharges(payload.charges ?? [])
    } catch (error: any) {
      console.error(error)
      setCharges(null)
      setLoadError(error?.message ?? 'Could not load charges')
    }
  }, [user, orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = (charges ?? []).find((charge) => charge.id === chargeId)
  const remaining = selected ? remainingRefundableCents(selected) : 0
  // An empty box means "all of what is left", which is the common case and
  // the one an operator should not have to retype. `0` typed explicitly is
  // still rejected below — it is a real number, not an absence.
  const askedCents =
    amountText.trim().length === 0 ? remaining : parseRefundAmountCents(amountText)
  const amountInvalid =
    amountText.trim().length > 0 &&
    (askedCents === null || askedCents > remaining)
  const reasonComplete = normalizeRefundReason(reason, note) !== null
  const canSubmit =
    Boolean(selected) &&
    remaining > 0 &&
    !amountInvalid &&
    askedCents !== null &&
    askedCents > 0 &&
    reasonComplete &&
    !busy

  const handleRefund = useCallback(async () => {
    if (!selected || askedCents === null) return
    const validated = normalizeRefundReason(reason, note)
    if (!validated) return
    const feeLine =
      selected.feeCents > 0
        ? `Stripe keeps the ${money(selected.feeCents, selected.currency)} ` +
          'processing fee on this charge either way — a refund is not a clean ' +
          'reversal, and it never was. '
        : 'Stripe does not return its processing fee on a refund, so this is ' +
          'not a clean reversal. '
    const confirmed = await confirm({
      title: `Refund ${money(askedCents, selected.currency)}?`,
      description:
        `${money(askedCents, selected.currency)} goes back to the customer ` +
        `from charge ${selected.id}` +
        (selected.invoiceNumber || selected.invoiceId
          ? ` (invoice ${selected.invoiceNumber ?? selected.invoiceId})` +
            '. '
          : '. ') +
        `That charge captured ${money(selected.amountCents, selected.currency)}` +
        (selected.refundedCents > 0
          ? `, of which ${money(selected.refundedCents, selected.currency)} is already refunded`
          : '') +
        '. ' +
        feeLine +
        `Reason: ${REFUND_REASON_LABELS[validated.reason]}. ` +
        'This cannot be undone from Aglyn, and it is audited.',
      confirmationText: `Refund ${money(askedCents, selected.currency)}`,
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/org-refund', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId,
          chargeId: selected.id,
          amountCents: askedCents,
          reason: validated.reason,
          note: validated.note,
          // Minted per ATTEMPT, not derived from the charge or the amount:
          // two partial refunds on one charge are two real refunds, and a
          // key that folded either in would swallow the second. It exists to
          // stop ONE attempt being sent twice — a double click, or a retry
          // after a lost response.
          idempotencyKey:
            (globalThis.crypto as any)?.randomUUID?.() ??
            `${Date.now()}-${Math.random()}`,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Refund failed (${response.status})`)
      }
      enqueueSnackbar(
        `Refunded ${money(payload.amountCents ?? askedCents, payload.currency ?? selected.currency)}` +
          (payload.feeRetainedCents > 0
            ? ` — Stripe kept the ${money(payload.feeRetainedCents, payload.currency ?? selected.currency)} fee`
            : ''),
        { variant: 'success' },
      )
      setAmountText('')
      setReason('')
      setNote('')
      await refresh()
      onRefunded?.()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'The refund failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    selected,
    askedCents,
    reason,
    note,
    confirm,
    user,
    orgId,
    enqueueSnackbar,
    refresh,
    onRefunded,
  ])

  return (
    <CardDisplay
      header={'Refund a charge'}
      help={docsHelp('billing', {
        anchor: '#payments',
        excerpt:
          "Refund one of the organization's Stripe charges, in full or in part, without leaving Aglyn. Requires a reason and is audited.",
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Alert severity="warning">
          {'A refund moves real money and cannot be undone from Aglyn. ' +
            'Stripe does not return its processing fee on a refund, and a ' +
            'disputed charge costs more still — a refund is a loss, not a ' +
            'reversal. Audited to adminAudit with the reason you pick.'}
        </Alert>
        {loadError ? (
          <Alert severity="warning">
            {`Couldn't read this organization's charges — this is not "nothing to refund". ${loadError}`}
          </Alert>
        ) : null}
        {charges == null && !loadError ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading charges…'}
          </Typography>
        ) : null}
        {charges != null && charges.length === 0 && !loadError ? (
          <Typography variant="body2" color="text.secondary">
            {hasCustomer
              ? 'No charges on this organization yet.'
              : 'This organization has never subscribed.'}
          </Typography>
        ) : null}
        {charges != null && charges.length > 0 ? (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Charge'}</TableCell>
                  <TableCell>{'Captured'}</TableCell>
                  <TableCell>{'Refundable'}</TableCell>
                  <TableCell>{'Stripe fee (kept)'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {charges.map((charge) => {
                  const left = remainingRefundableCents(charge)
                  return (
                    <TableRow
                      key={charge.id}
                      selected={charge.id === chargeId}
                      hover
                    >
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2">
                            {charge.invoiceNumber ?? charge.invoiceId ?? charge.id}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {charge.id}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {money(charge.amountCents, charge.currency)}
                      </TableCell>
                      <TableCell>
                        {charge.disputed
                          ? 'Disputed'
                          : !charge.paid
                            ? 'Not captured'
                            : money(left, charge.currency)}
                      </TableCell>
                      <TableCell>
                        {money(charge.feeCents, charge.currency)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <TextField
              select
              size="small"
              label="Charge to refund"
              value={chargeId}
              onChange={(event) => {
                setChargeId(event.target.value)
                setAmountText('')
              }}
              sx={{ maxWidth: 480 }}
            >
              <MenuItem value="">{'Pick a charge'}</MenuItem>
              {charges
                // A disputed or uncaptured charge is offered nowhere: the
                // route refuses both, and a control that lets staff select
                // one only to be refused has taught them the button is
                // unreliable rather than that the charge is.
                .filter(
                  (charge) =>
                    charge.paid &&
                    !charge.disputed &&
                    remainingRefundableCents(charge) > 0,
                )
                .map((charge) => (
                  <MenuItem key={charge.id} value={charge.id}>
                    {`${charge.invoiceNumber ?? charge.id} — ${money(
                      remainingRefundableCents(charge),
                      charge.currency,
                    )} refundable`}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              size="small"
              label="Amount"
              placeholder={
                selected
                  ? `Whole remainder (${money(remaining, selected.currency)})`
                  : 'Whole remainder'
              }
              value={amountText}
              disabled={!selected}
              error={amountInvalid}
              helperText={
                amountInvalid
                  ? `Enter an amount between $0.01 and ${money(remaining, selected?.currency ?? 'usd')}.`
                  : 'Leave blank to refund everything still refundable on the charge.'
              }
              onChange={(event) => setAmountText(event.target.value)}
              sx={{ maxWidth: 480 }}
            />
            <TextField
              select
              size="small"
              label="Reason"
              value={reason}
              error={Boolean(selected) && !reason}
              helperText={
                'Recorded on the audit row. Append-only — a reason not given ' +
                'now cannot be added later.'
              }
              onChange={(event) =>
                setReason(event.target.value as RefundReasonCode)
              }
              sx={{ maxWidth: 480 }}
            >
              {REFUND_REASON_CODES.map((code) => (
                <MenuItem key={code} value={code}>
                  {REFUND_REASON_LABELS[code]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={
                reason && refundReasonNeedsNote(reason as RefundReasonCode)
                  ? 'Note (required)'
                  : 'Note'
              }
              value={note}
              multiline
              minRows={2}
              error={
                Boolean(reason) &&
                refundReasonNeedsNote(reason as RefundReasonCode) &&
                note.trim().length === 0
              }
              slotProps={{ htmlInput: { maxLength: REFUND_NOTE_MAX } }}
              onChange={(event) => setNote(event.target.value)}
              sx={{ maxWidth: 480 }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <SuperStaffOnly>
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  disabled={!canSubmit}
                  onClick={() => void handleRefund()}
                >
                  {busy ? 'Refunding…' : 'Refund…'}
                </Button>
              </SuperStaffOnly>
              {selected ? (
                <Typography variant="caption" color="text.secondary">
                  {`${money(askedCents ?? 0, selected.currency)} of ${money(
                    remaining,
                    selected.currency,
                  )} refundable. Stripe keeps ${money(
                    selected.feeCents,
                    selected.currency,
                  )} in fees regardless.`}
                </Typography>
              ) : null}
            </Stack>
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StaffOrgRefundCard.displayName = 'StaffOrgRefundCard'
