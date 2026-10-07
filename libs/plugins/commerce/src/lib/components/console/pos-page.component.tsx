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
import {
  PRODUCT_LIST_BASE,
  PRODUCT_LIST_QUERY,
} from '../../constants/product-list-query'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import { planListQuery } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  Badge,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'
import {
  newAttemptKey,
  openPosSale,
  posRegisterContext,
  PosRequestError,
  usd,
  type PosRegisterContext,
  type PosSaleSummary,
} from './pos/pos-api'
import { PosCartPanel, type RegisterLine } from './pos/pos-cart-panel.component'
import { POS_TOUCH_PX, PosProductGrid } from './pos/pos-product-grid.component'
import { PosReceiptPanel } from './pos/pos-receipt-panel.component'
import { PosTenderPanel } from './pos/pos-tender-panel.component'
import { usePosDisplay } from './pos/use-pos-display'

/** The till sells active products only; every read of the catalog asks it. */
const SELLABLE: ListFilterRequest = { field: 'status', op: 'equals', value: 'active' }

/**
 * How many products the till's grid shows. The grid is a picker, not the
 * catalog: typing narrows it on the query, so a name reaches every product.
 */
const POS_GRID_CEILING = 500

/**
 * The products hub's query (AGL-3321), narrowed to what the till may sell:
 * live products (`deletedAt == null`, the list's scope), `status == active`,
 * and any typed word as the search on `nameTokens` — or, for a scan, the
 * whole scanned code as a SKU or barcode clause. Every shape is one the hub's
 * composites already serve.
 */
export function posProductPlan(options: {
  search?: string
  code?: { field: 'barcodes' | 'skus'; value: string }
  /** A category chip (AGL-3607): served by the storefront's own composite. */
  categoryId?: string
}) {
  const typed = options.search?.trim()
  return planListQuery(
    POS_GRID_QUERY,
    {
      base: PRODUCT_LIST_BASE,
      clauses: [
        SELLABLE,
        ...(options.code
          ? [{ field: options.code.field, op: 'contains', value: options.code.value }]
          : []),
        ...(options.categoryId
          ? [{ field: 'categoryIds', op: 'contains', value: options.categoryId }]
          : []),
      ],
      // A chip and a typed word are both array clauses, and Firestore takes
      // one: with a chip on, the word narrows by name prefix instead.
      search: typed && !options.categoryId ? [typed] : [],
    },
    nameSearchNormalizers,
  )
}

/**
 * The grid's query: the products hub's, plus the category a chip picks
 * (AGL-3607). `categoryIds CONTAINS, nameLower ASC` is a composite the
 * storefront catalog already declares.
 */
export const POS_GRID_QUERY = {
  ...PRODUCT_LIST_QUERY,
  fields: [
    ...PRODUCT_LIST_QUERY.fields,
    {
      column: 'categoryIds',
      kind: 'exact' as const,
      path: 'categoryIds',
      tokensPath: 'categoryIds',
      operators: ['contains'],
    },
  ],
} as typeof PRODUCT_LIST_QUERY

/**
 * POS register (AGL-312, AGL-3607): a tablet-first sale surface — the
 * product grid with search, scan and category chips, the basket, and a
 * tender panel that takes one or more payments against an open sale (cash,
 * card reader, a native Tap to Pay bridge, a typed card, the QR link, gift
 * cards and room charges) until the balance is zero. A paired customer
 * display mirrors the basket and takes the tip and the receipt (AGL-3608).
 *
 * On a wide screen (900px and up) the grid and the register sit side by
 * side; below that the register is a bottom sheet behind a sticky total bar.
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
 * same condition rather than guessing. The server routes remain the
 * enforcement point for every sale and every payment.
 */
export function PosConsolePage({ hostId }: ConsolePluginPageProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const gridPlan = useMemo(
    () => posProductPlan({ search, categoryId }),
    [search, categoryId],
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    /*
     * The till's grid, narrowed by the QUERY rather than by the rows it
     * happened to fetch (AGL-2501, AGL-2292, AGL-3321): the first five
     * hundred SELLABLE products by name, and a typed name reaches the whole
     * catalog. The scan does not come through here — see `handleSearchEnter`.
     */
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'products'),
        ...listQueryConstraints(gridPlan),
        limit(POS_GRID_CEILING),
      ),
    [firestore, hostId, gridPlan],
    { idField: '$id' },
  )
  const { data: categoryDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'productCategories'), limit(30)),
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
  const { org, ready: planReady } = useOrgPlan(hostId)
  const registers = [...(registerDocs ?? [])].sort((a: any, b: any) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Only registers within the plan cap can transact (AGL-482), and not until
  // the org doc has arrived (AGL-1064). Per SITE (AGL-1775).
  const registerCap = Aglyn.checkHostRegisterQuota(org, hostId, registers.length).limit
  const withinCap = CommerceModel.registersWithinCap(registers, registerCap)
  const usableRegisters = planReady ? registers.filter((r: any) => withinCap.has(r.$id)) : []
  /*
   * The stays a sale can be charged to, asked for BY STATUS (AGL-3321).
   */
  const { data: reservationDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'reservations'),
        where('status', '==', 'checked_in'),
        limit(100),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const openStays = reservationDocs ?? []

  const [lines, setLines] = useState<RegisterLine[]>([])
  const [discountPct, setDiscountPct] = useState(0)
  const [customerEmail, setCustomerEmail] = useState('')
  const [locationId, setLocationId] = useState('')
  const [registerId, setRegisterId] = useState('')
  useEffect(() => {
    if (registerId || usableRegisters.length === 0) return
    const first = usableRegisters[0]
    setRegisterId(first.$id)
    if (first.locationId) setLocationId(first.locationId)
  }, [usableRegisters, registerId])

  const [context, setContext] = useState<PosRegisterContext | null>(null)
  // Keyed on the uid, not the user object: a session refresh hands back a
  // new object for the same person, and re-reading the context on every one
  // would re-render the register in a loop.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? ''
  useEffect(() => {
    const signedIn = userRef.current
    if (!signedIn) return
    let active = true
    posRegisterContext(signedIn, hostId)
      .then((answer) => {
        // Only a whole answer: a register that half-knows its tenders would
        // offer one the server then refuses.
        if (active && answer?.settings && answer?.terminal) setContext(answer)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [uid, hostId])

  /** The open sale, once the basket has been priced and payment started. */
  const [sale, setSale] = useState<PosSaleSummary | null>(null)
  const [saleLines, setSaleLines] = useState<RegisterLine[]>([])
  const [opening, setOpening] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pairing, setPairing] = useState<{ code: string; expiresAtMs: number } | null>(null)
  const display = usePosDisplay(user, hostId, registerId)

  /**
   * One key per basket (AGL-1691): minted on the first Charge and retired
   * whenever the basket changes, so a retried Charge finds the same sale and
   * ringing the same coffee twice is two sales.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    attemptKey.current = ''
  }, [lines, discountPct])

  const products = useMemo(
    () =>
      [...(productDocs ?? [])].map((product: any) => ({
        ...CommerceModel.liftLegacyProduct(product),
        $id: product.$id,
      })),
    [productDocs],
  )
  const productsById = useMemo(
    () => new Map(products.map((product: any) => [product.$id, product])),
    [products],
  )
  /** AGL-2357: warns, never blocks. */
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

  const itemsCents = lines.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
  const discountCents = Math.round((itemsCents * discountPct) / 100)
  const estimateCents = itemsCents - discountCents
  const units = lines.reduce((sum, line) => sum + line.quantity, 0)

  const notify = useCallback(
    (message: string, variant: 'success' | 'error' | 'warning' | 'info') => {
      enqueueSnackbar(message, { variant, persist: false, allowDuplicate: true })
    },
    [enqueueSnackbar],
  )

  const addProduct = useCallback((product: any, variant?: any) => {
    const pick = variant ?? product.variants[0]
    setLines((prev) => {
      const key = `${product.$id}:${pick.id}`
      const existing = prev.find(
        (line) => `${line.productId}:${line.variantId ?? pick.id}` === key,
      )
      if (existing) {
        return prev.map((line) =>
          line === existing ? { ...line, quantity: line.quantity + 1 } : line,
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
   * The barcode wedge: a LOOKUP against the whole catalog (AGL-2501),
   * barcode first, and a miss says so.
   */
  const handleSearchEnter = useCallback(async () => {
    const needle = search.trim().toLowerCase()
    if (!needle || sale) return
    const lookup = async (field: 'barcodes' | 'skus') => {
      const found = await getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'products'),
          ...listQueryConstraints(posProductPlan({ code: { field, value: needle } })),
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
      return void notify('Could not reach the catalog — try again', 'warning')
    }
    if (!hit) return void notify(`No product matches “${search.trim()}”`, 'warning')
    const product = { ...CommerceModel.liftLegacyProduct(hit.data() as any), $id: hit.id }
    const variant =
      product.variants.find(
        (item: any) =>
          item.barcode?.trim().toLowerCase() === needle || item.sku?.trim().toLowerCase() === needle,
      ) ?? product.variants[0]
    addProduct(product, variant)
    setSearch('')
  }, [search, sale, firestore, hostId, addProduct, notify])

  /** Prices the basket on the server and opens the sale for payment. */
  // A ref, not `opening`: two taps inside one React batch both read the
  // pre-click state, and only a ref is written before the second reads it
  // (the AGL-1682 lesson).
  const chargeInFlight = useRef(false)
  const charge = useCallback(async () => {
    if (chargeInFlight.current || lines.length === 0 || !user) return
    if (!registerId) return void notify('Select a register before taking payment', 'warning')
    if (!attemptKey.current) attemptKey.current = newAttemptKey()
    chargeInFlight.current = true
    setOpening(true)
    try {
      const opened = await openPosSale(user, attemptKey.current, {
        hostId,
        registerId,
        lines,
        discountPct,
        ...(customerEmail ? { customerEmail } : {}),
        ...(locationId ? { locationId } : {}),
      })
      setSaleLines(lines)
      setSale({
        orderId: opened.orderId,
        status: 'pending',
        totalCents: opened.totals.totalCents,
        paidCents: 0,
        dueCents: opened.totals.totalCents,
        tenderableCents: opened.totals.totalCents,
        tipCents: 0,
        payments: [],
      })
      setSheetOpen(true)
    } catch (error) {
      notify(error instanceof PosRequestError ? error.message : 'Sale failed', 'error')
    } finally {
      chargeInFlight.current = false
      setOpening(false)
    }
  }, [lines, user, registerId, hostId, discountPct, customerEmail, locationId, notify])

  const resetSale = useCallback(() => {
    setSale(null)
    setSaleLines([])
    setLines([])
    setDiscountPct(0)
    setCustomerEmail('')
    setSheetOpen(false)
  }, [])

  // The customer display mirrors the basket while nothing else is on it.
  const mirrored = sale ? saleLines : lines
  useEffect(() => {
    if (!display.connected || display.asking) return
    if (sale?.payments.some((payment) => payment.status === 'pending' && payment.method === 'card_present')) {
      return
    }
    if (sale?.status === 'paid') return
    const timer = setTimeout(() => {
      void display.show(
        mirrored.length
          ? {
              mode: 'cart',
              cart: {
                lines: mirrored.map((line) => ({
                  name: line.name,
                  ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
                  quantity: line.quantity,
                  amountCents: line.unitAmountCents * line.quantity,
                })),
                itemsCents,
                discountCents,
                taxCents: sale ? Math.max(0, sale.totalCents - estimateCents) : 0,
                totalCents: sale ? sale.totalCents : estimateCents,
                ...(sale ? { paidCents: sale.paidCents, dueCents: sale.dueCents, tipCents: sale.tipCents } : {}),
              },
            }
          : { mode: 'idle' },
      )
    }, 400)
    return () => clearTimeout(timer)
  }, [display, mirrored, sale, itemsCents, discountCents, estimateCents])

  const registerPicker = !planReady ? (
    <Typography variant="body2" color="text.secondary">
      {'Checking your plan…'}
    </Typography>
  ) : usableRegisters.length === 0 ? (
    <Typography variant="body2" color="warning.main">
      {registers.length > 0
        ? 'Your registers exceed your plan — remove extras or upgrade in Billing to take payments.'
        : 'No POS register yet. Add one under Commerce → Settings → POS registers before taking payments.'}
    </Typography>
  ) : usableRegisters.length > 1 ? (
    <TextField
      label="Register"
      value={registerId}
      onChange={(event) => setRegisterId(event.target.value)}
      size="small"
      select
      disabled={Boolean(sale)}
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
  )

  const registerPanel = (
    <Stack spacing={1.5} sx={{ minHeight: 0, flex: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {'Register'}
        </Typography>
        {registerId ? (
          <Button
            size="small"
            onClick={async () => {
              try {
                setPairing(await display.pairingCode())
              } catch (error) {
                notify(error instanceof PosRequestError ? error.message : 'Could not make a code', 'error')
              }
            }}
          >
            {display.connected ? 'Display connected' : 'Pair display'}
          </Button>
        ) : null}
      </Stack>
      {registerPicker}
      {(locationDocs?.length ?? 0) > 1 ? (
        <TextField
          label="Location"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          size="small"
          select
          disabled={Boolean(sale)}
        >
          {(locationDocs ?? []).map((location: any) => (
            <MenuItem key={location.$id} value={location.$id}>
              {location.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <PosCartPanel
        lines={sale ? saleLines : lines}
        shortfalls={sale ? [] : shortfalls}
        onQuantity={(index, quantity) =>
          setLines((prev) =>
            quantity <= 0
              ? prev.filter((_line, at) => at !== index)
              : prev.map((line, at) => (at === index ? { ...line, quantity: Math.min(99, quantity) } : line)),
          )
        }
        onRemove={(index) => setLines((prev) => prev.filter((_line, at) => at !== index))}
        discountPct={discountPct}
        onDiscountPct={setDiscountPct}
        customerEmail={customerEmail}
        onCustomerEmail={setCustomerEmail}
        locked={Boolean(sale)}
      />
      {sale && user ? (
        sale.status === 'paid' ? (
          <PosReceiptPanel
            user={user}
            hostId={hostId}
            sale={sale}
            lines={saleLines}
            context={context}
            display={display}
            onNewSale={resetSale}
            notify={notify}
          />
        ) : (
          <PosTenderPanel
            user={user}
            hostId={hostId}
            registerId={registerId}
            sale={sale}
            context={context}
            stays={openStays}
            display={display}
            onSale={setSale}
            onVoided={() => {
              setSale(null)
              setSaleLines([])
            }}
            notify={notify}
          />
        )
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6">{'Due'}</Typography>
            <Typography variant="h6">{usd(estimateCents)}</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {'Tax is added when you charge.'}
          </Typography>
          <Button
            variant="contained"
            size="large"
            disabled={opening || lines.length === 0 || !registerId}
            onClick={() => void charge()}
            sx={{ minHeight: 56 }}
          >
            {opening ? 'Pricing…' : `Charge ${usd(estimateCents)}`}
          </Button>
        </>
      )}
    </Stack>
  )

  return (
    <>
      <NextPageTitle screen={'POS'} />
      <Box
        sx={{
          display: 'flex',
          height: '100dvh',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, p: 2, overflowY: 'auto', pb: wide ? 2 : 12 }}>
          <PosProductGrid
            search={search}
            onSearch={setSearch}
            onSearchEnter={() => void handleSearchEnter()}
            categories={(categoryDocs ?? []).map((category: any) => ({
              $id: category.$id,
              name: String(category.name ?? 'Category'),
            }))}
            categoryId={categoryId}
            onCategory={setCategoryId}
            notices={gridPlan.notices}
            products={products}
            onAdd={(product, variant) => {
              if (sale) return void notify('Finish or void the open sale first', 'info')
              addProduct(product, variant)
            }}
          />
        </Box>
        {wide ? (
          <Box
            sx={{
              width: { md: 400, lg: 440 },
              borderLeft: 1,
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              p: 2,
              overflowY: 'auto',
            }}
          >
            {registerPanel}
          </Box>
        ) : null}
      </Box>
      {!wide ? (
        <>
          <Box
            sx={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              p: 1.5,
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              zIndex: theme.zIndex.appBar,
            }}
          >
            <Badge badgeContent={units} color="primary">
              <Button
                variant="outlined"
                onClick={() => setSheetOpen(true)}
                sx={{ minHeight: POS_TOUCH_PX }}
              >
                {sale ? 'Payment' : 'Cart'}
              </Button>
            </Badge>
            <Typography variant="h6" sx={{ flex: 1, textAlign: 'right' }}>
              {usd(sale ? sale.dueCents : estimateCents)}
            </Typography>
            {!sale ? (
              <Button
                variant="contained"
                disabled={opening || lines.length === 0 || !registerId}
                onClick={() => void charge()}
                sx={{ minHeight: POS_TOUCH_PX }}
              >
                {'Charge'}
              </Button>
            ) : null}
          </Box>
          <Drawer
            anchor="bottom"
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            slotProps={{ paper: { sx: { maxHeight: '90dvh', p: 2, borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
          >
            {registerPanel}
          </Drawer>
        </>
      ) : null}
      <Dialog open={Boolean(pairing)} onClose={() => setPairing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Pair a customer display'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'On the tablet facing your customer, open this address and enter the code. ' +
              'The code works once and expires in 10 minutes.'}
          </Typography>
          <Typography variant="body1" sx={{ wordBreak: 'break-all' }}>
            {`${typeof window === 'undefined' ? '' : window.location.origin}/kiosk/commerce/pos-display`}
          </Typography>
          <Typography variant="h3" component="p" sx={{ textAlign: 'center', letterSpacing: 8 }}>
            {pairing?.code}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPairing(null)}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
PosConsolePage.displayName = 'PosConsolePage'

export default PosConsolePage
