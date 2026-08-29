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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import { useStaffRole } from '../hooks/use-is-staff'
import {
  checkRefundAuthority,
  describeRefundAllowance,
  formatRefundCap,
  refundCapCentsForRole,
} from '../constants/refund-authority'
import {
  normalizeRefundReason,
  REFUND_NOTE_MAX,
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
  refundReasonNeedsNote,
  type RefundReasonCode,
} from '../constants/refund-reasons'

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

/**
 * What the route says THIS operator may refund, reported with the charges.
 *
 * `windowCents` is null when the ledger could not be read. Rendered as an
 * explicit "could not read your remaining allowance" rather than as a full
 * one: the whole point of stating the allowance up front is that a support
 * engineer is never refused after filling in the form, and an optimistic
 * number would produce exactly that.
 */
export interface RefundAuthorityInfo {
  role: string
  authority: 'super' | 'capped'
  perRefundCapCents: number | null
  windowCapCents: number | null
  windowCents: number | null
  windowCount: number | null
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
 *  - STATES THE OPERATOR'S OWN CEILING FIRST. Issuing is no longer `super`
 *    -only: support may refund up to a cap and escalates above it
 *    (AGL-2486). That makes the boundary amount-dependent, so it has to be
 *    readable BEFORE a charge is picked — the allowance sentence sits above
 *    the form, the charge list says what the cap means for each charge, and
 *    the Amount field carries the refusal when one applies. A support
 *    engineer should never fill this in and then be told no.
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
  const [moreCharges, setMoreCharges] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasCustomer, setHasCustomer] = useState(true)
  const [authorityInfo, setAuthorityInfo] = useState<RefundAuthorityInfo | null>(
    null,
  )
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
      // Refreshed after every settled refund, so the remaining daily
      // allowance shrinks as it is spent instead of restating a constant.
      setAuthorityInfo((payload.authority as RefundAuthorityInfo) ?? null)
      // A Stripe failure is NOT an empty charge list (AGL-940). Kept apart so
      // the card never says "nothing to refund" about an org whose charges it
      // could not read — that sentence would send staff away satisfied.
      setLoadError(payload.stripeError ?? null)
      setCharges(payload.charges ?? [])
      // Stripe's own `has_more`, not a comparison against the page size —
      // which is wrong in exactly the case that matters, an organization
      // with precisely as many charges as the route asks for.
      setMoreCharges(payload.hasMore === true)
    } catch (error: any) {
      console.error(error)
      setCharges(null)
      setMoreCharges(false)
      setLoadError(error?.message ?? 'Could not load charges')
    }
  }, [user, orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*==========================================
   * THE TABLE PAGES; THE PICKER DOES NOT.
   *
   * The rows below are a client slice of the window the route already read,
   * because nothing on this card is derived from the page — the charge
   * PICKER, the selected charge and the remaining-refundable arithmetic all
   * read the full array. Slicing the picker would hide a refundable charge
   * behind a control the operator cannot page.
   *=========================================*/
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleCharges = useMemo(
    () => (charges ?? []).slice(page * pageSize, page * pageSize + pageSize),
    [charges, page, pageSize],
  )
  // A fresh organization starts at page one: an out-of-range page renders as
  // an empty table, which on this card reads as "nothing to refund".
  useEffect(() => {
    setPage(0)
  }, [orgId])

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

  // The operator's own ceiling, from the SAME predicate the route refuses
  // with. The role comes from the route's response when it has arrived and
  // from the claim hook until then, so the boundary is stated on first paint
  // rather than after a round trip.
  const claimRole = useStaffRole()
  const effectiveRole = authorityInfo?.role ?? claimRole ?? undefined
  const roleResolved = Boolean(authorityInfo) || claimRole !== null
  const perRefundCapCents = refundCapCentsForRole(effectiveRole)
  const windowSpentCents = authorityInfo?.windowCents ?? 0
  // Explicit null test, not falsiness: `0` spent is a real, common reading
  // and must not be confused with "we could not read it" (strictNullChecks is
  // off repo-wide, so this is the only thing keeping the two apart).
  const windowUnreadable =
    authorityInfo != null &&
    authorityInfo.authority !== 'super' &&
    authorityInfo.windowCents == null
  const capVerdict =
    askedCents === null
      ? null
      : checkRefundAuthority({
          role: effectiveRole,
          amountCents: askedCents,
          windowCents: windowSpentCents,
          windowCount: authorityInfo?.windowCount ?? 0,
        })
  const overAllowance = Boolean(capVerdict && !capVerdict.allowed)

  const canSubmit =
    Boolean(selected) &&
    remaining > 0 &&
    !amountInvalid &&
    askedCents !== null &&
    askedCents > 0 &&
    reasonComplete &&
    // Never blocked while the role is still resolving — that would flash a
    // dead button at every operator on every page load, the flicker
    // `useStaffRole`'s null state exists to prevent.
    !(roleResolved && overAllowance) &&
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
        `This cannot be undone from ${PLATFORM_BRAND_NAME}, and it is audited.`,
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
      // The STAFF refunds runbook, not the customer billing page (AGL-2486).
      // `billing` is what a workspace owner reads about their own invoices;
      // it can never explain the super-only bar, the disputed-charge refusal
      // or the audit row, because none of those are customer-facing. Sending
      // an operator there for guidance on a money-moving action they are
      // about to take was the wrong destination, not merely a vague one.
      help={docsHelp('refunds', {
        anchor: '#issuing-a-refund',
        excerpt:
          `Refund one of the organization's Stripe charges, in full or in part, without leaving ${PLATFORM_BRAND_NAME}. Requires a reason and is audited.`,
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Alert severity="warning">
          {`A refund moves real money and cannot be undone from ${PLATFORM_BRAND_NAME}. ` +
            'Stripe does not return its processing fee on a refund, and a ' +
            'disputed charge costs more still — a refund is a loss, not a ' +
            'reversal. Audited to adminAudit with the reason you pick.'}
        </Alert>
        {/* THE BOUNDARY, BEFORE THE FORM (AGL-2486). Stated here rather than
            discovered on submit: support may refund up to a cap and escalate
            above it, and an operator who fills in a charge, an amount and a
            reason only to be told their role cannot do it has been made to
            do the work twice. Rendered only once the role has resolved, so
            it never flashes the wrong allowance. */}
        {roleResolved ? (
          <Alert severity="info">
            {describeRefundAllowance(effectiveRole, windowSpentCents)}
            {windowUnreadable
              ? ' Your remaining 24-hour allowance could not be read just now, ' +
                'so the figure above assumes none of it is spent — the server ' +
                'will still refuse a refund past it.'
              : ''}
          </Alert>
        ) : null}
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
                {visibleCharges.map((charge) => {
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
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visibleCharges.length}
              // The charges this card HOLDS. Deliberately not a claim about
              // the organization's trading: `hasMore` is what says the window
              // is short, and the notice under the footer is where it is said
              // in words, because "nothing left to refund" is the wrong thing
              // for an operator to conclude from a truncated list.
              count={charges.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
            {moreCharges ? (
              <Alert severity="info">
                {'This organization has older charges than the ones listed ' +
                  'here. Refund them from the Stripe dashboard.'}
              </Alert>
            ) : null}
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
                .map((charge) => {
                  const left = remainingRefundableCents(charge)
                  // Named on the row an operator is choosing FROM, not only
                  // in the amount field they reach afterwards. A capped role
                  // can still refund a partial off a large charge, so the
                  // option stays selectable — it says what the limit means
                  // for this charge rather than hiding it.
                  const capped =
                    perRefundCapCents !== null && left > perRefundCapCents
                  return (
                    <MenuItem key={charge.id} value={charge.id}>
                      {`${charge.invoiceNumber ?? charge.id} — ${money(
                        left,
                        charge.currency,
                      )} refundable` +
                        (capped
                          ? ` (your role can refund ${formatRefundCap(
                              perRefundCapCents,
                            )} of it)`
                          : '')}
                    </MenuItem>
                  )
                })}
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
              error={amountInvalid || (roleResolved && overAllowance)}
              helperText={
                amountInvalid
                  ? `Enter an amount between $0.01 and ${money(remaining, selected?.currency ?? 'usd')}.`
                  : roleResolved && overAllowance
                    ? // The route's own refusal sentence, from the shared
                      // predicate — so the console can never disagree with
                      // what the server would have said.
                      capVerdict?.error
                    : perRefundCapCents !== null
                      ? `Leave blank to refund everything still refundable on the charge, up to your ${formatRefundCap(
                          perRefundCapCents,
                        )} limit.`
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
              {/* No longer wrapped in `SuperStaffOnly` (AGL-2486). The gate
                  is no longer "which role are you" but "how much is this",
                  so a wrapper that disables on the role alone would refuse
                  every support refund including the ones that are now the
                  point. The reason for a blocked click lives on the Amount
                  field, where the amount that caused it is. */}
              <Button
                size="small"
                color="error"
                variant="contained"
                disabled={!canSubmit}
                onClick={() => void handleRefund()}
              >
                {busy ? 'Refunding…' : 'Refund…'}
              </Button>
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
