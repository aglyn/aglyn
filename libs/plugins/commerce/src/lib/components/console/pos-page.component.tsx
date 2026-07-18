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

import * as Aglyn from '@aglyn/aglyn'
import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import * as CommerceModel from '../../model'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc, useHostOrgId } from '@aglyn/tenant-feature-instance'

interface RegisterLine {
  productId: string
  variantId?: string
  name: string
  variantLabel?: string
  unitAmountCents: number
  quantity: number
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * POS register (AGL-312): touch-first full-screen sale surface —
 * product grid with search/barcode (keyboard-wedge scanners type into
 * the search box and press Enter), a register cart with a whole-sale
 * discount, and cash / QR-card / reservation-folio settlement through
 * the server-priced pos-order API. Receipts print via the browser.
 */
export function PosConsolePage({ hostId }: ConsolePluginPageProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(500)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: registerDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const orgId = useHostOrgId(hostId)
  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId ?? '-pending-'),
    [firestore, orgId],
  )
  const registers = [...(registerDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Only registers within the plan cap can transact (pos-order.ts enforces
  // this at sale time by creation rank, AGL-482) — offer only those.
  const registerCap = Aglyn.checkQuota(org, 'posRegisters', registers.length).limit
  const withinCap = CommerceModel.registersWithinCap(registers, registerCap)
  const usableRegisters = registers.filter((r: any) => withinCap.has(r.$id))
  const { data: reservationDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'reservations'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const openStays = (reservationDocs ?? []).filter(
    (reservation: any) => reservation.status === 'checked_in',
  )

  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<RegisterLine[]>([])
  const [discountPct, setDiscountPct] = useState(0)
  const [customerEmail, setCustomerEmail] = useState('')
  const [locationId, setLocationId] = useState('')
  // Register (AGL-472): a sale must run through a named register so the
  // `posRegisters` cap is meaningful and takings are attributable.
  const [registerId, setRegisterId] = useState('')
  // Default to the first register once they load; if that register pins a
  // location, adopt it (the cashier can still override below).
  useEffect(() => {
    if (registerId || usableRegisters.length === 0) return
    const first = usableRegisters[0]
    setRegisterId(first.$id)
    if (first.locationId) setLocationId(first.locationId)
  }, [usableRegisters, registerId])
  const [paying, setPaying] = useState<'cash' | 'link' | 'folio' | null>(null)
  const [cashReceived, setCashReceived] = useState('')
  const [folioReservation, setFolioReservation] = useState('')
  const [cardUrl, setCardUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastReceipt, setLastReceipt] = useState<{
    lines: RegisterLine[]
    totalCents: number
    changeCents: number
  } | null>(null)

  const products = useMemo(
    () =>
      [...(productDocs ?? [])]
        .filter((product: any) => !product.deletedAt)
        .map((product: any) => ({
          ...CommerceModel.liftLegacyProduct(product),
          $id: product.$id,
        }))
        .filter((product: any) => product.status === 'active'),
    [productDocs],
  )
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return products
    return products.filter(
      (product: any) =>
        product.name.toLowerCase().includes(needle) ||
        product.variants.some(
          (variant: any) =>
            variant.sku?.toLowerCase() === needle ||
            variant.barcode === needle,
        ),
    )
  }, [products, search])

  const itemsCents = lines.reduce(
    (sum, line) => sum + line.unitAmountCents * line.quantity,
    0,
  )
  const discountCents = Math.round((itemsCents * discountPct) / 100)
  const dueCents = itemsCents - discountCents

  const addProduct = useCallback((product: any, variant?: any) => {
    const pick = variant ?? product.variants[0]
    setLines((prev) => {
      const key = `${product.$id}:${pick.id}`
      const existing = prev.find(
        (line) => `${line.productId}:${line.variantId ?? pick.id}` === key,
      )
      if (existing) {
        return prev.map((line) =>
          line === existing
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        )
      }
      return [
        ...prev,
        {
          productId: product.$id,
          ...(pick.id !== 'default' ? { variantId: pick.id } : {}),
          name: product.name,
          ...(Object.keys(pick.options ?? {}).length
            ? { variantLabel: Object.values(pick.options ?? {}).join(' / ') }
            : {}),
          unitAmountCents: Math.round(Number(pick.priceUsd) * 100),
          quantity: 1,
        },
      ]
    })
  }, [])

  // Barcode wedge: scanners type + Enter; exact SKU/barcode adds it.
  const handleSearchEnter = useCallback(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return
    for (const product of products) {
      const variant = product.variants.find(
        (item: any) =>
          item.sku?.toLowerCase() === needle || item.barcode === needle,
      )
      if (variant) {
        addProduct(product, variant)
        setSearch('')
        return
      }
    }
  }, [search, products, addProduct])

  const settle = useCallback(async () => {
    if (busy || lines.length === 0 || !paying) return
    if (!registerId) {
      return void enqueueSnackbar(
        'Select a register before taking payment',
        { variant: 'warning', persist: false },
      )
    }
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/pos-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          lines,
          discountPct,
          payment: paying,
          registerId,
          customerEmail: customerEmail || undefined,
          locationId: locationId || undefined,
          cashReceivedCents: Math.round(Number(cashReceived) * 100) || 0,
          reservationId: paying === 'folio' ? folioReservation : undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Sale failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (paying === 'link' && payload.url) {
        setCardUrl(payload.url)
        return
      }
      setLastReceipt({
        lines,
        totalCents: payload.totals?.totalCents ?? dueCents,
        changeCents: payload.changeCents ?? 0,
      })
      setLines([])
      setDiscountPct(0)
      setCustomerEmail('')
      setCashReceived('')
      setPaying(null)
      enqueueSnackbar(
        payload.changeCents > 0
          ? `Paid — change ${usd(payload.changeCents)}`
          : 'Paid',
        { variant: 'success', persist: false },
      )
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    lines,
    paying,
    registerId,
    user,
    hostId,
    discountPct,
    customerEmail,
    locationId,
    cashReceived,
    folioReservation,
    dueCents,
    enqueueSnackbar,
  ])

  const printReceipt = useCallback(() => {
    if (!lastReceipt) return
    const win = window.open('', '_blank', 'width=320,height=600')
    if (!win) return
    win.document.write(
      `<pre style="font-family:monospace;font-size:12px">` +
        lastReceipt.lines
          .map(
            (line) =>
              `${line.quantity}x ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}` +
              `  ${usd(line.unitAmountCents * line.quantity)}`,
          )
          .join('\n') +
        `\n\nTOTAL  ${usd(lastReceipt.totalCents)}` +
        (lastReceipt.changeCents
          ? `\nCHANGE ${usd(lastReceipt.changeCents)}`
          : '') +
        `\n${new Date().toLocaleString()}` +
        `</pre><script>window.print()</script>`,
    )
    win.document.close()
  }, [lastReceipt])

  return (
    <>
      <NextPageTitle screen={'POS'} />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Product grid */}
        <Box sx={{ flex: 1, p: 2, overflowY: 'auto' }}>
          <TextField
            placeholder="Search or scan barcode…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSearchEnter()
            }}
            size="small"
            fullWidth
            autoFocus
            sx={{ mb: 2 }}
          />
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            }}
          >
            {visible.map((product: any) => (
              <Card key={product.$id} variant="outlined">
                <CardActionArea
                  onClick={() => addProduct(product)}
                  sx={{ p: 1.5, minHeight: 88 }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {product.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`$${product.variants[0]?.priceUsd ?? 0}`}
                    {product.variants.length > 1
                      ? ` · ${product.variants.length} variants`
                      : ''}
                  </Typography>
                </CardActionArea>
                {product.variants.length > 1 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, p: 0.5 }}>
                    {product.variants.slice(0, 6).map((variant: any) => (
                      <Chip
                        key={variant.id}
                        label={
                          Object.values(variant.options ?? {}).join('/') ||
                          'Default'
                        }
                        size="small"
                        onClick={() => addProduct(product, variant)}
                      />
                    ))}
                  </Box>
                ) : null}
              </Card>
            ))}
          </Box>
        </Box>

        {/* Register */}
        <Box
          sx={{
            width: 380,
            borderLeft: 1,
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            p: 2,
            gap: 1,
          }}
        >
          <Typography variant="h6">{'Register'}</Typography>
          {usableRegisters.length === 0 ? (
            <Typography variant="body2" color="warning.main">
              {registers.length > 0
                ? 'Your registers exceed your plan — remove extras or ' +
                  'upgrade in Billing to take payments.'
                : 'No POS register yet. Add one under Commerce → Settings → ' +
                  'POS registers before taking payments.'}
            </Typography>
          ) : usableRegisters.length > 1 ? (
            <TextField
              label="Register"
              value={registerId}
              onChange={(event) => setRegisterId(event.target.value)}
              size="small"
              select
            >
              {usableRegisters.map((register: any) => (
                <MenuItem key={register.$id} value={register.$id}>
                  {register.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {usableRegisters[0]?.name}
            </Typography>
          )}
          {(locationDocs?.length ?? 0) > 1 ? (
            <TextField
              label="Location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              size="small"
              select
            >
              {(locationDocs ?? []).map((location: any) => (
                <MenuItem key={location.$id} value={location.$id}>
                  {location.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {lines.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'Tap products to add them.'}
              </Typography>
            ) : (
              lines.map((line, index) => (
                <Stack
                  key={index}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', py: 0.5 }}
                >
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {`${line.quantity}× ${line.name}`}
                    {line.variantLabel ? ` (${line.variantLabel})` : ''}
                  </Typography>
                  <Typography variant="body2">
                    {usd(line.unitAmountCents * line.quantity)}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      setLines((prev) =>
                        prev.filter((_item, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    {'✕'}
                  </Button>
                </Stack>
              ))
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Discount %"
              value={discountPct || ''}
              onChange={(event) =>
                setDiscountPct(
                  Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                )
              }
              size="small"
              sx={{ width: 110 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              label="Customer email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
          </Stack>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6">{'Due'}</Typography>
            <Typography variant="h6">{usd(dueCents)}</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="secondary"
              disabled={lines.length === 0}
              onClick={() => setPaying('cash')}
              sx={{ flex: 1 }}
            >
              {'Cash'}
            </Button>
            <Button
              variant="contained"
              disabled={lines.length === 0}
              onClick={() => {
                setPaying('link')
                void settle()
              }}
              sx={{ flex: 1 }}
            >
              {'Card (QR)'}
            </Button>
            <Button
              variant="outlined"
              disabled={lines.length === 0 || openStays.length === 0}
              onClick={() => setPaying('folio')}
              sx={{ flex: 1 }}
            >
              {'Room'}
            </Button>
          </Stack>
          {lastReceipt ? (
            <Button size="small" onClick={printReceipt}>
              {'Print last receipt'}
            </Button>
          ) : null}
        </Box>
      </Box>

      {/* Cash dialog */}
      <Dialog open={paying === 'cash'} onClose={() => setPaying(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{`Cash — due ${usd(dueCents)}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Cash received ($)"
            value={cashReceived}
            onChange={(event) =>
              setCashReceived(event.target.value.replace(/[^0-9.]/g, ''))
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          {Number(cashReceived) * 100 >= dueCents && cashReceived ? (
            <Alert severity="success">
              {`Change: ${usd(Math.round(Number(cashReceived) * 100) - dueCents)}`}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaying(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={busy || Math.round(Number(cashReceived) * 100) < dueCents}
            onClick={settle}
          >
            {'Complete sale'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Folio dialog */}
      <Dialog open={paying === 'folio'} onClose={() => setPaying(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{`Charge to room — ${usd(dueCents)}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Checked-in stay"
            value={folioReservation}
            onChange={(event) => setFolioReservation(event.target.value)}
            size="small"
            select
            sx={{ mt: 1 }}
          >
            {openStays.map((stay: any) => (
              <MenuItem key={stay.$id} value={stay.$id}>
                {stay.guestName ?? stay.guestEmail ?? stay.$id}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaying(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={busy || !folioReservation}
            onClick={settle}
          >
            {'Charge folio'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Card QR dialog */}
      <Dialog open={Boolean(cardUrl)} onClose={() => setCardUrl('')} maxWidth="xs" fullWidth>
        <DialogTitle>{'Customer pays by card'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'Show this QR (or open the link on the customer display); the ' +
              'order completes automatically once paid. Stripe Terminal ' +
              'readers can replace this step later.'}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box
              component="img"
              alt="Payment QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(cardUrl)}`}
              sx={{ width: 220, height: 220 }}
            />
          </Box>
          <Button size="small" href={cardUrl} target="_blank">
            {'Open payment page'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCardUrl('')
              setLines([])
              setPaying(null)
            }}
          >
            {'Done'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
PosConsolePage.displayName = 'PosConsolePage'

export default PosConsolePage
