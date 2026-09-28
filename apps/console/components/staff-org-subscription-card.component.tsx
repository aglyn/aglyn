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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
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
  normalizeSubscriptionCancelReason,
  SUBSCRIPTION_CANCEL_NOTE_MAX,
  SUBSCRIPTION_CANCEL_REASON_CODES,
  SUBSCRIPTION_CANCEL_REASON_LABELS,
  type SubscriptionCancelReasonCode,
  type SubscriptionCancelWhen,
} from '../constants/subscription-cancel'
import { SuperStaffOnly } from './staff-super-only.component'

/**
 * The card's fragment on the staff org page: what a Stripe fraud signal's
 * abuse-queue row links to (AGL-3356, `staffSubscriptionCardPath`).
 */
export const STAFF_SUBSCRIPTION_CARD_ID = 'subscription'

/** One subscription, as `/api/admin/billing/cancel-subscription` describes it. */
export interface StaffSubscriptionRow {
  id: string
  status: string
  plan: string | null
  priceId: string | null
  interval: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  canceledAt: string | null
  currentPeriodEnd: string | null
  cancellationComment: string | null
  terminal: boolean
}

/** One subscription's step in a cancellation, read back after the write. */
export interface SubscriptionCancelStepRow {
  id: string
  outcome: string
  error: string | null
  verified: StaffSubscriptionRow | null
  confirmed: boolean
}

const dateOf = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—'

/**
 * What the renewal column says. A live subscription renews; one set to end
 * at the period end does not, and saying "renews" about it is the mistake an
 * operator would act on.
 */
export function describeRenewal(row: StaffSubscriptionRow): string {
  if (row.terminal) {
    return row.canceledAt ? `Ended ${dateOf(row.canceledAt)}` : 'Ended'
  }
  if (row.cancelAtPeriodEnd) {
    return `Ends ${dateOf(row.cancelAt ?? row.currentPeriodEnd)} — no renewal`
  }
  return row.currentPeriodEnd ? `Renews ${dateOf(row.currentPeriodEnd)}` : '—'
}

/** One line per subscription for the result panel and the snackbar. */
export function describeCancelStep(step: SubscriptionCancelStepRow): string {
  const status = step.verified
    ? `${step.verified.status}${
        step.verified.cancelAtPeriodEnd && !step.verified.terminal
          ? ', ends at period end'
          : ''
      }`
    : 'could not be read back'
  return `${step.id}: ${step.outcome} — now ${status}${
    step.error ? ` (${step.error})` : ''
  }`
}

export interface StaffOrgSubscriptionCardProps {
  orgId: string
  /** What the operator types to confirm; falls back to the org id. */
  orgSlug?: string | null
  /** Called after a cancellation, so the page's billing panels re-read. */
  onCanceled?: () => void
}

/**
 * The workspace's Stripe subscriptions, and the staff lever to end them
 * (AGL-3359).
 *
 * The action lives in the card header, like every card's. It opens a dialog
 * that asks the three things that cannot be taken back: when (now, or at the
 * end of the paid period), why (a code, plus a note for "other"), and which
 * workspace (type its slug). Neither choice refunds anything, and lifting a
 * lockdown later does not bring the subscription back — both are said in
 * the card and again in the dialog, because both are what an operator would
 * otherwise assume.
 *
 * The result is the server's read-back of each subscription, not the click.
 */
export default function StaffOrgSubscriptionCard({
  orgId,
  orgSlug,
  onCanceled,
}: StaffOrgSubscriptionCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [rows, setRows] = useState<StaffSubscriptionRow[] | null>(null)
  const [lookupErrors, setLookupErrors] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readAtMs, setReadAtMs] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState<SubscriptionCancelWhen>('now')
  const [reason, setReason] = useState<'' | SubscriptionCancelReasonCode>('')
  const [note, setNote] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<{
    confirmed: boolean
    readAtMs: number
    steps: SubscriptionCancelStepRow[]
    lookupErrors: string[]
  } | null>(null)

  const confirmPhrase = (orgSlug || orgId).trim()

  const refresh = useCallback(async () => {
    if (!orgId) return
    try {
      const response = await authorizedFetch(
        user,
        `/api/admin/billing/cancel-subscription?orgId=${encodeURIComponent(orgId)}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Load failed (${response.status})`)
      }
      setRows(payload.subscriptions ?? [])
      setLookupErrors(payload.lookupErrors ?? [])
      setReadAtMs(payload.readAtMs ?? Date.now())
      setLoadError(null)
    } catch (error: any) {
      console.error(error)
      // Never an empty list: "no subscription" and "could not look" are
      // different facts, and only one of them means billing has stopped.
      setRows(null)
      setLoadError(error?.message ?? 'Could not load subscriptions')
    }
  }, [user, orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
   * Arriving from a Stripe fraud signal in the abuse queue (AGL-3356), whose
   * row links `/admin/orgs/{orgId}#subscription`. The org page renders this
   * card after its own reads, so the browser's own jump to the fragment has
   * already happened against a page without it; the card scrolls itself
   * into view once it exists.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== `#${STAFF_SUBSCRIPTION_CARD_ID}`) return
    document
      .getElementById(STAFF_SUBSCRIPTION_CARD_ID)
      ?.scrollIntoView?.({ block: 'start' })
  }, [])

  const cancelable = (rows ?? []).filter((row) => !row.terminal)
  const reasonComplete = normalizeSubscriptionCancelReason(reason, note) !== null
  const canSubmit =
    !busy && reasonComplete && confirmText.trim() === confirmPhrase

  const closeDialog = () => {
    setOpen(false)
    setConfirmText('')
  }

  const submit = useCallback(async () => {
    const validated = normalizeSubscriptionCancelReason(reason, note)
    if (!validated) return
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        '/api/admin/billing/cancel-subscription',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            when,
            reason: validated.reason,
            note: validated.note || undefined,
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? `Cancel failed (${response.status})`)
      }
      const steps = (payload.subscriptions ?? []) as SubscriptionCancelStepRow[]
      setLastResult({
        confirmed: payload.confirmed === true,
        readAtMs: payload.readAtMs ?? Date.now(),
        steps,
        lookupErrors: payload.lookupErrors ?? [],
      })
      enqueueSnackbar(
        payload.confirmed === true
          ? steps.length
            ? `${when === 'now' ? 'Cancelled' : 'Set to end at period end'} — verified in Stripe (audited)`
            : 'Nothing was billing — verified in Stripe (audited)'
          : 'The cancellation did NOT verify. Read the result on the Subscription card before you leave.',
        {
          variant: payload.confirmed === true ? 'success' : 'error',
          allowDuplicate: true,
        },
      )
      closeDialog()
      setReason('')
      setNote('')
      await refresh()
      onCanceled?.()
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'The cancellation failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [reason, note, user, orgId, when, enqueueSnackbar, refresh, onCanceled])

  return (
    <CardDisplay
      id={STAFF_SUBSCRIPTION_CARD_ID}
      header={'Subscription'}
      help={docsHelp('lockdown', {
        anchor: '#cancel-billing',
        excerpt:
          "The organization's Stripe subscriptions, and the staff action that cancels them — now or at period end, never with a refund. Audited.",
      })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" disabled={busy} onClick={() => void refresh()}>
              {'Refresh'}
            </Button>
            <SuperStaffOnly>
              <Button
                size="small"
                variant="contained"
                color="error"
                disabled={busy || rows == null || cancelable.length === 0}
                onClick={() => setOpen(true)}
              >
                {'Cancel subscription…'}
              </Button>
            </SuperStaffOnly>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Alert severity="info">
          {'Cancelling never refunds — refund a charge separately if one is ' +
            'owed. Lifting a lockdown does not bring a cancelled subscription ' +
            'back; the customer would have to subscribe again.'}
        </Alert>
        {loadError ? (
          <Alert severity="warning">
            {`Couldn't read this organization's subscriptions — this is not "no subscription". ${loadError}`}
          </Alert>
        ) : null}
        {lookupErrors.map((message) => (
          <Alert key={message} severity="warning">
            {`Part of the lookup failed, so this list may be incomplete. ${message}`}
          </Alert>
        ))}
        {rows == null && !loadError ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading subscriptions…'}
          </Typography>
        ) : null}
        {rows != null && rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No subscription in Stripe for this organization.'}
          </Typography>
        ) : null}
        {rows != null && rows.length > 0 ? (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Plan'}</TableCell>
                <TableCell>{'Status'}</TableCell>
                <TableCell>{'Next renewal'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Typography variant="body2">
                        {`${row.plan ?? 'Custom price'}${
                          row.interval ? ` (${row.interval}ly)` : ''
                        }`}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {row.id}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={row.status}
                      color={
                        row.terminal
                          ? 'default'
                          : row.cancelAtPeriodEnd
                            ? 'warning'
                            : 'success'
                      }
                    />
                  </TableCell>
                  <TableCell>{describeRenewal(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        ) : null}
        {readAtMs ? (
          <Typography variant="caption" color="text.secondary">
            {`Read from Stripe at ${new Date(readAtMs).toLocaleTimeString()} — a snapshot, not a live view.`}
          </Typography>
        ) : null}
        {lastResult ? (
          <Alert severity={lastResult.confirmed ? 'success' : 'error'}>
            <Stack spacing={0.5}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {lastResult.confirmed
                  ? 'Last cancellation verified in Stripe.'
                  : 'Last cancellation NOT confirmed — something may still bill.'}
              </Typography>
              {lastResult.steps.map((step) => (
                <Typography key={step.id} variant="body2">
                  {describeCancelStep(step)}
                </Typography>
              ))}
              {lastResult.lookupErrors.map((message) => (
                <Typography key={message} variant="body2">
                  {message}
                </Typography>
              ))}
              <Typography variant="caption" color="text.secondary">
                {`Read back at ${new Date(lastResult.readAtMs).toLocaleTimeString()}.`}
              </Typography>
            </Stack>
          </Alert>
        ) : null}
      </Stack>

      <Dialog open={open} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{`Cancel ${confirmPhrase}'s subscription`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="warning" sx={{ mt: 1 }}>
            {`This ends ${cancelable.length} subscription${
              cancelable.length === 1 ? '' : 's'
            } in Stripe. No refund is issued, and it cannot be undone from ${PLATFORM_BRAND_NAME} — lifting a lockdown does not restore it. Audited.`}
          </Alert>
          <FormControl>
            <FormLabel id="staff-subscription-cancel-when">{'When'}</FormLabel>
            <RadioGroup
              aria-labelledby="staff-subscription-cancel-when"
              value={when}
              onChange={(event) =>
                setWhen(event.target.value as SubscriptionCancelWhen)
              }
            >
              <FormControlLabel
                value="now"
                control={<Radio size="small" />}
                label={
                  'Now — ends immediately. No final invoice, no proration ' +
                  'credit, no refund. For fraud and abuse.'
                }
              />
              <FormControlLabel
                value="period_end"
                control={<Radio size="small" />}
                label={
                  'At period end — the paid period runs out and nothing ' +
                  'renews. For a customer who asked to leave.'
                }
              />
            </RadioGroup>
          </FormControl>
          <TextField
            select
            size="small"
            label="Reason"
            value={reason}
            helperText={
              "Sent to Stripe as the cancellation comment and recorded on the audit row. Never shown to the customer."
            }
            onChange={(event) =>
              setReason(event.target.value as SubscriptionCancelReasonCode)
            }
          >
            {SUBSCRIPTION_CANCEL_REASON_CODES.map((code) => (
              <MenuItem key={code} value={code}>
                {SUBSCRIPTION_CANCEL_REASON_LABELS[code]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={reason === 'other' ? 'Note (required)' : 'Note'}
            value={note}
            multiline
            minRows={2}
            error={reason === 'other' && note.trim().length === 0}
            slotProps={{ htmlInput: { maxLength: SUBSCRIPTION_CANCEL_NOTE_MAX } }}
            onChange={(event) => setNote(event.target.value)}
          />
          <TextField
            size="small"
            label={`Type "${confirmPhrase}" to confirm`}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{'Keep subscription'}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy
              ? 'Cancelling…'
              : when === 'now'
                ? 'Cancel now, no refund'
                : 'Cancel at period end'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
StaffOrgSubscriptionCard.displayName = 'StaffOrgSubscriptionCard'
