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
import { PRODUCT_LIST_FILTER_FIELDS } from '../../constants/product-filters'
import { escapeHtml } from '../../utils/escape-html'
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
import { QRCodeSVG } from 'qrcode.react'
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  listFilterConstraints,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'

/** How a sale is being settled. Passed to `settle` explicitly (AGL-1682). */
type Tender = 'cash' | 'link' | 'folio'

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
/*
 * `managePos` is NOT read here. The nav item in `plugin.ts` declares it and
 * the shell refuses the route before this component is constructed, so a
 * reader without the key never reaches this file and there is no unpermitted
 * state for it to render — the same arrangement the entitlement gate has.
 *
 * Re-adding a check off the `permissions` prop would be a second answer to a
 * settled question, and a laxer one: a prop absent because the map has not
 * landed reads as permitted here, while the shell holds the route on that
 * same condition rather than guessing. `server/pos-order.ts` remains the
 * enforcement point for the sale itself.
 */
export function PosConsolePage({ hostId }: ConsolePluginPageProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [search, setSearch] = useState('')
  const { data: productDocs } = useFirestoreCollection<any>(
    () => {
      /*
       * The till's grid, narrowed by the QUERY rather than by the rows it
       * happened to fetch (AGL-2501, AGL-2292).
       *
       * `limit(500)` with no `orderBy` is document-id order over
       * `createResourceUid()` — an arbitrary five hundred. Both filters then
       * ran over that sample: `status === 'active'` below, and the search.
       * The status one is the quieter of the two, because a catalog of five
       * hundred archived products and a hundred live ones would fill the
       * window with the archived and leave the register showing almost
       * nothing to sell.
       *
       * Status moves into the query, so the window is five hundred SELLABLE
       * products; the typed search moves in beside it, so a name reaches the
       * whole catalog. The scan does not come through here at all — see
       * `handleSearchEnter`, which is a lookup rather than a filter.
       */
      const typed = listFilterConstraints(
        PRODUCT_LIST_FILTER_FIELDS,
        search.trim()
          ? { field: 'name', op: 'contains', value: search.trim() }
          : null,
        // Status is already an equality on this query, so the translator must
        // not add an ordering that would have to be the first `orderBy`.
        { fixedOrderBy: 'nameLower' },
      )
      return query(
        collection(firestore, 'hosts', hostId, 'products'),
        where('status', '==', 'active'),
        ...(typed ?? []),
        ...(typed ? [orderBy('nameLower')] : [orderBy(documentId())]),
        limit(500),
      )
    },
    [firestore, hostId, search],
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
  const { org, ready: planReady } = useOrgPlan(hostId)
  const registers = [...(registerDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Only registers within the plan cap can transact (pos-order.ts enforces
  // this at sale time by creation rank, AGL-482) — offer only those.
  //
  // Not until the org doc has arrived (AGL-1064): an absent org resolves to
  // the free tier's `posRegisters: 0`, which empties this list and tells a
  // paying seller their registers exceed a plan nobody has read yet.
  // Per SITE (AGL-1775): the plan's cap plus the register seats the org has
  // allocated to this host out of the purchased pool. `checkQuota` on the
  // org-level `posRegisters` no longer carries the pool and would hide
  // registers this site is paying for.
  const registerCap = Aglyn.checkHostRegisterQuota(
    org,
    hostId,
    registers.length,
  ).limit
  const withinCap = CommerceModel.registersWithinCap(registers, registerCap)
  const usableRegisters = planReady
    ? registers.filter((r: any) => withinCap.has(r.$id))
    : []
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
  // `paying` routes the settlement DIALOGS — nothing else. It is deliberately
  // not the tender `settle` acts on (AGL-1682): it used to be both, and the
  // Card button had to `setPaying('link')` and call `settle()` in one handler,
  // where `settle` still closed over the pre-click `null` and returned at its
  // own guard. Card has no dialog of its own — the QR dialog is gated on
  // `cardUrl` — so the card path sets nothing here at all.
  const [paying, setPaying] = useState<Tender | null>(null)
  const [cashReceived, setCashReceived] = useState('')
  const [folioReservation, setFolioReservation] = useState('')
  const [cardUrl, setCardUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Re-entrancy guard for `settle`, deliberately a ref and not `busy`. `busy`
  // is for RENDERING (it disables the settle buttons); a second tap arriving
  // before React has re-rendered would read the pre-click `false` out of the
  // handler's closure exactly the way `paying` was read above. The ref is
  // written and read synchronously, so it holds whatever the scheduler does.
  // It is no longer the last line of defence — the server dedupes on the
  // attempt key below (AGL-1691) — but it is still the cheap one, and it stops
  // the redundant round trip rather than merely making it harmless.
  const inFlight = useRef(false)
  /**
   * Idempotency key for ONE settlement attempt (AGL-1691).
   *
   * The guards above are all client-side and none of them survives a reload, a
   * lost response, or a retry. `/api/commerce/pos-order` now dedupes on this
   * key, but only if the key is right, and the key is the whole design:
   *
   * - Minted lazily on the first settle of a basket, NOT per `settle()` call.
   *   Per-call would defeat the point — two taps would mint two keys and the
   *   server would see two distinct sales.
   * - Retired whenever the register's contents change (the effect below),
   *   which covers the sale completing and clearing the lines. So a cashier
   *   ringing the same coffee twice gets a NEW key and a real second order —
   *   de-duplicating that would be a worse bug than the one being fixed.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    // A different basket is a different attempt. Also fires when `settle`
    // clears the lines, which is what retires a spent key.
    attemptKey.current = ''
  }, [lines, discountPct])
  const [lastReceipt, setLastReceipt] = useState<{
    lines: RegisterLine[]
    totalCents: number
    changeCents: number
  } | null>(null)

  const products = useMemo(
    () =>
      [...(productDocs ?? [])]
        // `status` is now the query's; `deletedAt` stays here because
        // Firestore cannot ask for documents that LACK a field.
        .filter((product: any) => !product.deletedAt)
        .map((product: any) => ({
          ...CommerceModel.liftLegacyProduct(product),
          $id: product.$id,
        })),
    [productDocs],
  )
  /*
   * The grid is what the query returned. Re-filtering it by the same text
   * would narrow it AGAIN and more strictly: the server matches a word prefix
   * ("cof" finds "Coffee"), the old compare wanted the whole typed string as a
   * substring, so "flat white" was sent as "flat" and then hidden again by a
   * row that never contained "flat white". Rows found, then dropped.
   */
  const visible = products

  const productsById = useMemo(
    () => new Map(products.map((product: any) => [product.$id, product])),
    [products],
  )
  /**
   * WHAT THE COUNT SAYS, at the line the cashier is looking at (AGL-2357).
   *
   * The register ignored `oversellPolicy` entirely — `pos-order.ts` had no
   * `canPurchase` call — so a merchant who chose "deny" in the product editor
   * silently got "backorder" at the counter. That silence is the defect.
   *
   * WARNS, NEVER BLOCKS (the decision on AGL-2357). Nothing here touches
   * `disabled` on the settle buttons, and nothing gates `settle`: a till is the
   * wrong place for a stale number to stop a real sale, because the cashier is
   * holding the goods. Honouring the policy behind a manager override is the
   * post-launch shape (AGL-2372).
   *
   * Indexed alongside `lines` rather than keyed, because the line list is
   * rendered by index and two lines of the same product/variant cannot exist —
   * `addProduct` merges them into one quantity.
   */
  const shortfalls = useMemo(
    () =>
      lines.map((line) => {
        const product: any = productsById.get(line.productId)
        if (!product) return null
        return CommerceModel.stockShortfall(
          product,
          line.variantId ?? product.variants?.[0]?.id,
          line.quantity,
        )
      }),
    [lines, productsById],
  )

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

  /**
   * The barcode wedge: a scanner types the code and presses Enter.
   *
   * A LOOKUP against the whole catalog, not a scan of the rows on screen
   * (AGL-2501). It used to walk `products` — the grid's `limit(500)` window —
   * so a shop whose catalog was larger than that had items whose barcode
   * simply did nothing when scanned. At a till, holding the goods, with a
   * customer waiting.
   *
   * `barcodes` and `skus` are top-level arrays the write path flattens out of
   * `variants`, because Firestore cannot query a field inside an array of
   * objects. Barcode is tried first: it is what the scanner produced, and a
   * SKU that happens to equal another product's barcode should not win over
   * the code actually scanned.
   *
   * ⚠️ A MISS NOW SAYS SO. The old loop returned silently, so an unknown code
   * and a code outside the window were indistinguishable from a scanner that
   * had not fired — the cashier's only signal was that nothing happened.
   */
  const handleSearchEnter = useCallback(async () => {
    const needle = search.trim().toLowerCase()
    if (!needle) return
    const lookup = async (field: 'barcodes' | 'skus') => {
      const found = await getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'products'),
          where('status', '==', 'active'),
          where(field, 'array-contains', needle),
          limit(1),
        ),
      )
      return found.docs[0]
    }
    let hit: Awaited<ReturnType<typeof lookup>>
    try {
      hit = (await lookup('barcodes')) ?? (await lookup('skus'))
    } catch (error) {
      console.error(error)
      return void enqueueSnackbar('Could not reach the catalog — try again', {
        variant: 'warning',
        persist: false,
      })
    }
    if (!hit || hit.data()?.['deletedAt']) {
      return void enqueueSnackbar(`No product matches “${search.trim()}”`, {
        variant: 'warning',
        persist: false,
      })
    }
    const product = {
      ...CommerceModel.liftLegacyProduct(hit.data() as any),
      $id: hit.id,
    }
    const variant =
      product.variants.find(
        (item: any) =>
          item.barcode?.trim().toLowerCase() === needle ||
          item.sku?.trim().toLowerCase() === needle,
      ) ?? product.variants[0]
    addProduct(product, variant)
    setSearch('')
  }, [search, firestore, hostId, addProduct, enqueueSnackbar])

  /**
   * Take payment. The tender is an ARGUMENT, never read back out of state
   * (AGL-1682) — every caller already knows which button was pressed, and the
   * one caller that had to announce it through `setPaying` first could not
   * then observe its own write.
   */
  const settle = useCallback(async (tender: Tender) => {
    if (inFlight.current || lines.length === 0) return
    if (!registerId) {
      return void enqueueSnackbar(
        'Select a register before taking payment',
        { variant: 'warning', persist: false },
      )
    }
    inFlight.current = true
    setBusy(true)
    // Reuse the key across retries of this basket; mint one if this is the
    // first attempt (AGL-1691). `randomUUID` needs a secure context, which the
    // console always is, but fall back rather than throw on a settle.
    if (!attemptKey.current) {
      attemptKey.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/pos-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attemptKey.current,
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          lines,
          discountPct,
          payment: tender,
          registerId,
          customerEmail: customerEmail || undefined,
          locationId: locationId || undefined,
          cashReceivedCents: Math.round(Number(cashReceived) * 100) || 0,
          reservationId: tender === 'folio' ? folioReservation : undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Sale failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (tender === 'link' && payload.url) {
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
      inFlight.current = false
      setBusy(false)
    }
  }, [
    lines,
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

  /**
   * Close the card QR dialog. Clears the cart, because by the time this dialog
   * exists the order is already on the server awaiting the webhook — leaving
   * the lines behind meant a backdrop click or Escape dropped the cashier back
   * on a full register that would mint a SECOND pending order and a SECOND
   * Checkout session for the same basket on the next tap (AGL-1682). `Done`
   * always did this; `onClose` did not, and only `onClose` can fire by
   * accident.
   */
  const closeCardDialog = useCallback(() => {
    setCardUrl('')
    setLines([])
    setPaying(null)
  }, [])

  const printReceipt = useCallback(() => {
    if (!lastReceipt) return
    const win = window.open('', '_blank', 'width=320,height=600')
    if (!win) return
    // ESCAPED (AGL-2283), the same construction as the packing slip: a
    // `document.write` into an `about:blank` popup that inherits the console's
    // origin. These names are merchant-authored rather than shopper-typed, so
    // the reach is a merchant's own session — still not a reason to build
    // markup out of unescaped product text.
    win.document.write(
      `<pre style="font-family:monospace;font-size:12px">` +
        lastReceipt.lines
          .map(
            (line) =>
              `${escapeHtml(line.quantity)}x ${escapeHtml(line.name)}${line.variantLabel ? ` (${escapeHtml(line.variantLabel)})` : ''}` +
              `  ${usd(line.unitAmountCents * line.quantity)}`,
          )
          .join('\n') +
        `\n\nTOTAL  ${usd(lastReceipt.totalCents)}` +
        (lastReceipt.changeCents
          ? `\nCHANGE ${usd(lastReceipt.changeCents)}`
          : '') +
        `\n${new Date().toLocaleString()}` +
        `</pre>`,
    )
    win.document.close()
    // Print from HERE, not from a `<script>` written into the receipt
    // (AGL-523). `window.open('')` yields an about:blank document that
    // INHERITS the opener's CSP, so an injected inline script has no nonce and
    // `strict-dynamic` means `'self'` will not save it either. Under the
    // enforcing policy that script is blocked, the receipt window opens, and
    // the print dialog never appears — a silent break of the one action the
    // window exists for.
    //
    // This call is in the opener, whose script Next has already nonced.
    win.focus()
    win.print()
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
              if (event.key === 'Enter') void handleSearchEnter()
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
          {!planReady ? (
            <Typography variant="body2" color="text.secondary">
              {'Checking your plan…'}
            </Typography>
          ) : usableRegisters.length === 0 ? (
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
                <Box key={index} sx={{ py: 0.5 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
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
                  {shortfalls[index] ? (
                    // AGL-2357: said, not enforced. The cashier reads it and
                    // rings the sale through — the settle buttons below are
                    // untouched by this.
                    <Typography variant="caption" color="warning.main">
                      {`Only ${shortfalls[index]?.available} in stock — selling ${line.quantity}`}
                    </Typography>
                  ) : null}
                </Box>
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
              color="primary"
              disabled={lines.length === 0}
              onClick={() => setPaying('cash')}
              sx={{ flex: 1 }}
            >
              {'Cash'}
            </Button>
            <Button
              variant="contained"
              disabled={busy || lines.length === 0}
              onClick={() => void settle('link')}
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
            color="primary"
            disabled={busy || Math.round(Number(cashReceived) * 100) < dueCents}
            // `onClick={settle}` would hand MUI's click event to `tender`.
            onClick={() => void settle('cash')}
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
            color="primary"
            disabled={busy || !folioReservation}
            onClick={() => void settle('folio')}
          >
            {'Charge folio'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Card QR dialog */}
      <Dialog open={Boolean(cardUrl)} onClose={closeCardDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{'Customer pays by card'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'Show this QR (or open the link on the customer display); the ' +
              'order completes automatically once paid. Stripe Terminal ' +
              'readers can replace this step later.'}
          </Typography>
          {/* Encoded in this browser, never fetched (AGL-1671). The previous
              revision pointed an `<img>` at api.qrserver.com, which put the
              LIVE Stripe payment URL — a link that pays the order for whoever
              opens it — in a query string to a third party with no contract,
              no DPA and no logging guarantee, on every card sale. It also
              meant a register with no internet could not take a card.

              `level="L"` is what that endpoint was being asked for (its
              default `ecc`). The two numbers are MEASURED, not matched: a
              317-character Stripe Checkout URL is a 61x61 symbol, so the old
              220px/no-quiet-zone render gave 3.61px per module. `marginSize`
              adds the 4-module quiet zone the spec requires and goQR omitted
              — which matters more here than it looks, since the dialog paper
              is dark in dark mode and the symbol had no white border of its
              own. Paying for that out of 220px would shrink modules to
              3.19px; 256px puts them at 3.71px, so every module is LARGER
              than what shipped and the quiet zone is free. `maxWidth="xs"`
              leaves ~396px of content, so it still centres with room. */}
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG
              value={cardUrl}
              size={256}
              level="L"
              marginSize={4}
              title="Payment QR"
              role="img"
            />
          </Box>
          <Button size="small" href={cardUrl} target="_blank">
            {'Open payment page'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCardDialog}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
PosConsolePage.displayName = 'PosConsolePage'

export default PosConsolePage
