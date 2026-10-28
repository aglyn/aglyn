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

import type { ConsoleStaffPageProps } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { resolveStaffRoleGate } from '@aglyn/aglyn/app-utils/staff-role-gate'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  formatPosHardwareCents,
  nextPosHardwareStatus,
  POS_HARDWARE_ORDER_STATUSES,
  POS_HARDWARE_STAFF_STATUS_LABELS,
  posHardwareRefundable,
  posHardwareSku,
  type PosHardwareOrderStatus,
} from '../../model/pos-hardware'
import { POS_HARDWARE_STATUS_COLOR } from './pos-hardware-card.component'
import {
  PosHardwareRequestError,
  staffHardwareOrderAction,
  staffHardwareOrders,
  type StaffHardwareFilter,
  type StaffHardwareOrderRow,
} from './pos/pos-hardware-api'

const WRITE_ROLES = ['super', 'billing'] as const

const NOT_REFUNDABLE = 'Only an order that has not shipped can be canceled or refunded.'
const CLOSED = 'A canceled or refunded order can no longer change.'
const REFUNDED = 'This order is refunded in full.'

/** A control disabled with its reason, or passed through when there is none. */
function Guarded(props: { reason?: string; children: ReactElement<{ disabled?: boolean }> }) {
  return (
    <BlockedControl blocked={Boolean(props.reason)} reason={props.reason ?? ''}>
      {props.children}
    </BlockedControl>
  )
}

const when = (ms: number) => (ms ? new Date(ms).toLocaleString() : '—')

/** How a register sale was paid, as staff read it (AGL-4038). */
const TENDER_LABELS: Record<string, string> = {
  cash: 'cash',
  card_present: 'card on a reader',
  card_keyed: 'typed card',
  card_link: 'payment link',
  gift_card: 'gift card',
  folio: 'room charge',
  credit: 'store credit',
}

/** Whose an in-person order is, in a line (AGL-4038). */
function attachedTo(order: StaffHardwareOrderRow): string {
  const attachment = order.attachment
  if (!attachment) return '—'
  if (attachment.state === 'attached') return `Workspace ${attachment.orgId ?? order.orgId}`
  if (attachment.uid) return 'To attach: has an account, no workspace yet'
  if (attachment.email) return `To attach: invited ${attachment.email}`
  return 'To attach'
}

function shipTo(order: StaffHardwareOrderRow): string {
  const address = order.shipping?.address
  if (!address) {
    // The buyer's account was erased: only the tax region is left (AGL-4038).
    const region = order.shipping?.taxRegion
    return region
      ? [[region.state, region.postalCode].filter(Boolean).join(' '), region.country].filter(Boolean).join('\n')
      : '—'
  }
  return [
    order.shipping?.name,
    address.line1,
    address.line2,
    `${address.city}${address.state ? `, ${address.state}` : ''} ${address.postalCode}`,
    address.country,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Staff → Hardware orders (AGL-4038): every workspace's orders from the POS
 * hardware shop, newest first. In phase 1 a person places each one in the
 * Stripe Dashboard's Terminal hardware shop, then records Stripe's order id
 * and the tracking here and moves the order along; the merchant is emailed
 * as it ships and is delivered. Canceling or refunding returns the whole
 * payment and is offered only before the order ships.
 */
export function PosHardwareOrdersStaffPage(props: ConsoleStaffPageProps) {
  const { staffRole = null, staffPaths } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [status, setStatus] = useState<StaffHardwareFilter>('paid')
  const [orders, setOrders] = useState<StaffHardwareOrderRow[] | null>(null)
  // The cursor that opens each page: `cursors[page]` is the `after` its
  // request carries, so Previous re-reads a page rather than keeping every
  // page read so far in memory.
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [nextPage, setNextPage] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(25)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<StaffHardwareOrderRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ stripeHardwareOrderId: '', carrier: '', number: '', url: '' })
  /** The note for declining a return request, while its dialog is open. */
  const [declineNote, setDeclineNote] = useState<string | null>(null)
  const gate = resolveStaffRoleGate(staffRole, WRITE_ROLES)
  const uid = user?.uid ?? ''

  const load = useCallback(async (targetPage = 0, after: string | null = null) => {
    if (!user) return
    setError(null)
    try {
      const answer = await staffHardwareOrders(user, status, after)
      setOrders(answer.orders)
      setPage(targetPage)
      setNextPage(answer.next)
      setPageSize(answer.pageSize)
      setCursors((existing) => {
        const kept = existing.slice(0, targetPage + 1)
        return answer.next ? [...kept, answer.next] : kept
      })
    } catch (caught) {
      setOrders([])
      setError(caught instanceof PosHardwareRequestError ? caught.message : 'Hardware orders could not be read')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, status])

  useEffect(() => {
    void load()
  }, [load])

  const openOrder = (order: StaffHardwareOrderRow) => {
    setOpen(order)
    setForm({
      stripeHardwareOrderId: order.stripeHardwareOrderId ?? '',
      carrier: order.tracking?.carrier ?? '',
      number: order.tracking?.number ?? '',
      url: order.tracking?.url ?? '',
    })
  }

  const act = async (
    body: Omit<Parameters<typeof staffHardwareOrderAction>[1], 'orgId' | 'orderId'>,
    done: string,
  ) => {
    if (!user || !open) return
    setBusy(true)
    try {
      const { order } = await staffHardwareOrderAction(user, { ...body, orgId: open.orgId, orderId: open.id })
      setOpen(order)
      enqueueSnackbar(done, { variant: 'success', persist: false })
      await load(page, cursors[page] ?? null)
    } catch (caught) {
      enqueueSnackbar(
        caught instanceof PosHardwareRequestError ? caught.message : 'The order could not be changed',
        { variant: 'warning', persist: false },
      )
    } finally {
      setBusy(false)
    }
  }

  const formTracking = () =>
    form.carrier.trim() && form.number.trim()
      ? { carrier: form.carrier.trim(), number: form.number.trim(), ...(form.url.trim() ? { url: form.url.trim() } : {}) }
      : undefined

  const save = (advance?: PosHardwareOrderStatus) => {
    const tracking = formTracking()
    void act(
      {
        action: 'update',
        stripeHardwareOrderId: form.stripeHardwareOrderId.trim() || null,
        ...(tracking ? { tracking } : {}),
        ...(advance ? { status: advance } : {}),
      },
      advance ? `Marked ${POS_HARDWARE_STAFF_STATUS_LABELS[advance].toLowerCase()}` : 'Saved',
    )
  }

  const forgetBuyer = async () => {
    if (!open) return
    const confirmed = await confirm({
      title: "Remove the buyer's details?",
      description:
        'The address and account are taken off this order for good. The order, its amounts and where it was taxed stay.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (confirmed) await act({ action: 'forget-buyer' }, "Buyer's details removed")
  }

  const declineReturn = async () => {
    if (!open || declineNote === null) return
    await act({ action: 'decline-return', note: declineNote.trim() }, 'Return request declined')
    setDeclineNote(null)
  }

  const returnMoney = async (action: 'cancel' | 'refund') => {
    if (!open) return
    const sameSale = open.source === 'in_person'
    const confirmed = await confirm({
      title: action === 'cancel' ? 'Cancel and refund this order?' : 'Refund this order?',
      description: sameSale
        ? `${formatPosHardwareCents(open.totalCents - open.refundedCents)} goes back to the card the register sale was paid with, from the selling store's own account. Under Stripe's hardware terms the buyer sends the reader back at their cost.`
        : `${formatPosHardwareCents(open.totalCents)} goes back to the card it was paid with. ` +
          'Cancel the order in the Stripe Dashboard too if it was already placed there.',
      confirmationText: action === 'cancel' ? 'Cancel and refund' : 'Refund',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (confirmed) await act({ action }, action === 'cancel' ? 'Canceled and refunded' : 'Refunded')
  }

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'number', headerName: 'Order', minWidth: 110 },
      {
        field: 'source',
        headerName: 'Sold',
        minWidth: 110,
        valueGetter: (_value: unknown, row: StaffHardwareOrderRow) =>
          row.source === 'in_person' ? (row.attachment?.state === 'pending' ? 'In person · to attach' : 'In person') : 'Online',
      },
      {
        field: 'createdAtMs',
        headerName: 'Placed',
        type: 'number',
        minWidth: 170,
        align: 'left',
        headerAlign: 'left',
        valueFormatter: (value: number) => when(value),
      },
      {
        field: 'orgId',
        headerName: 'Workspace',
        minWidth: 160,
        renderCell: ({ row }: { row: StaffHardwareOrderRow }) => {
          const href = staffPaths?.orgDetail(row.orgId)
          return href ? (
            <Link href={href} onClick={(event) => event.stopPropagation()}>
              {row.orgId}
            </Link>
          ) : (
            row.orgId
          )
        },
      },
      {
        field: 'items',
        headerName: 'Items',
        flex: 1,
        minWidth: 200,
        valueGetter: (_value: unknown, row: StaffHardwareOrderRow) =>
          row.lines.map((line) => `${line.quantity} × ${line.name}`).join(', '),
      },
      {
        field: 'totalCents',
        headerName: 'Total',
        type: 'number',
        minWidth: 100,
        valueFormatter: (value: number) => formatPosHardwareCents(value),
      },
      {
        field: 'shippingMethod',
        headerName: 'Shipping',
        minWidth: 140,
        valueGetter: (_value: unknown, row: StaffHardwareOrderRow) => row.shipping?.label ?? '',
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 160,
        valueGetter: (_value: unknown, row: StaffHardwareOrderRow) => POS_HARDWARE_STAFF_STATUS_LABELS[row.status],
        renderCell: ({ row }: { row: StaffHardwareOrderRow }) => (
          <Chip
            size="small"
            color={POS_HARDWARE_STATUS_COLOR[row.status]}
            label={POS_HARDWARE_STAFF_STATUS_LABELS[row.status] + (row.livemode ? '' : ' · test')}
          />
        ),
      },
      {
        field: 'stripeHardwareOrderId',
        headerName: 'Stripe order',
        minWidth: 150,
        valueGetter: (value: string | null) => value ?? '',
      },
      {
        field: 'tracking',
        headerName: 'Tracking',
        minWidth: 160,
        valueGetter: (_value: unknown, row: StaffHardwareOrderRow) => row.tracking?.number ?? '',
      },
    ],
    [staffPaths],
  )

  const inPerson = open?.source === 'in_person'
  const next = open ? nextPosHardwareStatus(open.status) : null
  const closed = open ? open.status === 'canceled' || open.status === 'refunded' : true
  // A reader sold in person refunds what is left of it, its own way, until
  // it is refunded in full (AGL-4038).
  const refundable = open
    ? inPerson
      ? open.status !== 'refunded' && open.status !== 'canceled' && open.refundedCents < open.totalCents
      : posHardwareRefundable(open.status) && !open.refundPending
    : false
  const returnRequested = open?.returnRequest?.state === 'requested'
  const writeReason = gate.blocked ? gate.reason : undefined

  return (
    <CardDisplay
      header={'Hardware orders'}
      help={pluginDocsHelp('posHardware', { anchor: '#hardware-purchase-records' })}
      subheader={'Card readers bought from the POS hardware shop'}
      HeaderProps={{
        action: (
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StaffHardwareFilter)}
          >
            <MenuItem value="">{'All'}</MenuItem>
            <MenuItem value="to-attach">{'Sold in person, to attach'}</MenuItem>
            <MenuItem value="returns">{'Return requested'}</MenuItem>
            {POS_HARDWARE_ORDER_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {POS_HARDWARE_STAFF_STATUS_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {orders && orders.length === 0 && !error ? (
          <Typography variant="body2" color="text.secondary">
            {status === 'to-attach'
              ? 'Every card reader sold in person is attached to a workspace.'
              : status === 'returns'
                ? 'No return requests are waiting.'
              : status
                ? `No orders are ${POS_HARDWARE_STAFF_STATUS_LABELS[status].toLowerCase()}.`
                : 'No hardware orders yet.'}
          </Typography>
        ) : (
          <ListTable
            rows={(orders ?? []).map((order) => ({ ...order, $id: order.id }))}
            columns={columns}
            loading={orders === null}
            hideFooter
            onOpen={(_id, row) => openOrder(row as StaffHardwareOrderRow)}
          />
        )}
        {orders && (orders.length || page > 0) ? (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={orders.length}
            hasMore={Boolean(nextPage)}
            onPageChange={(target) => void load(target, cursors[target] ?? null)}
          />
        ) : null}
      </Stack>

      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{open ? `Hardware order ${open.number}` : ''}</DialogTitle>
        {open ? (
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {inPerson ? (
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                <Typography variant="subtitle2">{'Sold in person'}</Typography>
                {open.lines.map((line) => (
                  <Typography key={line.sku} variant="body2">
                    {`${line.quantity} × ${line.name}`}
                  </Typography>
                ))}
                <Typography variant="body2" color="text.secondary">
                  {[
                    open.posSale?.number ? `Register sale #${open.posSale.number}` : 'Register sale',
                    open.posSale?.kiosk ? 'at the kiosk' : null,
                    open.posSale?.offline ? 'rung offline' : null,
                    `paid ${formatPosHardwareCents(open.totalCents)}`,
                    open.paidTo?.tenders.length
                      ? `by ${open.paidTo.tenders.map((tender) => TENDER_LABELS[tender] ?? tender).join(' and ')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {`Into the store's own account${open.paidTo?.stripeAccountId ? ` (${open.paidTo.stripeAccountId})` : ''}, not the platform's.`}
                </Typography>
                <Typography variant="body2">{attachedTo(open)}</Typography>
                {open.attachment?.state === 'pending' ? (
                  <Typography variant="body2" color="text.secondary">
                    {'Attach it from the selling store’s register, under To attach, with the buyer’s email, name or workspace.'}
                  </Typography>
                ) : null}
                {open.refundedCents ? (
                  <Typography variant="body2" color="text.secondary">
                    {`Refunded ${formatPosHardwareCents(open.refundedCents)}${open.refunds.some((refund) => refund.via === 'register') ? ', partly as a return at the register' : ''}`}
                  </Typography>
                ) : null}
                {open.returnRequest ? (
                  <Alert severity={returnRequested ? 'warning' : 'info'}>
                    {returnRequested
                      ? `Return requested ${when(open.returnRequest.requestedAtMs)}: “${open.returnRequest.reason ?? ''}”. Refund it, or decline it with a note.`
                      : `Return request ${open.returnRequest.state}${open.returnRequest.note ? `: ${open.returnRequest.note}` : ''}.`}
                  </Alert>
                ) : null}
                {open.contactEmail ? (
                  <Typography variant="body2" color="text.secondary">
                    {open.contactEmail}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
            {inPerson ? null : (
              <>
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  <Typography variant="subtitle2">{'Order in the Stripe hardware shop'}</Typography>
                  {open.lines.map((line) => (
                    <Typography key={line.sku} variant="body2">
                      {`${line.quantity} × ${posHardwareSku(line.sku)?.stripeProductName ?? line.name}`}
                    </Typography>
                  ))}
                  <Typography variant="body2" color="text.secondary">
                    {`${open.shipping?.label ?? 'Shipping'} · paid ${formatPosHardwareCents(open.totalCents)}`}
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">{'Ship to'}</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {shipTo(open)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[open.shipping?.phone, open.contactEmail].filter(Boolean).join(' · ')}
                  </Typography>
                </Stack>
                <TextField
                  label="Stripe hardware order id"
                  value={form.stripeHardwareOrderId}
                  disabled={closed}
                  onChange={(event) => setForm({ ...form, stripeHardwareOrderId: event.target.value })}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Carrier"
                    value={form.carrier}
                    disabled={closed}
                    onChange={(event) => setForm({ ...form, carrier: event.target.value })}
                  />
                  <TextField
                    label="Tracking number"
                    value={form.number}
                    disabled={closed}
                    onChange={(event) => setForm({ ...form, number: event.target.value })}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                <TextField
                  label="Tracking link (optional)"
                  helperText="Built from the carrier when left empty"
                  value={form.url}
                  disabled={closed}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                />
              </>
            )}
            {open.refundPending ? <Alert severity="warning">{'A refund is in progress.'}</Alert> : null}
          </DialogContent>
        ) : null}
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {returnRequested ? (
            <Guarded reason={writeReason}>
              <Button disabled={busy} onClick={() => setDeclineNote('')}>
                {'Decline return'}
              </Button>
            </Guarded>
          ) : null}
          {inPerson && (open?.contactEmail || open?.attachment?.email || open?.attachment?.uid) ? (
            <Guarded reason={writeReason}>
              <Button color="error" disabled={busy} onClick={() => void forgetBuyer()}>
                {"Remove buyer's details"}
              </Button>
            </Guarded>
          ) : null}
          {inPerson ? null : (
            <Guarded reason={writeReason ?? (refundable ? undefined : NOT_REFUNDABLE)}>
              <Button color="error" disabled={busy} onClick={() => void returnMoney('cancel')}>
                {'Cancel and refund'}
              </Button>
            </Guarded>
          )}
          <Guarded reason={writeReason ?? (refundable ? undefined : inPerson ? REFUNDED : NOT_REFUNDABLE)}>
            <Button color="error" disabled={busy} onClick={() => void returnMoney('refund')}>
              {'Refund'}
            </Button>
          </Guarded>
          <Button onClick={() => setOpen(null)}>{'Close'}</Button>
          <Guarded reason={writeReason ?? (closed ? CLOSED : undefined)}>
            <Button disabled={busy} onClick={() => save()}>
              {'Save'}
            </Button>
          </Guarded>
          {next ? (
            <Guarded
              reason={
                writeReason ??
                (next === 'shipped' && !form.number.trim() ? 'Add the tracking number first.' : undefined)
              }
            >
              <Button variant="contained" disabled={busy} onClick={() => save(next)}>
                {`Mark ${POS_HARDWARE_STAFF_STATUS_LABELS[next].toLowerCase()}`}
              </Button>
            </Guarded>
          ) : null}
        </DialogActions>
      </Dialog>

      <Dialog open={declineNote !== null} onClose={() => setDeclineNote(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Decline this return?'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Note for the buyer (optional)"
            value={declineNote ?? ''}
            onChange={(event) => setDeclineNote(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeclineNote(null)}>{'Keep it open'}</Button>
          <Button color="error" disabled={busy} onClick={() => void declineReturn()}>
            {'Decline'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
PosHardwareOrdersStaffPage.displayName = 'PosHardwareOrdersStaffPage'

export default PosHardwareOrdersStaffPage
