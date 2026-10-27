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
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  type PosHardwareOrderStatus,
  type PosHardwareShippingMethod,
} from '../../model/pos-hardware'
import { newAttemptKey } from './pos/pos-api'
import {
  openPosHardwareCheckout,
  posHardwareCatalog,
  posHardwareCheckout,
  posHardwareOrders,
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
   * Whether the viewer may work this site's register — the same gate the
   * shop's route asks (`managePos` on an admin or editor role). The shop is
   * the register's hardware, so a viewer who may not run it is not shown it.
   */
  canManagePos?: boolean
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
 */
export function PosHardwareCard({ hostId, canManagePos = false }: PosHardwareCardProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [catalog, setCatalog] = useState<PosHardwareCatalog | null>(null)
  const [orders, setOrders] = useState<PosHardwareOrderRow[] | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [shippingMethod, setShippingMethod] = useState<PosHardwareShippingMethod | ''>('')
  const [busy, setBusy] = useState(false)
  const [returned, setReturned] = useState<'placed' | 'canceled' | null>(null)
  const uid = user?.uid ?? ''

  useEffect(() => {
    if (!user || !canManagePos) return
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
  }, [uid, hostId, canManagePos])

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

  useEffect(() => {
    if (available) void loadOrders()
  }, [available, loadOrders])

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

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([sku, quantity]) => ({ sku, quantity })),
    [quantities],
  )
  const shipping = catalog?.available ? catalog.shipping.find((option) => option.method === shippingMethod) : undefined
  const subtotalCents = catalog?.available
    ? lines.reduce(
        (sum, line) => sum + (catalog.offers.find((offer) => offer.sku === line.sku)?.unitCents ?? 0) * line.quantity,
        0,
      )
    : 0

  // One attempt per basket: a second press of the same basket reaches the
  // same Checkout Session, and a changed basket is a new one.
  const basketKey = JSON.stringify([lines, shippingMethod])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attemptKey = useMemo(() => newAttemptKey(), [basketKey])

  const checkout = async () => {
    if (!user || !shippingMethod || !lines.length) return
    setBusy(true)
    try {
      const { url } = await posHardwareCheckout(user, attemptKey, { hostId, lines, shippingMethod })
      openPosHardwareCheckout(url)
    } catch (error) {
      enqueueSnackbar(
        error instanceof PosHardwareRequestError ? error.message : 'Checkout could not be started',
        { variant: 'warning', persist: false },
      )
      setBusy(false)
    }
  }

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'number', headerName: 'Order', minWidth: 110 },
      {
        field: 'createdAtMs',
        headerName: 'Placed',
        type: 'number',
        minWidth: 120,
        align: 'left',
        headerAlign: 'left',
        valueFormatter: (value: number) => placedOn(value),
      },
      {
        field: 'items',
        headerName: 'Items',
        flex: 1,
        minWidth: 200,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) =>
          row.lines.map((line) => `${line.name} × ${line.quantity}`).join(', '),
      },
      {
        field: 'totalCents',
        headerName: 'Total',
        type: 'number',
        minWidth: 100,
        valueFormatter: (value: number) => formatPosHardwareCents(value),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 130,
        valueGetter: (_value: unknown, row: PosHardwareOrderRow) => POS_HARDWARE_STATUS_LABELS[row.status],
        renderCell: ({ row }: { row: PosHardwareOrderRow }) => (
          <Chip size="small" color={POS_HARDWARE_STATUS_COLOR[row.status]} label={POS_HARDWARE_STATUS_LABELS[row.status]} />
        ),
      },
      {
        field: 'tracking',
        headerName: 'Tracking',
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

  if (!available || !catalog?.available) return null

  return (
    <CardDisplay
      id={POS_HARDWARE_ANCHOR}
      header={'Hardware'}
      subheader={'Card readers from Stripe, shipped straight to you'}
      help={pluginDocsHelp('posHardware', { anchor: '#buy-a-reader-from-aglyn' })}
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            disabled={busy || !lines.length || !shipping}
            onClick={() => void checkout()}
          >
            {'Check out'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {returned === 'placed' ? (
          <Alert severity="success" onClose={() => setReturned(null)}>
            {'Thanks, your order is in. It shows under Your orders within a minute, and we email you as it ships.'}
          </Alert>
        ) : returned === 'canceled' ? (
          <Alert severity="info" onClose={() => setReturned(null)}>
            {'Checkout was canceled. Nothing was charged.'}
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {'Choose the readers and accessories you need. Stripe ships them to the address you enter at checkout, and you add each reader to a register on the POS devices card when it arrives.'}
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
                  {offer.mayBeDiscontinued ? (
                    <Typography variant="caption" color="text.secondary">
                      {'Stripe may stop selling this reader.'}
                    </Typography>
                  ) : null}
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body1">{formatPosHardwareCents(offer.unitCents)}</Typography>
                    <TextField
                      select
                      size="small"
                      label="Quantity"
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
            label="Shipping"
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
            <SummaryRow label="Items" value={formatPosHardwareCents(subtotalCents)} />
            <SummaryRow label="Shipping" value={shipping ? formatPosHardwareCents(shipping.cents) : '—'} />
            {catalog.automaticTax ? <SummaryRow label="Tax" value="Calculated at checkout" /> : null}
            <SummaryRow
              label={catalog.automaticTax ? 'Total before tax' : 'Total'}
              value={formatPosHardwareCents(subtotalCents + (shipping?.cents ?? 0))}
              strong
            />
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {'Ships to street addresses in the United States. P.O. boxes and military addresses are not accepted.'}
        </Typography>
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Your orders'}</Typography>
          {orders && orders.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No hardware orders yet.'}
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
        </Stack>
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
