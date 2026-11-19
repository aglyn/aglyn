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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatPosHardwareCents,
  POS_HARDWARE_ANCHOR,
  POS_HARDWARE_MAX_PER_LINE,
  POS_HARDWARE_STATUS_LABELS,
  posPlanPrompt,
  type PosHardwareOrderStatus,
  type PosHardwareShippingMethod,
} from '../../model/pos-hardware'
import { posHardwareTermsUrl } from '../../model/pos-hardware-terms'
import {
  POS_HARDWARE_RETURN_LABELS as RETURN_LABELS,
  POS_HARDWARE_SHOP_TEXT as TEXT,
  posHardwareArrivedNumbers,
  posHardwareBasket,
  posHardwareCheckoutState,
  posHardwareOrderItems,
  posHardwareReturnOffered,
  posHardwareReturnReasonReady,
  posHardwareReturnTitle,
} from '../../model/pos-hardware-shop'
import { EntitlementUpsell, useCommerceEntitlement } from './entitlement-gate.component'
import { newAttemptKey } from './pos/pos-api'
import {
  openPosHardwareCheckout,
  posHardwareCatalog,
  posHardwareCheckout,
  posHardwareOrders,
  posHardwareRequestReturn,
  PosHardwareRequestError,
  type PosHardwareCatalog,
  type PosHardwareOrderRow,
} from './pos/pos-hardware-api'


export const POS_HARDWARE_STATUS_COLOR: Record<
  PosHardwareOrderStatus,
  'default' | 'info' | 'primary' | 'success'
> = {
  paid: 'info',
  ordered: 'info',
  received: 'info',
  shipped: 'primary',
  delivered: 'success',
  registered: 'success',
  canceled: 'default',
  refunded: 'default',
}

const QUANTITIES = Array.from({ length: POS_HARDWARE_MAX_PER_LINE + 1 }, (_, index) => index)

const placedOn = (ms: number) =>
  ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export interface PosHardwareCardProps {
  hostId: string
  /**
   * Whether the viewer may work this site's register (`managePos`). The shop
   * is the register's hardware, so whoever works it is shown the shop.
   */
  canManagePos?: boolean
  /**
   * Whether the viewer may start a checkout (AGL-4047): the "Buy point of
   * sale hardware" key the route asks of a checkout. It stands on its own,
   * so a member who holds it without the register is shown the shop and
   * their orders too. Someone who works the register without it sees the
   * shop with Check out disabled and the reason. Absent follows
   * `canManagePos`.
   */
  canBuyHardware?: boolean
}

/**
 * The Hardware card (AGL-4038): Stripe card readers and accessories sold by
 * the platform and shipped by Stripe straight to the store, with the store's
 * orders and their tracking underneath.
 *
 * HIDDEN, NOT DISABLED, while the deployment has not opened the shop: it is a
 * gate only the platform can lift, so naming it would point at a step nobody
 * on the workspace can take. The route answers `available: false` until
 * every price, the markup and the shipping figures are configured.
 *
 * ANYONE CAN BUY (AGL-4038): the shop is open on every plan. A workspace
 * without the point of sale is prompted to add it, because a reader takes
 * payments at the register: above the shop, and once an order has arrived,
 * naming it. The prompt never switches Check out off.
 */
export function PosHardwareCard({
  hostId,
  canManagePos = false,
  canBuyHardware = canManagePos,
}: PosHardwareCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [catalog, setCatalog] = useState<PosHardwareCatalog | null>(null)
  const [orders, setOrders] = useState<PosHardwareOrderRow[] | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [shippingMethod, setShippingMethod] = useState<PosHardwareShippingMethod | ''>('')
  const [busy, setBusy] = useState(false)
  const [returned, setReturned] = useState<'placed' | 'canceled' | null>(null)
  // The terms of sale and business use, ticked before checkout (AGL-4038).
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [businessUse, setBusinessUse] = useState(false)
  const uid = user?.uid ?? ''
  // The route's own door (AGL-4047): the register, or the key to buy.
  const mayVisit = canManagePos || canBuyHardware
  // The point of sale, which a reader takes payments with (AGL-4038). Only
  // `locked` prompts: a plan still loading prompts nobody.
  const posPlan = useCommerceEntitlement(hostId, 'pos')

  useEffect(() => {
    if (!user || !mayVisit) return
    let active = true
    void posHardwareCatalog(user, hostId)
      .then((answer) => {
        if (active) setCatalog(answer)
      })
      .catch(() => {
        if (active) setCatalog({ available: false })
      })
    return () => {
      active = false
    }
    // Keyed on the person, not the session object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId, mayVisit])

  const available = catalog?.available === true

  const loadOrders = useCallback(async () => {
    if (!user) return
    try {
      setOrders((await posHardwareOrders(user, hostId)).orders)
    } catch {
      setOrders([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId])

  // The orders load whether or not the shop is open: a reader bought in
  // person (AGL-4038) is the workspace's purchase history too.
  useEffect(() => {
    if (mayVisit) void loadOrders()
  }, [mayVisit, loadOrders])

  /** The order whose return is being asked for, and why (AGL-4038). */
  const [returning, setReturning] = useState<PosHardwareOrderRow | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const requestReturn = async () => {
    if (!user || !returning) return
    setBusy(true)
    try {
      await posHardwareRequestReturn(user, hostId, returning.id, returnReason.trim())
      enqueueSnackbar(TEXT.returnSent, { variant: 'success', persist: false })
      setReturning(null)
      setReturnReason('')
      await loadOrders()
    } catch (error) {
      enqueueSnackbar(error instanceof PosHardwareRequestError ? error.message : TEXT.returnFailed, {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }

  // The first shipping speed is the default once the catalog answers.
  useEffect(() => {
    if (catalog?.available && !shippingMethod && catalog.shipping.length) {
      setShippingMethod(catalog.shipping[0].method)
    }
  }, [catalog, shippingMethod])

  // Back from Checkout: say what happened, then drop the marker from the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const outcome = url.searchParams.get('hardwareOrder')
    if (outcome === 'placed' || outcome === 'canceled') {
      setReturned(outcome)
      url.searchParams.delete('hardwareOrder')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [])

  // Arrived by an email's link or Checkout's return: bring the card into view.
  useEffect(() => {
    if (!available || typeof window === 'undefined') return
    if (window.location.hash !== `#${POS_HARDWARE_ANCHOR}`) return
    document.getElementById(POS_HARDWARE_ANCHOR)?.scrollIntoView?.({ block: 'start' })
  }, [available])

  const shipping = catalog?.available ? catalog.shipping.find((option) => option.method === shippingMethod) : undefined
  // The basket and its summary, as the apps work them out (pos-hardware-shop.ts).
  const basket = useMemo(
    () =>
      posHardwareBasket({
        offers: catalog?.available ? catalog.offers : [],
        quantities,
        shippingCents: shipping?.cents ?? null,
        automaticTax: catalog?.available ? catalog.automaticTax : false,
      }),
    [catalog, quantities, shipping],
  )
  const lines = basket.lines
  const subtotalCents = basket.itemsCents
  const checkoutState = posHardwareCheckoutState({
    canBuy: canBuyHardware,
    termsAccepted,
    businessUse,
    hasLines: lines.length > 0,
    hasShipping: Boolean(shipping),
  })

  // One attempt per basket: a second press of the same basket reaches the
  // same Checkout Session, and a changed basket is a new one.
  const basketKey = JSON.stringify([lines, shippingMethod])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attemptKey = useMemo(() => newAttemptKey(), [basketKey])

  const checkout = async () => {
    if (!user || !shippingMethod || !lines.length || !termsAccepted || !businessUse) return
    setBusy(true)
    try {
      const { url } = await posHardwareCheckout(user, attemptKey, {
        hostId,
        lines,
        shippingMethod,
        hardwareTerms: { accepted: termsAccepted, businessUse },
      })
      openPosHardwareCheckout(url)
    } catch (error) {
      enqueueSnackbar(
        error instanceof PosHardwareRequestError ? error.message : TEXT.checkoutFailed,
        { variant: 'warning', persist: false },
      )
      setBusy(false)
    }
  }

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'number', headerName: TEXT.columnOrder, minWidth: 110 },
      {
        field: 'createdAtMs',
        headerName: TEXT.columnPlaced,
        type: 'number',
        minWidth: 120,
        align: 'left',
        headerAlign: 'left',
        valueFormatter: (value: number) => placedOn(value),
      },
      {
        field: 'items',
        headerName: TEXT.columnItems,
        flex: 1,
        minWidth: 200,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) =>
          posHardwareOrderItems(row.lines),
      },
      {
        field: 'totalCents',
        headerName: TEXT.columnTotal,
        type: 'number',
        minWidth: 100,
        valueFormatter: (value: number) => formatPosHardwareCents(value),
      },
      {
        field: 'status',
        headerName: TEXT.columnStatus,
        minWidth: 130,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) => POS_HARDWARE_STATUS_LABELS[row.status],
        renderCell: ({ row }: { row: PosHardwareOrderRow }) => (
          <Chip size="small" color={POS_HARDWARE_STATUS_COLOR[row.status]} label={POS_HARDWARE_STATUS_LABELS[row.status]} />
        ),
      },
      {
        // A reader bought in person, or an order shipped to you once it has
        // shipped (AGL-4038), can be asked back from here.
        field: 'returnRequest',
        headerName: TEXT.columnReturn,
        minWidth: 170,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) => RETURN_LABELS[row.returnRequest?.state ?? ''] ?? '',
        renderCell: ({ row }: { row: PosHardwareOrderRow }) =>
          row.returnRequest ? (
            RETURN_LABELS[row.returnRequest.state]
          ) : posHardwareReturnOffered(row) ? (
            <Button
              size="small"
              onClick={(event) => {
                event.stopPropagation()
                setReturning(row)
              }}
            >
              {TEXT.returnAction}
            </Button>
          ) : (
            '—'
          ),
      },
      {
        field: 'tracking',
        headerName: TEXT.columnTracking,
        minWidth: 160,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) => row.tracking?.number ?? '',
        renderCell: ({ row }: { row: PosHardwareOrderRow }) =>
          row.tracking?.url ? (
            <Link href={row.tracking.url} target="_blank" rel="noopener noreferrer">
              {row.tracking.number}
            </Link>
          ) : (
            row.tracking?.number ?? '—'
          ),
      },
    ],
    [],
  )

  /*
   * Orders shipped from this card that have arrived, for the prompt. A reader
   * bought from the platform's own store, at an event or online, is prompted
   * on the Card readers to set up card instead, so it is not named twice.
   */
  const arrived = posPlan.locked
    ? posHardwareArrivedNumbers(orders ?? [])
    : []
  const planPrompt = (text: string) => (
    <EntitlementUpsell planLabel={posPlan.planLabel} upgradeHref={posPlan.upgradeHref}>
      {text}
    </EntitlementUpsell>
  )

  const ordersSection = (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{TEXT.ordersTitle}</Typography>
      {arrived.length ? planPrompt(posPlanPrompt({ arrived })) : null}
      {orders && orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {TEXT.noOrders}
        </Typography>
      ) : (
        <ListTable
          rows={(orders ?? []).map((order) => ({ ...order, $id: order.id }))}
          columns={columns}
          loading={orders === null}
          hideFooter
          quickFilter={false}
        />
      )}
      <Dialog open={Boolean(returning)} onClose={() => setReturning(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{returning ? posHardwareReturnTitle(returning.number) : ''}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {TEXT.returnBody}
          </Typography>
          <TextField
            label={TEXT.returnField}
            value={returnReason}
            onChange={(event) => setReturnReason(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturning(null)}>{TEXT.returnCancel}</Button>
          <Button variant="contained" disabled={busy || !posHardwareReturnReasonReady(returnReason)} onClick={() => void requestReturn()}>
            {TEXT.returnSend}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )

  // With the shop closed, the card is the purchase history alone, and only
  // when there is one (AGL-4038): a reader bought in person.
  if (!available || !catalog?.available) {
    if (!orders?.length) return null
    return (
      <CardDisplay
        id={POS_HARDWARE_ANCHOR}
        header={TEXT.header}
        subheader={TEXT.historySubheader}
        help={pluginDocsHelp('posHardware', { anchor: '#bought-from-us-in-person' })}
        contentGutterX
        contentGutterY
      >
        {ordersSection}
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      id={POS_HARDWARE_ANCHOR}
      header={TEXT.header}
      subheader={TEXT.subheader}
      help={pluginDocsHelp('posHardware', { anchor: '#buy-a-reader-from-aglyn' })}
      HeaderProps={{
        action: (
          <BlockedControl
            blocked={checkoutState.blockedReason !== null}
            reason={checkoutState.blockedReason ?? ''}
          >
            <Button
              size="small"
              variant="contained"
              disabled={busy || !lines.length || !shipping}
              onClick={() => void checkout()}
            >
              {TEXT.checkout}
            </Button>
          </BlockedControl>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {returned === 'placed' ? (
          <Alert severity="success" onClose={() => setReturned(null)}>
            {TEXT.placed}
          </Alert>
        ) : returned === 'canceled' ? (
          <Alert severity="info" onClose={() => setReturned(null)}>
            {TEXT.canceled}
          </Alert>
        ) : null}
        {posPlan.locked && !arrived.length ? planPrompt(posPlanPrompt()) : null}
        <Typography variant="body2" color="text.secondary">
          {TEXT.intro}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {catalog.offers.map((offer) => (
            <Card key={offer.sku} variant="outlined">
              <CardContent>
                <Stack spacing={1} sx={{ height: '100%' }}>
                  <Typography variant="subtitle2">{offer.name}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {offer.use}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body1">{formatPosHardwareCents(offer.unitCents)}</Typography>
                    <TextField
                      select
                      size="small"
                      label={TEXT.quantity}
                      value={quantities[offer.sku] ?? 0}
                      onChange={(event) =>
                        setQuantities((prev) => ({ ...prev, [offer.sku]: Number(event.target.value) }))
                      }
                      slotProps={{ htmlInput: { 'aria-label': `Quantity of ${offer.name}` } }}
                    >
                      {QUANTITIES.map((quantity) => (
                        <MenuItem key={quantity} value={quantity}>
                          {quantity}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            select
            size="small"
            label={TEXT.shipping}
            value={shippingMethod}
            onChange={(event) => setShippingMethod(event.target.value as PosHardwareShippingMethod)}
            sx={{ minWidth: { sm: '40%' } }}
          >
            {catalog.shipping.map((option) => (
              <MenuItem key={option.method} value={option.method}>
                {`${option.label} · ${formatPosHardwareCents(option.cents)}`}
              </MenuItem>
            ))}
          </TextField>
          <Stack spacing={0.5} sx={{ flex: 1 }} aria-label="Order summary">
            <SummaryRow label={TEXT.items} value={formatPosHardwareCents(subtotalCents)} />
            <SummaryRow label={TEXT.shipping} value={shipping ? formatPosHardwareCents(shipping.cents) : '—'} />
            {catalog.automaticTax ? <SummaryRow label={TEXT.tax} value={TEXT.taxAtCheckout} /> : null}
            <SummaryRow
              label={basket.totalLabel}
              value={formatPosHardwareCents(basket.totalCents)}
              strong
            />
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {TEXT.shipsTo}
        </Typography>
        <Stack>
          <FormControlLabel
            control={<Checkbox checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />}
            label={
              <Typography variant="body2">
                {TEXT.termsBefore}
                <Link href={posHardwareTermsUrl()} target="_blank" rel="noopener noreferrer">
                  {TEXT.termsLink}
                </Link>
                {TEXT.termsAfter}
              </Typography>
            }
          />
          <FormControlLabel
            control={<Checkbox checked={businessUse} onChange={(event) => setBusinessUse(event.target.checked)} />}
            label={<Typography variant="body2">{TEXT.businessUse}</Typography>}
          />
        </Stack>
        {ordersSection}
      </Stack>
    </CardDisplay>
  )
}
PosHardwareCard.displayName = 'PosHardwareCard'

function SummaryRow(props: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" color={props.strong ? 'text.primary' : 'text.secondary'}>
        {props.label}
      </Typography>
      <Typography variant="body2" sx={props.strong ? { fontWeight: 'fontWeightMedium' } : undefined}>
        {props.value}
      </Typography>
    </Stack>
  )
}

export default PosHardwareCard
