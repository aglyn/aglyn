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

import * as CommerceModel from '../../model'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { memo, useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { formatMoney, postReturnAction } from './return-actions'
import {
  type ConsoleReturnLabelRequest,
  type ConsoleReturnZoneReturn,
  RETURN_DETAIL_ZONE,
} from './return-zones'

export interface ReturnDetailDialogProps {
  hostId: string
  /** The return to show; `null` keeps the dialog closed. */
  returnId: string | null
  onClose: () => void
}

/** The locations a receive may restock to — the locations card's own window. */
const LOCATION_WINDOW = 25

/** The panel open beneath the details, one at a time. */
type Panel = 'approve' | 'decline' | 'receive' | 'refund' | null

/**
 * A zone hosted in the dialog, drawn again only when what it is handed
 * changes — the order dialog's reasoning: the shell's renderer is not
 * memoized, and the dialog redraws on every keystroke in its fields.
 */
const HostedZone = memo(function HostedZone(
  props: { renderer: ConsoleWidgetSlotRenderer; slot: string } & Record<string, unknown>,
) {
  const { renderer: Renderer, ...zone } = props
  return <Renderer {...zone} />
})

const centsFromInput = (value: string) => Math.round(Number(value) * 100)

/**
 * One return (AGL-3611): what is coming back and why, the notes on both
 * sides, the label and the restock, its timeline, and the actions its state
 * allows (`canTransitionReturn`). Every action is the returns route — the
 * return is never written from here — and the dialog reads the return live,
 * so what the route wrote is what it shows next.
 */
export function ReturnDetailDialog(props: ReturnDetailDialogProps) {
  const { hostId, returnId, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const WidgetSlot = useConsoleWidgetSlot()

  const { data: entry } = useFirestoreDoc<CommerceModel.HostReturn>(
    () => (returnId ? doc(firestore, 'hosts', hostId, 'returns', returnId) : null),
    [firestore, hostId, returnId],
  )
  const orderId = entry?.orderId ?? null
  const { data: rawOrder } = useFirestoreDoc<CommerceModel.HostOrder>(
    () => (orderId ? doc(firestore, 'hosts', hostId, 'orders', orderId) : null),
    [firestore, hostId, orderId],
  )
  const { data: store } = useFirestoreDoc<Record<string, any>>(
    () => (returnId ? doc(firestore, 'hosts', hostId, 'settings', 'store') : null),
    [firestore, hostId, returnId],
  )
  const [panel, setPanel] = useState<Panel>(null)
  // The locations are read only to set up a receive, or to name the one a
  // receive restocked to.
  const readLocations = panel === 'receive' || Boolean(entry?.restock?.locationId)
  const { data: locationDocs } = useFirestoreCollection<any>(
    () =>
      readLocations
        ? query(collection(firestore, 'hosts', hostId, 'locations'), limit(LOCATION_WINDOW))
        : null,
    [firestore, hostId, readLocations],
    { idField: '$id' },
  )
  const locations = useMemo(
    () =>
      [...(locationDocs ?? [])].sort((a: any, b: any) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
      ),
    [locationDocs],
  )

  const order = useMemo(
    () => (rawOrder ? CommerceModel.liftLegacyOrder(rawOrder as never) : null),
    [rawOrder],
  )
  const currency = String(store?.currency ?? 'USD').toUpperCase()
  const [busy, setBusy] = useState(false)
  const [buyerNote, setBuyerNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [restock, setRestock] = useState<Record<number, string>>({})
  const [locationId, setLocationId] = useState('')
  const [amount, setAmount] = useState('')
  const [merchantNote, setMerchantNote] = useState<string | null>(null)

  const lineName = useCallback(
    (lineItemId: number) => {
      const line = order?.lineItems?.[lineItemId]
      if (!line) return `Line ${lineItemId + 1}`
      return line.variantLabel ? `${line.name} — ${line.variantLabel}` : line.name
    },
    [order],
  )

  const suggestedRefundCents = useMemo(
    () => (order && entry ? CommerceModel.returnRefundCents(order, entry.lines ?? []) : 0),
    [order, entry],
  )

  const run = useCallback(
    async (body: Record<string, unknown>, done: string) => {
      if (!returnId) return false
      setBusy(true)
      try {
        const outcome = await postReturnAction(user, { hostId, returnId, ...body })
        if (!outcome.ok) {
          enqueueSnackbar(outcome.message, {
            variant: outcome.refused ? 'warning' : 'error',
            allowDuplicate: true,
          })
          return false
        }
        enqueueSnackbar(outcome.payload['already'] ? 'Nothing to change — already done' : done, {
          variant: 'success',
          persist: false,
        })
        setPanel(null)
        return true
      } finally {
        setBusy(false)
      }
    },
    [returnId, user, hostId, enqueueSnackbar],
  )

  const openPanel = useCallback(
    (next: Panel) => {
      setPanel(next)
      setBuyerNote('')
      setNotify(true)
      if (next === 'receive' && entry) {
        setRestock(
          Object.fromEntries(entry.lines.map((line) => [line.lineItemId, String(line.quantity)])),
        )
        setLocationId('')
      }
      if (next === 'refund') setAmount((suggestedRefundCents / 100).toFixed(2))
    },
    [entry, suggestedRefundCents],
  )

  const handleDecision = useCallback(
    (action: 'approve' | 'decline') =>
      run(
        {
          action,
          ...(buyerNote.trim() ? { merchantNote: buyerNote.trim() } : {}),
          notify,
        },
        action === 'approve' ? 'Return approved' : 'Return declined',
      ),
    [run, buyerNote, notify],
  )

  const defaultLocationId =
    locations.find((location: any) => location.isDefault)?.$id ?? locations[0]?.$id ?? ''
  const handleReceive = useCallback(() => {
    if (!entry) return
    const chosen = locationId || defaultLocationId
    return run(
      {
        action: 'receive',
        restock: entry.lines.map((line) => ({
          lineItemId: line.lineItemId,
          quantity: Math.max(0, Math.floor(Number(restock[line.lineItemId] ?? 0) || 0)),
        })),
        ...(chosen ? { locationId: chosen } : {}),
      },
      'Return received',
    )
  }, [entry, restock, locationId, defaultLocationId, run])

  const refundCents = centsFromInput(amount)
  const refundValid = Number.isInteger(refundCents) && refundCents > 0
  const handleRefund = useCallback(async () => {
    if (!refundValid) return
    const confirmed = await confirm({
      title: 'Refund this return?',
      description:
        `Refunds ${formatMoney(refundCents, currency)} to the buyer through Stripe, ` +
        'through the order’s own refund. The buyer is emailed.',
      confirmationText: 'Refund',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await run({ action: 'refund', amountCents: refundCents }, 'Refund issued')
  }, [confirm, refundValid, refundCents, currency, run])

  const noteDraft = merchantNote ?? entry?.merchantNote ?? ''
  const handleSaveNote = useCallback(async () => {
    const saved = await run({ action: 'note', merchantNote: noteDraft.trim() }, 'Note saved')
    if (saved) setMerchantNote(null)
  }, [run, noteDraft])

  const attachReturnLabel = useCallback(
    async (label: ConsoleReturnLabelRequest) => {
      if (!returnId) throw new Error('No return is open')
      const outcome = await postReturnAction(user, {
        hostId,
        returnId,
        action: 'attach-label',
        label: {
          carrier: label.carrier,
          trackingNumber: label.trackingNumber,
          labelUrl: label.labelUrl,
          ...(label.trackingUrl ? { trackingUrl: label.trackingUrl } : {}),
        },
      })
      if (!outcome.ok) throw new Error(outcome.message)
    },
    [user, hostId, returnId],
  )

  const zoneReturn = useMemo((): ConsoleReturnZoneReturn | null => {
    if (!entry || !returnId) return null
    const address = order?.shippingAddress
    return {
      id: returnId,
      status: entry.status,
      orderId: entry.orderId,
      orderNumber: entry.orderNumber,
      customerName: entry.customerName ?? null,
      customerEmail: entry.customerEmail ?? null,
      lines: (entry.lines ?? []).map((line) => ({
        lineItemId: line.lineItemId,
        name: order?.lineItems?.[line.lineItemId]?.name ?? `Line ${line.lineItemId + 1}`,
        variantLabel: order?.lineItems?.[line.lineItemId]?.variantLabel ?? null,
        quantity: line.quantity,
        reason: line.reason,
      })),
      fromAddress: address
        ? {
            name: address.name ?? null,
            line1: address.line1 ?? null,
            line2: address.line2 ?? null,
            city: address.city ?? null,
            state: address.state ?? null,
            postalCode: address.postalCode ?? null,
            country: address.country ?? null,
            phone: address.phone ?? null,
          }
        : null,
      returnLabel: entry.returnLabel
        ? {
            carrier: entry.returnLabel.carrier,
            trackingNumber: entry.returnLabel.trackingNumber,
            labelUrl: entry.returnLabel.labelUrl,
            trackingUrl: entry.returnLabel.trackingUrl ?? null,
            attachedAtMs: entry.returnLabel.attachedAtMs,
          }
        : null,
    }
  }, [entry, order, returnId])

  if (!returnId) return null
  const status = entry?.status
  const can = (to: CommerceModel.ReturnStatus) =>
    Boolean(status) && CommerceModel.canTransitionReturn(status as CommerceModel.ReturnStatus, to)
  const restockLocationName = entry?.restock?.locationId
    ? (locations.find((location: any) => location.$id === entry.restock?.locationId)?.name ??
      null)
    : null

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <span>{entry ? `Return for order ${entry.orderNumber}` : 'Return'}</span>
          {status ? (
            <Chip
              label={CommerceModel.RETURN_STATUS_LABELS[status] ?? status}
              size="small"
              color={CommerceModel.RETURN_STATUS_COLOR[status] ?? 'default'}
              variant="outlined"
            />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {!entry ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading the return…'}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {[entry.customerName, entry.customerEmail].filter(Boolean).join(' · ') ||
                'Guest buyer'}
              {entry.requestedBy === 'merchant' ? ' · Opened by the store' : ''}
            </Typography>
            {(entry.lines ?? []).map((line) => (
              <Stack
                key={line.lineItemId}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {`${line.quantity}× ${lineName(line.lineItemId)}`}
                </Typography>
                <Chip
                  label={CommerceModel.RETURN_REASON_LABELS[line.reason] ?? line.reason}
                  size="small"
                  variant="outlined"
                />
              </Stack>
            ))}
            {entry.customerNote ? (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">{'Customer note'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {entry.customerNote}
                </Typography>
              </Stack>
            ) : null}
            {entry.returnLabel ? (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">{'Return label'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${entry.returnLabel.carrier} · ${entry.returnLabel.trackingNumber}`}
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Link href={entry.returnLabel.labelUrl} target="_blank" rel="noopener noreferrer">
                    {'Print label'}
                  </Link>
                  {entry.returnLabel.trackingUrl ? (
                    <Link
                      href={entry.returnLabel.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {'Track parcel'}
                    </Link>
                  ) : null}
                </Stack>
              </Stack>
            ) : null}
            {entry.restock ? (
              <Stack spacing={0.5}>
                <Typography variant="subtitle2">{'Restocked'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {entry.restock.lines.length
                    ? entry.restock.lines
                        .map((line) => `${line.quantity}× ${lineName(line.lineItemId)}`)
                        .join(', ')
                    : 'Nothing went back on the shelf'}
                  {restockLocationName ? ` at ${restockLocationName}` : ''}
                  {` · ${new Date(entry.restock.atMs).toLocaleDateString()}`}
                </Typography>
              </Stack>
            ) : null}
            {entry.refundedAtMs ? (
              <Typography variant="body2" color="text.secondary">
                {`Refunded ${formatMoney(entry.refundCents ?? 0, currency)} on ${new Date(
                  entry.refundedAtMs,
                ).toLocaleDateString()}`}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Merchant note"
                value={noteDraft}
                onChange={(event) => setMerchantNote(event.target.value)}
                size="small"
                multiline
                sx={{ flex: 1 }}
                slotProps={{ htmlInput: { maxLength: CommerceModel.RETURN_NOTE_MAX } }}
              />
              <Button
                size="small"
                disabled={busy || merchantNote === null}
                onClick={handleSaveNote}
              >
                {'Save note'}
              </Button>
            </Stack>

            {panel === 'approve' || panel === 'decline' ? (
              <Stack spacing={1}>
                <Divider />
                <TextField
                  label="Note to the customer (optional)"
                  value={buyerNote}
                  onChange={(event) => setBuyerNote(event.target.value)}
                  size="small"
                  multiline
                  minRows={2}
                  slotProps={{ htmlInput: { maxLength: CommerceModel.RETURN_NOTE_MAX } }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={notify}
                      onChange={(event) => setNotify(event.target.checked)}
                    />
                  }
                  label="Notify customer"
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    color={panel === 'decline' ? 'error' : 'primary'}
                    disabled={busy}
                    onClick={() => handleDecision(panel)}
                  >
                    {panel === 'approve' ? 'Approve return' : 'Decline return'}
                  </Button>
                  <Button disabled={busy} onClick={() => setPanel(null)}>
                    {'Back'}
                  </Button>
                </Stack>
              </Stack>
            ) : null}

            {panel === 'receive' ? (
              <Stack spacing={1}>
                <Divider />
                <Typography variant="subtitle2">{'Put back on the shelf'}</Typography>
                {entry.lines.map((line) => (
                  <Stack
                    key={line.lineItemId}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {lineName(line.lineItemId)}
                    </Typography>
                    <TextField
                      label={`Restock (of ${line.quantity})`}
                      type="number"
                      size="small"
                      value={restock[line.lineItemId] ?? ''}
                      onChange={(event) =>
                        setRestock((prior) => ({ ...prior, [line.lineItemId]: event.target.value }))
                      }
                      slotProps={{ htmlInput: { min: 0, max: line.quantity, step: 1 } }}
                      sx={{ width: 150 }}
                    />
                  </Stack>
                ))}
                {locations.length > 0 ? (
                  <TextField
                    label="Location"
                    select
                    size="small"
                    value={locationId || defaultLocationId}
                    onChange={(event) => setLocationId(event.target.value)}
                    sx={{ maxWidth: 280 }}
                  >
                    {locations.map((location: any) => (
                      <MenuItem key={location.$id} value={location.$id}>
                        {location.name ?? location.$id}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" color="primary" disabled={busy} onClick={handleReceive}>
                    {'Confirm received'}
                  </Button>
                  <Button disabled={busy} onClick={() => setPanel(null)}>
                    {'Back'}
                  </Button>
                </Stack>
              </Stack>
            ) : null}

            {panel === 'refund' ? (
              <Stack spacing={1}>
                <Divider />
                <TextField
                  label="Refund amount"
                  type="number"
                  size="small"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  error={!refundValid}
                  helperText={
                    `Suggested ${formatMoney(suggestedRefundCents, currency)} — what the returned ` +
                    'items were paid, shipping and tax left out. Change it to refund more or less.'
                  }
                  slotProps={{
                    htmlInput: { min: 0, step: 0.01 },
                    input: {
                      startAdornment: <InputAdornment position="start">{currency}</InputAdornment>,
                    },
                  }}
                  sx={{ maxWidth: 360 }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    color="error"
                    disabled={busy || !refundValid}
                    onClick={handleRefund}
                  >
                    {'Refund'}
                  </Button>
                  <Button disabled={busy} onClick={() => setPanel(null)}>
                    {'Back'}
                  </Button>
                </Stack>
              </Stack>
            ) : null}

            {/*
              The return zone (AGL-3611): a shipping plugin's widget buys the
              buyer a label and attaches it through `attachReturnLabel`, this
              dialog's own route.
            */}
            {WidgetSlot && zoneReturn ? (
              <HostedZone
                renderer={WidgetSlot}
                slot={RETURN_DETAIL_ZONE.id}
                hostId={hostId}
                orgId={undefined}
                return={zoneReturn}
                attachReturnLabel={attachReturnLabel}
              />
            ) : null}

            <Divider />
            <Typography variant="subtitle2">{'Timeline'}</Typography>
            {(entry.timeline ?? [])
              .slice()
              .reverse()
              .map((event, index) => (
                <Typography key={index} variant="caption" color="text.secondary">
                  {`${new Date(event.atMs).toLocaleString()} — ${event.event}` +
                    (event.detail ? `: ${event.detail}` : '')}
                </Typography>
              ))}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {can('closed') ? (
          <Button
            disabled={busy}
            onClick={() => run({ action: 'close' }, 'Return closed')}
          >
            {'Close return'}
          </Button>
        ) : null}
        {can('declined') && panel === null ? (
          <Button color="error" disabled={busy} onClick={() => openPanel('decline')}>
            {'Decline'}
          </Button>
        ) : null}
        {can('refunded') && panel === null ? (
          <Button color="error" disabled={busy || !order} onClick={() => openPanel('refund')}>
            {'Refund…'}
          </Button>
        ) : null}
        {can('received') && panel === null ? (
          <Button disabled={busy} onClick={() => openPanel('receive')}>
            {'Mark received…'}
          </Button>
        ) : null}
        {can('approved') && panel === null ? (
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() => openPanel('approve')}
          >
            {'Approve'}
          </Button>
        ) : null}
        <Button onClick={onClose}>{'Done'}</Button>
      </DialogActions>
    </Dialog>
  )
}
ReturnDetailDialog.displayName = 'ReturnDetailDialog'

export default ReturnDetailDialog
