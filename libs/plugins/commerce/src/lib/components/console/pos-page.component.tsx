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
import { useViewportFill } from '@aglyn/shared-ui-jsx/hooks/use-viewport-fill'
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
import { ScanAdornment } from '../../barcode/scan-button.component'
import { useScannerWedge } from '../../barcode/scanner-wedge'
import {
  PosCustomerLookup,
  PosLastReceipt,
  PosOperationsBar,
  usePosCashier,
  usePosOpsSettings,
  type PosSelectedCustomer,
} from './pos-ops/register-ops'
import { POS_QUICK_KEYS, POS_TOUCH_PX, PosProductGrid } from './pos/pos-product-grid.component'
import { PosItemDialog, posItemNeedsChoice, type PosItemChoice } from './pos/pos-item-dialog.component'
import { PosReceiptPanel } from './pos/pos-receipt-panel.component'
import { PosTenderPanel } from './pos/pos-tender-panel.component'
import { posDisplayTipCents, usePosDisplay } from './pos/use-pos-display'

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
  /** The Quick keys chip (AGL-3607): products marked `posQuickKey`. */
  quickKeys?: boolean
}) {
  const typed = options.search?.trim()
  const plan = planListQuery(
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
  // The Quick keys chip (AGL-3607) is a boolean equality the list planner
  // does not model, added beside the scope and status it composes with —
  // `deletedAt ==, status ==, posQuickKey ==, nameLower ASC` is declared in
  // the index file. A typed word searches the whole catalog instead: a
  // cashier who types is looking past the quick keys.
  if (options.quickKeys && !typed && !options.code) {
    return {
      ...plan,
      filters: [...plan.filters, { path: 'posQuickKey', op: '==', value: true }],
    } as typeof plan
  }
  return plan
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
/** Where a register device remembers the category chip it was left on. */
const POS_CATEGORY_KEY = 'aglyn.pos.category'

/** The basket line an item-sheet choice makes: label and estimate from the product. */
export function registerLineFor(
  product: any,
  choice: PosItemChoice,
): RegisterLine {
  const { variant, modifiers, quantity } = choice
  const resolved = CommerceModel.resolveLineModifiers(product, modifiers)
  const picked = resolved.ok ? resolved.modifiers : []
  const label = CommerceModel.lineLabelWithModifiers(
    Object.keys(variant.options ?? {}).length
      ? Object.values(variant.options ?? {}).join(' / ')
      : undefined,
    picked,
  )
  return {
    productId: product.$id,
    ...(variant.id !== 'default' ? { variantId: variant.id } : {}),
    name: product.name,
    ...(label ? { variantLabel: label } : {}),
    unitAmountCents:
      Math.round(Number(variant.priceUsd) * 100) + (resolved.ok ? resolved.extraCents : 0),
    quantity,
    ...(modifiers.length ? { modifiers } : {}),
  }
}

/** Same product, variant and choices: the lines that merge into one. */
function lineKey(line: Pick<RegisterLine, 'productId' | 'variantId' | 'modifiers'>): string {
  return `${line.productId}:${line.variantId ?? ''}:${CommerceModel.modifierSelectionKey(line.modifiers)}`
}

export function PosConsolePage({ hostId }: ConsolePluginPageProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))

  const [search, setSearch] = useState('')
  // The chip a register opens on is remembered per device: a counter that
  // rings from its quick keys reopens on them.
  const [categoryId, setCategoryIdState] = useState(() => {
    try {
      return window.localStorage.getItem(POS_CATEGORY_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const setCategoryId = useCallback((id: string) => {
    setCategoryIdState(id)
    try {
      window.localStorage.setItem(POS_CATEGORY_KEY, id)
    } catch {
      // Storage blocked: the chip still works for this visit.
    }
  }, [])
  const gridPlan = useMemo(
    () =>
      categoryId === POS_QUICK_KEYS
        ? posProductPlan({ search, quickKeys: true })
        : posProductPlan({ search, categoryId }),
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
  // The customer the lookup attached (AGL-3609); their email is the sale's.
  const [customer, setCustomer] = useState<PosSelectedCustomer | null>(null)
  const customerEmail = customer?.email ?? ''
  const [locationId, setLocationId] = useState('')
  const [registerId, setRegisterId] = useState('')
  useEffect(() => {
    if (registerId || usableRegisters.length === 0) return
    const first = usableRegisters[0]
    setRegisterId(first.$id)
    if (first.locationId) setLocationId(first.locationId)
  }, [usableRegisters, registerId])
  const registerName = String(
    usableRegisters.find((register: any) => register.$id === registerId)?.name ?? '',
  )
  // Who is ringing (AGL-3609): a PIN-switched cashier, and the idle lock.
  const opsSettings = usePosOpsSettings(hostId)
  const cashier = usePosCashier({
    hostId,
    registerId,
    autoLockMinutes: opsSettings.autoLockMinutes,
  })
  // The last completed sale, whose receipt can still be printed (AGL-3609).
  const [lastReceipt, setLastReceipt] = useState<{ orderId: string } | null>(null)

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
  const fill = useViewportFill({ min: 480 })
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

  /**
   * Adds a line, or more of an identical one: the same product, variant and
   * modifiers merge, so two oat lattes are one line of two and an oat latte
   * beside a whole-milk one stays two lines.
   */
  const addProduct = useCallback(
    (product: any, variant?: any, modifiers: CommerceModel.ModifierSelection[] = [], quantity = 1) => {
      const next = registerLineFor(product, {
        variant: variant ?? product.variants[0],
        modifiers,
        quantity,
      })
      setLines((prev) => {
        const existing = prev.find((line) => lineKey(line) === lineKey(next))
        if (existing) {
          return prev.map((line) =>
            line === existing
              ? { ...line, quantity: Math.min(99, line.quantity + next.quantity) }
              : line,
          )
        }
        return [...prev, next]
      })
    },
    [],
  )

  /** The item sheet: a product to add, or a basket line to change. */
  const [itemSheet, setItemSheet] = useState<{
    product: any
    editIndex?: number
    initial?: { variantId?: string; modifiers?: CommerceModel.ModifierSelection[]; quantity: number }
  } | null>(null)
  // Every product rung up this sale, so a line can be reopened after the
  // grid has moved on to another category or search.
  const productCache = useRef(new Map<string, any>())
  const tapProduct = useCallback(
    (product: any, variant?: any) => {
      productCache.current.set(product.$id, product)
      if (posItemNeedsChoice(product) && !(variant && CommerceModel.productModifierGroups(product).length === 0)) {
        setItemSheet({
          product,
          ...(variant ? { initial: { variantId: variant.id, quantity: 1 } } : {}),
        })
        return
      }
      addProduct(product, variant)
    },
    [addProduct],
  )
  const basketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const line of lines) counts.set(line.productId, (counts.get(line.productId) ?? 0) + line.quantity)
    return counts
  }, [lines])

  /**
   * The barcode wedge: a LOOKUP against the whole catalog (AGL-2501),
   * barcode first, and a miss says so.
   */
  const lookupCode = useCallback(async (scanned: string) => {
    const needle = scanned.trim().toLowerCase()
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
    if (!hit) return void notify(`No product matches “${scanned.trim()}”`, 'warning')
    const product = { ...CommerceModel.liftLegacyProduct(hit.data() as any), $id: hit.id }
    const variant =
      product.variants.find(
        (item: any) =>
          item.barcode?.trim().toLowerCase() === needle || item.sku?.trim().toLowerCase() === needle,
      ) ?? product.variants[0]
    // A scanned variant is the variant; a product with modifiers still asks
    // for them, with that variant already picked.
    tapProduct(product, variant)
    setSearch('')
  }, [sale, firestore, hostId, tapProduct, notify])
  const handleSearchEnter = useCallback(() => lookupCode(search), [lookupCode, search])
  // A scanner fired while focus is on a product or a button (AGL-3619), and
  // the camera; neither while a sale is taking payment or an item is open.
  useScannerWedge((code) => void lookupCode(code), !sale && !itemSheet)
  const scanAdornment = useMemo(
    () => <ScanAdornment label="Scan a barcode with the camera" onScan={(code) => void lookupCode(code)} />,
    [lookupCode],
  )

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
        ...(customer ? { customer } : {}),
        ...(cashier.assertion ? { cashierAssertion: cashier.assertion } : {}),
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
  }, [lines, user, registerId, hostId, discountPct, customerEmail, customer, cashier.assertion, locationId, notify])

  const resetSale = useCallback(() => {
    if (sale?.status === 'paid') setLastReceipt({ orderId: sale.orderId })
    setSale(null)
    setSaleLines([])
    setLines([])
    setDiscountPct(0)
    setCustomer(null)
    setSheetOpen(false)
  }, [sale])

  // The customer display mirrors the basket while nothing else is on it.
  const mirrored = sale ? saleLines : lines
  // Whether the display was last left showing a basket. A paid sale leaves it
  // on the thank-you the server wrote, which an empty new basket must not
  // cut short with the idle screen; the next item added takes it over.
  // True at first, so a register that opens empty clears whatever a previous
  // session left on the screen.
  const displayShowsBasket = useRef(true)
  // The tip picked for the payment about to be taken; the ledger has it only
  // once that payment is recorded. Gone with the sale.
  const [pendingTipCents, setPendingTipCents] = useState(0)
  useEffect(() => {
    if (!sale || sale.status === 'paid') setPendingTipCents(0)
  }, [sale])
  useEffect(() => {
    if (sale?.status === 'paid') displayShowsBasket.current = false
  }, [sale?.status])
  useEffect(() => {
    if (!display.connected || display.asking) return
    if (sale?.payments.some((payment) => payment.status === 'pending' && payment.method === 'card_present')) {
      return
    }
    if (sale?.status === 'paid') return
    if (!mirrored.length && !displayShowsBasket.current) return
    const timer = setTimeout(() => {
      displayShowsBasket.current = mirrored.length > 0
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
                ...(sale
                  ? {
                      paidCents: sale.paidCents,
                      dueCents: sale.dueCents,
                      tipCents: posDisplayTipCents(sale, pendingTipCents),
                    }
                  : {}),
              },
            }
          : { mode: 'idle' },
      )
    }, 400)
    return () => clearTimeout(timer)
  }, [display, mirrored, sale, itemsCents, discountCents, estimateCents, pendingTipCents])

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

  /**
   * On a narrow screen the register's bar owns the bottom edge, so it moves
   * the console's floating launchers clear of itself through the shell's
   * `--aglyn-dock-inset-bottom` seam; a launcher left in the corner sat on
   * top of Charge.
   */
  const bottomBarRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = bottomBarRef.current
    if (wide || !node) return undefined
    const root = document.documentElement
    const property = '--aglyn-dock-inset-bottom'
    const publish = () => {
      root.style.setProperty(property, `${Math.round(node.getBoundingClientRect().height) + 20}px`)
    }
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(node)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(property)
    }
  }, [wide])

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
      {registerId ? (
        <PosOperationsBar
          hostId={hostId}
          registerId={registerId}
          {...(registerName ? { registerName } : {})}
          cashier={cashier}
          onExchange={(returned) =>
            setCustomer(
              returned.email || returned.name
                ? { kind: 'none', id: '', name: returned.name ?? '', email: returned.email, phone: null }
                : null,
            )
          }
        />
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
        onEdit={(index) => {
          const line = lines[index]
          const product = line
            ? (productCache.current.get(line.productId) ?? productsById.get(line.productId))
            : undefined
          if (!line || !product) return
          setItemSheet({
            product,
            editIndex: index,
            initial: {
              ...(line.variantId ? { variantId: line.variantId } : {}),
              ...(line.modifiers ? { modifiers: line.modifiers } : {}),
              quantity: line.quantity,
            },
          })
        }}
        discountPct={discountPct}
        onDiscountPct={setDiscountPct}
        customer={
          sale ? null : <PosCustomerLookup hostId={hostId} value={customer} onChange={setCustomer} />
        }
        locked={Boolean(sale)}
      />
      {sale && user ? (
        sale.status === 'paid' ? (
          <PosReceiptPanel
            user={user}
            hostId={hostId}
            sale={sale}
            context={context}
            display={display}
            onNewSale={resetSale}
            registerId={registerId}
            {...(registerName ? { registerName } : {})}
            {...(cashier.cashier ? { cashierName: cashier.cashier.name } : {})}
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
            onTipChange={setPendingTipCents}
            {...(cashier.assertion ? { cashierAssertion: cashier.assertion } : {})}
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
          {lastReceipt ? (
            <PosLastReceipt
              hostId={hostId}
              orderId={lastReceipt.orderId}
              {...(registerName ? { registerName } : {})}
              {...(cashier.cashier ? { cashierName: cashier.cashier.name } : {})}
            />
          ) : null}
        </>
      )}
    </Stack>
  )

  return (
    <>
      <NextPageTitle screen={'POS'} />
      <Box
        ref={fill.ref}
        sx={{
          display: 'flex',
          // From under the console's header, nav and page title to the
          // bottom of the window, not a whole window tall below them.
          height: fill.height,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, p: 2, overflowY: 'auto', pb: wide ? 2 : 12 }}>
          <PosProductGrid
            search={search}
            onSearch={setSearch}
            onSearchEnter={() => void handleSearchEnter()}
            scanAdornment={scanAdornment}
            categories={(categoryDocs ?? []).map((category: any) => ({
              $id: category.$id,
              name: String(category.name ?? 'Category'),
            }))}
            categoryId={categoryId}
            onCategory={setCategoryId}
            notices={gridPlan.notices}
            hostId={hostId}
            products={products}
            basketCounts={basketCounts}
            onTap={(product) => {
              if (sale) return void notify('Finish or void the open sale first', 'info')
              tapProduct(product)
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
            ref={bottomBarRef}
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
      <PosItemDialog
        product={itemSheet?.product ?? null}
        initial={itemSheet?.initial}
        onClose={() => setItemSheet(null)}
        onConfirm={(choice) => {
          const sheet = itemSheet
          setItemSheet(null)
          if (!sheet) return
          if (sheet.editIndex === undefined) {
            addProduct(sheet.product, choice.variant, choice.modifiers, choice.quantity)
            return
          }
          const at = sheet.editIndex
          setLines((prev) =>
            prev.map((line, index) => (index === at ? registerLineFor(sheet.product, choice) : line)),
          )
        }}
        {...(itemSheet?.editIndex !== undefined
          ? {
              onRemove: () => {
                const at = itemSheet.editIndex
                setItemSheet(null)
                setLines((prev) => prev.filter((_line, index) => index !== at))
              },
            }
          : {})}
      />
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
