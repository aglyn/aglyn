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
import * as CommerceModel from '../../model'
import {
  PRODUCT_LIST_BASE,
  PRODUCT_LIST_FIELDS,
  PRODUCT_LIST_HEADERS,
  PRODUCT_LIST_OPTIONS,
  PRODUCT_LIST_QUERY,
  PRODUCT_LIST_SELECT_FIELDS,
  productListRequestClauses,
} from '../../constants/product-list-query'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Box,
  Button,
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
import {
  addDoc,
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryDocumentSnapshot,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  useFirestoreCollection,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  listQueryConstraints,
  useListQuery,
} from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'
import ProductEditorDialog from './product-editor-dialog.component'
import { productSlugLedger } from './product-slugs'
import ProductsHubZone from './products-hub-zone.component'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleProductsHubZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'

/** Products read per request of the CSV export's walk. */
const EXPORT_PAGE = 500

/**
 * The most products one CSV export writes (AGL-3321).
 *
 * The export walks the table's own query page by page, so it writes what the
 * filters and search match across the whole catalog rather than the rows on
 * screen. It stops here because the file is built in the browser, and says
 * so when it does.
 */
const EXPORT_CEILING = 10_000

/**
 * How many of ONE product's license keys the dialog reads.
 *
 * Per product, not per store: the query carries the `productId` equality, so
 * this bounds a single pool rather than the site's whole key collection.
 */
const KEY_POOL_CEILING = 500

export interface ProductsHubCardProps {
  hostId: string
}

type ProductRow = CommerceModel.HostProduct & { $id: string }

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning'> = {
  active: 'success',
  draft: 'warning',
  archived: 'default',
}

/** The grid's own columns; every other declared field is a hidden filter column. */
const PRODUCT_VISIBLE_COLUMNS = ['name', 'status', 'type', 'priceUsd', 'stock', 'variants']

/**
 * Products hub v1 (AGL-279): the catalog manager replacing the Commerce
 * Starter card — a table over `hosts/{hostId}/products` whose search and
 * filters are its Firestore query (AGL-3321), full editor dialog, duplicate, archive/activate, soft delete (past
 * order rows keep resolving). Product cap (`productsPerHost`, AGL-278)
 * gated here on create/duplicate/import (AGL-471); server-side
 * enforcement of the client-write path rides AGL-473.
 */
export function ProductsHubCard(props: ProductsHubCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  // Product cap (AGL-471): per-plan `productsPerHost`, same pattern as
  // locations. Console-side gate; server enforcement rides AGL-473.
  const createHostResource = useHostResourceApi()
  const { org, ready: planReady } = useOrgPlan(hostId)
  const { confirm } = useConfirmationContext()
  /*
   * The grid's Filters panel and quick search, bound to the clauses the
   * query below serves (AGL-3321). Every clause and the search word go on
   * that query; see `constants/product-list-query.ts` for what is offered.
   */
  const gridFilter = useListGridFilter({
    selectFields: PRODUCT_LIST_SELECT_FIELDS,
  })
  const filtering =
    gridFilter.clauses.length > 0 ||
    gridFilter.searchWords.some((word) => word.trim())
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [adjusting, setAdjusting] = useState<{
    product: ProductRow
    variantId: string
    delta: string
    reason: CommerceModel.InventoryAdjustmentReason
    locationId: string
  } | null>(null)
  const [importing, setImporting] = useState<{
    text: string
    parsed: CommerceModel.ProductCsvImport | null
  } | null>(null)
  const [keysFor, setKeysFor] = useState<ProductRow | null>(null)
  const [keysText, setKeysText] = useState('')
  /**
   * What the import zone set for the import in the dialog, and what the last
   * import created with those options (AGL-2916), which the hub's zone hands
   * to its widgets.
   */
  const [importOptions, setImportOptions] = useState<Record<string, boolean>>({})
  const [lastImport, setLastImport] =
    useState<ConsoleProductsHubZoneProps['lastImport']>(null)
  const WidgetSlot = useConsoleWidgetSlot()

  const {
    rows: productDocs,
    data: productWindow,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
    status: productsStatus,
    /**
     * The product rows the stock dialog is seeded from are unconfirmed by
     * the server (AGL-1358). A stock adjustment does not write the delta —
     * it recomputes the WHOLE `variants` array from the seeded product and
     * replaces it, so a cached seed silently reverts every sale, return and
     * adjustment the server has recorded since that snapshot, on every
     * variant and every location.
     */
    fromCache: productsFromCache,
  } = useListQuery<any>({
    /*
     * PAGED BY THE QUERY, and every filter ON it (AGL-3321).
     *
     * The table read a five-hundred-product window and put ONE predicate on
     * it — the search or the Status clause — then matched Status beside a
     * search, dropped soft-deleted products and sorted by name over the rows
     * it held, and paged that. Past five hundred products, a match past the
     * window answered "no products match", and a page came back short by
     * however many deleted products it had held.
     *
     * Now the plan puts the search word and every clause on one query under
     * the `deletedAt == null` scope, ordered by `nameLower`, and each page is
     * a page of that query — one page plus a probe row, widened as the reader
     * pages forward. Nothing is matched over the rows afterwards; a clause
     * the query cannot hold is refused by name (`ListQueryNotices` below).
     */
    collection: collection(firestore, 'hosts', hostId, 'products'),
    declaration: PRODUCT_LIST_QUERY,
    request: {
      clauses: productListRequestClauses(gridFilter.clauses),
      search: gridFilter.searchWords,
      base: PRODUCT_LIST_BASE,
    },
    deps: [firestore, hostId],
    idField: '$id',
    /*
     * The scope and the filters read MUTABLE fields — a delete sets
     * `deletedAt`, Archive moves `status`, a rename moves the tokens — so a
     * product can leave this query mid-session, and the SDK can cache that
     * departure as a tombstone at the product's own path (AGL-1196). A
     * disappearance is confirmed against the server before it is believed.
     */
    confirmDisappearances: true,
  })
  /*
   * License key pool (AGL-308) for the open dialog's product — asked FOR that
   * product, and ordered (AGL-2501).
   *
   * This read `limit(500)` over the site's whole `licenseKeys` collection with
   * no `orderBy`, then filtered by `productId` in the browser. Firestore
   * answers an unordered limit in DOCUMENT-ID order, so on a store past five
   * hundred keys the window was an arbitrary five hundred taken across every
   * product — and the "N available" line below counted what happened to be in
   * it. A product whose keys all hashed high showed a pool of zero while the
   * storefront went on delivering them.
   *
   * The equality moves into the query, so the window is this product's keys
   * rather than the store's. `orderBy(documentId())` orders on the document
   * NAME, which cannot be absent — every candidate FIELD here (`createdAtMs`,
   * `assignedAtMs`, `revokedAtMs`) is either optional by design or absent on
   * exactly the keys the counts are about. An equality plus an ordering on
   * `__name__` is served by the automatic single-field index, so this adds no
   * composite for anyone to deploy.
   */
  const { data: keyDocs } = useFirestoreCollection<any>(
    () =>
      keysFor
        ? query(
            collection(firestore, 'hosts', hostId, 'licenseKeys'),
            where('productId', '==', keysFor.$id),
            orderBy(documentId()),
            // One past the ceiling, so a pool larger than the window is a
            // fact rather than a guess from `length === 500`.
            limit(KEY_POOL_CEILING + 1),
          )
        : null,
    [firestore, hostId, keysFor?.$id],
    { idField: '$id' },
  )
  /** The key pool is larger than the window, so the counts below are partial. */
  const keyPoolTruncated = (keyDocs?.length ?? 0) > KEY_POOL_CEILING
  // Locations (AGL-286): the stock dialog buckets deltas when they exist.
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * The PAGE on screen, lifted from legacy shapes. It is what the table
   * draws, the reserved-stock clock watches and the zone hands its widgets,
   * and nothing narrows it: the query already answered every filter, and
   * soft-deleted products are outside its scope.
   */
  const products = useMemo<ProductRow[]>(
    () =>
      (productDocs ?? []).map((product: any) => ({
        ...CommerceModel.liftLegacyProduct(product),
        $id: product.$id,
      })),
    [productDocs],
  )

  /**
   * A CLOCK, because a hold lapses without anybody writing anything
   * (AGL-2356).
   *
   * The Firestore listener re-renders on document changes, and a reservation
   * expiring is not one — `expiresAtMs` simply passes. Without a tick the
   * "reserved" caption below would keep naming a hold that lapsed twenty
   * minutes ago, which is worse than not showing it at all: the merchant would
   * be told stock is spoken for while the storefront happily sells it.
   *
   * Only runs while something is actually held, so an ordinary catalog costs
   * no timer. A NEW hold arrives as a document change, which re-renders, which
   * re-arms this. It watches the page on screen, which is every row whose
   * caption it keeps true.
   */
  const [nowMs, setNowMs] = useState(() => Date.now())
  const anyHeld = useMemo(
    () =>
      products.some(
        (product) => CommerceModel.heldProductUnits(product, nowMs) > 0,
      ),
    [products, nowMs],
  )
  useEffect(() => {
    if (!anyHeld) return undefined
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [anyHeld])

  /**
   * The catalog HEAD-COUNT is a server aggregate, not the length of the
   * capped listener (AGL-1716, the AGL-1706 shape).
   *
   * The listener is `limit(500)` — correctly; a 25,000-product catalog does
   * not belong in a table. What it must not do is answer "how many products
   * does this site have", and it did: the length saturated at 500 and was
   * handed to `checkQuota(org, 'productsPerHost', …)` and to the batch check
   * the CSV importer runs. The bands are 2,500 / 10,000 / 25,000 above the
   * window, so on Pro and up the check compared 500 against thousands and
   * could never refuse — the card offered headroom and `api/hosts/resources`
   * then refused the create, which is the AGL-1716 shape exactly.
   *
   * The aggregate is deliberately UNFILTERED, which also closes a second,
   * quieter disagreement: `api/hosts/resources` enforces this quota with a
   * plain `collection('products').count()`, and `softDeletes` there governs
   * only the flat per-host cap on webhooks — so the server has always
   * counted soft-deleted products toward `productsPerHost` while this card
   * excluded them. The card now asks the enforcing route's question, in the
   * enforcing route's terms.
   *
   * The table pages its own query (AGL-3321) and answers a different
   * question — which products match — so it never stands in for this. A
   * one-shot goes stale where a listener refreshed for free, so the count is
   * re-read after any mutation that moves it.
   *
   * No counting RULE moves: `checkQuota` is untouched and `report-usage`
   * meters contacts, storage and API requests — never the catalog.
   */
  const [productCountEpoch, setProductCountEpoch] = useState(0)
  const [serverProductCount, setServerProductCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    let active = true
    void getCountFromServer(collection(firestore, 'hosts', hostId, 'products'))
      .then((snapshot) => {
        if (active) setServerProductCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the live-row count below — a LOWER bound, and this
        // card's prior behaviour. Deliberately not 0: `checkQuota` answers
        // from whatever it is handed, and 0 used is a confident wrong
        // number in the flattering direction.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, productCountEpoch])
  // The fallback, pending or denied: the live products the table's query has
  // read, probe row included. Each is a product the site has, so it can only
  // UNDERSTATE, never overstate, and nothing it gates fires on a count larger
  // than the truth (AGL-471).
  const loadedProductCount = productWindow?.length ?? 0
  const productCount = serverProductCount ?? loadedProductCount
  // Gate only once the org doc has loaded: an unresolved org reads as the
  // free tier's 0-product cap, which swallowed every Add/Duplicate click.
  // The resources API (AGL-473) stays the authoritative cap on create.
  //
  // `planReady` rather than `org` truthiness (AGL-1064): a host with no
  // owning org never produces one, and waiting on the value alone would
  // hold this open forever. The old fallback allowed UNLIMITED during the
  // window — safe only because the API re-checks; the controls now disable
  // instead, which does not lean on that backstop.
  // NULL means "not known yet", which a boolean cannot say — the old
  // fallback object claimed UNLIMITED and every consumer believed it.
  const productQuota = useMemo(
    () =>
      planReady
        ? Aglyn.checkQuota(org, 'productsPerHost', productCount)
        : null,
    [org, planReady, productCount],
  )

  const handleDuplicate = useCallback(
    (product: ProductRow) => async () => {
      // Plan unknown — the control is disabled; this guards the race.
      if (!productQuota) return
      if (!productQuota.allowed) {
        return void enqueueSnackbar(
          `Your plan includes ${productQuota.limit} products — upgrade for more`,
          { variant: 'info', persist: false },
        )
      }
      // The source's SKU and barcode keys are not copied: the copy's own are
      // derived below, and a copy of a product with none must have none.
      const { $id: _sourceId, skus: _skus, barcodes: _barcodes, ...copy } =
        product as ProductRow & { skus?: string[]; barcodes?: string[] }
      try {
        /*
         * The copy's slug is asked of the store, so a second Duplicate of
         * the same product does not mint a second `-copy` (AGL-3321), and
         * its search keys are the COPY's: spreading the source's would sort
         * and find it by the source's name.
         */
        const slug = await productSlugLedger(firestore, hostId).claim(
          CommerceModel.commerceSlug(`${product.slug}-copy`),
        )
        // Duplicate is a create — rides the quota-enforcing API (AGL-473).
        await createHostResource({
          hostId,
          resource: 'product',
          data: {
            ...copy,
            ...CommerceModel.productSearchFields({
              name: `${product.name} (copy)`,
              variants: product.variants,
            }),
            ...CommerceModel.productStockFields(product),
            slug,
            status: 'draft',
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          },
        })
        // A create moves the count and the aggregate is a one-shot — the
        // listener refreshes the ROWS for free, the count has to be asked
        // again or the cap drifts stale for the rest of the session.
        setProductCountEpoch((epoch) => epoch + 1)
        enqueueSnackbar('Product duplicated as draft', {
          variant: 'success',
          persist: false,
        })
      } catch (error: any) {
        enqueueSnackbar(error?.message ?? 'Could not duplicate product', {
          variant: 'warning',
          persist: false,
        })
      }
    },
    [firestore, hostId, createHostResource, enqueueSnackbar, productQuota],
  )

  const handleStatus = useCallback(
    (product: ProductRow, status: CommerceModel.ProductStatus) => async () => {
      // A product with a variant nobody has priced (AGL-2916) stays off the
      // storefront until the editor has a price for each.
      if (status === 'active' && CommerceModel.productPriceMissing(product)) {
        return void enqueueSnackbar(
          `Set a price for every variant of ${product.name} before activating it.`,
          { variant: 'info', persist: false },
        )
      }
      await updateDoc(doc(firestore, 'hosts', hostId, 'products', product.$id), {
        status,
        updatedAtMs: Date.now(),
        updatedAt: Timestamp.now(),
      })
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const handleDelete = useCallback(
    (product: ProductRow) => async () => {
      const confirmed = await confirm({
        title: 'Delete this product?',
        description:
          `"${product.name}" stops being purchasable; blocks referencing ` +
          'it show a checkout error until repointed.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'products', product.$id), {
        deletedAt: Timestamp.now(),
      })
      enqueueSnackbar('Product deleted', { variant: 'success', persist: false })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  /*
   * CSV import/export (AGL-282): Shopify-dialect columns, dry-run first.
   *
   * The export writes what the table's filters and search MATCH, across the
   * whole catalog (AGL-3321): it walks the table's own query — the same plan,
   * so the same scope, predicates and order — a page of `EXPORT_PAGE` at a
   * time from a cursor, rather than writing the rows on screen. A walk that
   * reaches `EXPORT_CEILING` stops, asks once whether anything is left, and
   * says so when something is.
   */
  const [exporting, setExporting] = useState(false)
  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const productsRef = collection(firestore, 'hosts', hostId, 'products')
      const constraints = listQueryConstraints(plan)
      const exported: ProductRow[] = []
      let cursor: QueryDocumentSnapshot | null = null
      let more = false
      for (;;) {
        const room = EXPORT_CEILING - exported.length
        const snapshot = await getDocs(
          query(
            productsRef,
            ...constraints,
            ...(cursor ? [startAfter(cursor)] : []),
            limit(room > 0 ? Math.min(EXPORT_PAGE, room) : 1),
          ),
        )
        if (room <= 0) {
          more = !snapshot.empty
          break
        }
        for (const product of snapshot.docs) {
          exported.push({
            ...CommerceModel.liftLegacyProduct(product.data() as any),
            $id: product.id,
          })
        }
        if (snapshot.docs.length < Math.min(EXPORT_PAGE, room)) break
        cursor = snapshot.docs[snapshot.docs.length - 1]
      }
      const csv = CommerceModel.productsToCsv(exported)
      const blob = new Blob([csv], { type: 'text/csv' })
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `products-${hostId}.csv`
      anchor.click()
      URL.revokeObjectURL(anchor.href)
      if (more) {
        enqueueSnackbar(
          `Exported the first ${EXPORT_CEILING.toLocaleString()} matching ` +
            'products — the most one file holds. Filter the list to export the rest.',
          { variant: 'info', persist: false },
        )
      }
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not export the products', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setExporting(false)
    }
  }, [firestore, hostId, plan, enqueueSnackbar])

  const handleImportApply = useCallback(async () => {
    const parsed = importing?.parsed
    if (!parsed || parsed.products.length === 0) return
    // Batch-aware cap (AGL-471): the whole import must fit the plan.
    // Not startable until the plan is known (AGL-1064) — the old `org ?`
    // guard let an import begin against an unknown cap and leaned on the
    // API rejecting it partway through, leaving a half-imported catalog.
    if (!planReady) return
    const batchQuota = Aglyn.checkQuota(
      org,
      'productsPerHost',
      productCount + parsed.products.length - 1,
    )
    if (!batchQuota.allowed) {
      return void enqueueSnackbar(
        `This import needs ${parsed.products.length} product slots — your ` +
          `plan allows ${batchQuota.limit}. See Billing to upgrade.`,
        { variant: 'info', persist: false },
      )
    }
    /*
     * The duplicate-slug check asks the STORE (AGL-3321): every slug the file
     * names, by `slug in […]`, and any suffixed one only when it is needed.
     * It asked the table's rows, which held five hundred products and now
     * hold one page, so a slug past them was handed out a second time.
     */
    const slugs = productSlugLedger(firestore, hostId)
    const created: string[] = []
    try {
      await slugs.ask(parsed.products.map((product) => product.slug))
      // Each create rides the quota-enforcing API (AGL-473); the batch cap
      // above short-circuits before we start, so this loop stays bounded.
      for (const product of parsed.products) {
        const slug = await slugs.claim(product.slug)
        const { id } = await createHostResource({
          hostId,
          resource: 'product',
          data: {
            ...product,
            // Search keys travel with the name on the IMPORT path too — a
            // catalog arrives here in bulk, and the table orders, pages and
            // searches it by these keys alone.
            ...CommerceModel.productSearchFields(product),
            ...CommerceModel.productStockFields(product),
            slug,
            priceUsd: product.variants[0]?.priceUsd ?? 0,
            imageUrl: product.mediaUrls?.[0] ?? null,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          },
        })
        created.push(id)
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Import failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setLastImport({
      key: `${Date.now().toString(36)}-${created.length}`,
      productIds: created,
      options: importOptions,
    })
    setImportOptions({})
    setImporting(null)
    setProductCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar(`Imported ${parsed.products.length} products`, {
      variant: 'success',
      persist: false,
    })
  }, [
    importing,
    firestore,
    hostId,
    createHostResource,
    enqueueSnackbar,
    org,
    planReady,
    productCount,
    importOptions,
  ])

  const handleAdjustSave = useCallback(async () => {
    if (!adjusting) return
    const delta = Math.round(Number(adjusting.delta))
    if (!delta) return
    const variants = CommerceModel.adjustVariantInventory(
      adjusting.product,
      adjusting.variantId,
      delta,
      adjusting.locationId || undefined,
    )
    /**
     * Refuse the adjustment when the seed is unconfirmed (AGL-1358).
     *
     * `adjustVariantInventory` reads counts off the seeded product and
     * returns a whole new `variants` array, which is then written over the
     * stored one — so this is a full replace of live stock, not a delta, and
     * `merge` could not help. The refusal also has to cover the ADJUSTMENT
     * LOG, which is why the guard wraps both writes: a logged adjustment
     * whose stock write never happened is worse than neither, because the
     * history then disagrees with the count it is supposed to explain.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'stock',
        unreadable: productsStatus === 'error',
        fromCache: productsFromCache,
      },
      async () => {
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'products', adjusting.product.$id),
          {
            variants,
            // The total and the In stock verdict move with the count (AGL-3321).
            ...CommerceModel.productStockFields({ ...adjusting.product, variants }),
            updatedAtMs: Date.now(),
          },
        )
        // Adjustment history (AGL-281): the same log the sale webhook writes.
        await addDoc(
          collection(firestore, 'hosts', hostId, 'inventoryAdjustments'),
          {
            productId: adjusting.product.$id,
            variantId: adjusting.variantId,
            delta,
            reason: adjusting.reason,
            ...(adjusting.locationId ? { locationId: adjusting.locationId } : {}),
            atMs: Date.now(),
          } satisfies CommerceModel.InventoryAdjustment,
        )
      },
    )
    // Keep the dialog open with the typed delta rather than failing silently.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setAdjusting(null)
    enqueueSnackbar('Stock adjusted', { variant: 'success', persist: false })
  }, [
    adjusting,
    firestore,
    hostId,
    enqueueSnackbar,
    productsFromCache,
    productsStatus,
  ])

  /** The hub's allowance check for a batch of `count` new products, for its zone. */
  const roomFor = useCallback(
    (count: number) =>
      planReady
        ? Aglyn.checkQuota(org, 'productsPerHost', productCount + count - 1)
        : null,
    [org, planReady, productCount],
  )
  const onCatalogCreated = useCallback(
    () => setProductCountEpoch((epoch) => epoch + 1),
    [],
  )
  const setImportOption = useCallback(
    (key: string, on: boolean) =>
      setImportOptions((current) => ({ ...current, [key]: on })),
    [],
  )

  const formatPrice = (product: ProductRow) => {
    const [min, max] = CommerceModel.productPriceRange(product)
    return min === max ? `$${min}` : `$${min}–$${max}`
  }
  const formatStock = (product: ProductRow) => {
    const total = CommerceModel.productInventory(product)
    if (total == null) return '—'
    return total > 0 ? String(total) : 'Sold out'
  }
  /**
   * RESERVED UNITS, NAMED (AGL-2356).
   *
   * Checkout now takes a hold on the units a live session is about to buy, and
   * that hold deliberately does NOT move `inventory` — the shelf count means
   * units on the shelf, and half the product reads it that way. The
   * consequence a merchant meets is that the storefront can refuse a sale of
   * the third unit while this column says `3`, and without this caption the
   * number is right and the behaviour looks broken.
   *
   * The house style of `stock-movements-card.component.tsx`: a trailing
   * `caption` in `text.secondary`, rendered ONLY when there is something to
   * say. Nothing is held on the overwhelming majority of products, so the
   * column reads exactly as it does today.
   */
  const formatHeld = (product: ProductRow) => {
    const held = CommerceModel.heldProductUnits(product, nowMs)
    return held > 0 ? ` (${held} reserved)` : ''
  }

  const productColumns = listFilterGridColumns(
    [
      {
        field: 'name',
        headerName: 'Product',
        flex: 1,
        minWidth: 200,
        renderCell: ({ row }: { row: ProductRow }) => (
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {`/${row.slug} · id: ${row.$id}`}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 120,
        renderCell: ({ row }: { row: ProductRow }) => (
          <Chip
            label={row.status}
            size="small"
            color={STATUS_COLOR[row.status] ?? 'default'}
            variant="outlined"
          />
        ),
      },
      { field: 'type', headerName: 'Type', width: 110 },
      {
        field: 'priceUsd',
        headerName: 'Price',
        width: 130,
        sortable: false,
        renderCell: ({ row }: { row: ProductRow }) =>
          CommerceModel.productPriceMissing(row) ? (
            <Chip label="Set a price" size="small" color="warning" variant="outlined" />
          ) : (
            formatPrice(row)
          ),
      },
      {
        field: 'stock',
        headerName: 'Stock',
        width: 150,
        sortable: false,
        renderCell: ({ row }: { row: ProductRow }) => (
          <span>
            {formatStock(row)}
            {formatHeld(row) ? (
              <Typography variant="caption" color="text.secondary" component="span">
                {formatHeld(row)}
              </Typography>
            ) : null}
          </span>
        ),
      },
      {
        field: 'variants',
        headerName: 'Variants',
        width: 100,
        sortable: false,
        valueGetter: (_value: unknown, row: ProductRow) => row.variants.length,
      },
      listActionsColumn(
        (product: ProductRow) => (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: 'flex-end', whiteSpace: 'nowrap' }}
          >
            <Button size="small" onClick={() => setEditing(product)}>
              {'Edit'}
            </Button>
            <Button size="small" onClick={handleDuplicate(product)}>
              {'Duplicate'}
            </Button>
            {product.type === 'digital' ? (
              <Button size="small" onClick={() => setKeysFor(product)}>
                {'Keys'}
              </Button>
            ) : null}
            {CommerceModel.productInventory(product) != null ? (
              <Button
                size="small"
                onClick={() =>
                  setAdjusting({
                    product,
                    variantId:
                      product.variants.find(
                        (variant) => variant.inventory != null,
                      )?.id ?? product.variants[0].id,
                    delta: '',
                    reason: 'restock',
                    locationId:
                      (locationDocs ?? []).find(
                        (location: any) => location.isDefault,
                      )?.$id ??
                      (locationDocs ?? [])[0]?.$id ??
                      '',
                  })
                }
              >
                {'Stock'}
              </Button>
            ) : null}
            <Button
              size="small"
              onClick={handleStatus(
                product,
                product.status === 'archived' ? 'active' : 'archived',
              )}
            >
              {product.status === 'archived' ? 'Activate' : 'Archive'}
            </Button>
            <Button size="small" color="error" onClick={handleDelete(product)}>
              {'Delete'}
            </Button>
          </Stack>
        ),
        { width: 470 },
      ),
    ] as GridColDef[],
    PRODUCT_LIST_FIELDS,
    PRODUCT_LIST_OPTIONS,
    PRODUCT_LIST_HEADERS,
  )

  return (
    <CardDisplay
      /*
       * The header count is the SITE'S catalog, not the rows in hand.
       *
       * It was `products.length`, which is the filtered, ceilinged, now-paged
       * view — so it read 500 on a 25,000-product catalog and would read 10
       * once the table paged. `productCount` is the same server aggregate the
       * quota gate uses. Under a filter there is no honest number to put here:
       * the aggregate counts the whole catalog and the view counts matches, so
       * neither describes what the reader is looking at, and the footer's own
       * count line answers it instead.
       */
      header={
        filtering
          ? 'Products'
          : `Products${productCount ? ` (${productCount})` : ''}`
      }
      help={pluginDocsHelp('commerce', { anchor: '#products-hub' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            color="primary"
            size="small"
            disabled={!productQuota}
            onClick={() => {
              if (!productQuota) return
              if (!productQuota.allowed) {
                return void enqueueSnackbar(
                  `Your plan includes ${productQuota.limit} products — ` +
                    'upgrade for more',
                  { variant: 'info', persist: false },
                )
              }
              setCreating(true)
            }}
          >
            {'Add product'}
          </Button>
          <Button
            size="small"
            disabled={!planReady}
            onClick={() => {
              setImportOptions({})
              setImporting({ text: '', parsed: null })
            }}
          >
            {'Import'}
          </Button>
          <Button
            size="small"
            // Nothing matches: there is nothing for the walk to write.
            disabled={exporting || (products.length === 0 && page === 0)}
            onClick={handleExport}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </Stack>
        {/* The cap, standing rather than only on refusal (AGL-2113). The
            count is `productCount` — the site's products, the same number
            the gate above counts — not `products.length`, which is one page
            of the table's query (AGL-1716). */}
        <QuotaReadoutComponent
          ready={productQuota !== null}
          used={productCount}
          limit={productQuota?.limit ?? 0}
          noun="product"
        />
        {/* The zone's widgets are handed the PAGE on screen — the products
            the reader has found and is looking at. Every write the zone makes
            asks the store for what it must not duplicate, never these rows. */}
        <ProductsHubZone
          hostId={hostId}
          products={products}
          roomFor={roomFor}
          lastImport={lastImport}
          onCreated={onCatalogCreated}
        />
        <ListFilterChips
          fields={PRODUCT_LIST_FIELDS}
          headers={PRODUCT_LIST_HEADERS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
          options={PRODUCT_LIST_OPTIONS}
        />
        <ListQueryNotices
          refused={listQueryRefusals(plan.refused, {
            fields: PRODUCT_LIST_FIELDS,
            headers: PRODUCT_LIST_HEADERS,
            options: PRODUCT_LIST_OPTIONS,
          })}
          notices={plan.notices}
        />
        <ListTable
          aria-label="Products"
          rows={products}
          columns={productColumns}
          loading={productsStatus === 'loading'}
          // One page of the query, turned by the footer below: the grid
          // neither slices, filters nor sorts it.
          hideFooter
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          quickFilter
          // The one order the list offers, by name: the query's.
          sortingMode="server"
          disableColumnSorting
          initialState={{
            columns: {
              columnVisibilityModel: hiddenFilterVisibility(
                PRODUCT_LIST_FIELDS,
                PRODUCT_VISIBLE_COLUMNS,
              ),
            },
          }}
          noRowsLabel={
            filtering ? 'No products match these filters' : 'No products yet'
          }
          noRowsDescription={
            filtering
              ? undefined
              : 'Build your catalog: add a product, then drop commerce ' +
                'blocks on any screen in Besigner.'
          }
        />
        {products.length === 0 && page === 0 && productsStatus !== 'loading' ? null : (
          /* The count line is the PAGE's. `hasMore` is a fact from the probe
             row; the site's total is `productCount` above, which counts the
             whole catalog rather than the matches, so it is not this. */
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={products.length}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Stack>
      <Dialog
        open={Boolean(keysFor)}
        onClose={() => setKeysFor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`License keys — ${keysFor?.name ?? ''}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(() => {
            // The query already asked for this product's keys, so no second
            // filter here: narrowing a window that was already narrowed is how
            // a reader comes to believe the count covers the pool.
            const productKeys = (keyDocs ?? []).slice(0, KEY_POOL_CEILING)
            const available = productKeys.filter(
              (key: any) => !key.assignedAtMs,
            )
            // RETIRED KEYS ARE COUNTED SEPARATELY (AGL-2454). A refund retires
            // the key rather than returning it to the pool — the buyer already
            // holds the string, so reissuing it would give two people one
            // working key — and without this line the merchant simply watches
            // "available" fall with nothing to explain where the key went.
            const retired = productKeys.filter((key: any) => key.revokedAtMs)
            const assigned =
              productKeys.length - available.length - retired.length
            return (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {`${available.length} available · ${assigned} assigned` +
                    (retired.length
                      ? ` · ${retired.length} retired (refunded or revoked — not reissued)`
                      : '') +
                    (keyPoolTruncated
                      ? `, of the ${KEY_POOL_CEILING} keys read`
                      : '') +
                    '. Keys deliver automatically on purchase (receipt + account).'}
                </Typography>
                {available.slice(0, 8).map((key: any) => (
                  <Stack
                    key={key.$id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="caption" sx={{ flex: 1, fontFamily: 'monospace' }} noWrap>
                      {key.key}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      onClick={() =>
                        updateDoc(
                          doc(firestore, 'hosts', hostId, 'licenseKeys', key.$id),
                          { revokedAtMs: Date.now(), assignedAtMs: Date.now() },
                        )
                      }
                    >
                      {'Revoke'}
                    </Button>
                  </Stack>
                ))}
                <TextField
                  label="Add keys (one per line)"
                  value={keysText}
                  onChange={(event) => setKeysText(event.target.value)}
                  size="small"
                  multiline
                  minRows={3}
                />
              </>
            )
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeysFor(null)}>{'Close'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!keysText.trim()}
            onClick={async () => {
              const keys = keysText
                .split('\n')
                .map((key) => key.trim())
                .filter(Boolean)
                .slice(0, 200)
              for (const key of keys) {
                await addDoc(
                  collection(firestore, 'hosts', hostId, 'licenseKeys'),
                  {
                    productId: keysFor!.$id,
                    key,
                    assignedAtMs: null,
                    createdAtMs: Date.now(),
                  },
                )
              }
              setKeysText('')
              enqueueSnackbar(`Added ${keys.length} keys`, {
                variant: 'success',
                persist: false,
              })
            }}
          >
            {'Add keys'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(importing)}
        onClose={() => setImporting(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{'Import products (CSV)'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'Shopify-compatible columns (Handle, Title, Option/Variant ' +
              'columns, Image Src). Paste the file contents or choose a file.'}
          </Typography>
          <Button component="label" size="small" sx={{ alignSelf: 'flex-start' }}>
            {'Choose file'}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                const text = await file.text()
                setImporting({ text, parsed: CommerceModel.parseProductsCsv(text) })
              }}
            />
          </Button>
          <TextField
            label="CSV"
            value={importing?.text ?? ''}
            onChange={(event) =>
              setImporting({
                text: event.target.value,
                parsed: event.target.value.trim()
                  ? CommerceModel.parseProductsCsv(event.target.value)
                  : null,
              })
            }
            size="small"
            multiline
            minRows={5}
            maxRows={10}
          />
          {importing?.parsed ? (
            <>
              <Typography variant="body2">
                {`Ready to import ${importing.parsed.products.length} products` +
                  (importing.parsed.errors.length
                    ? ` — ${importing.parsed.errors.length} rows skipped:`
                    : '')}
              </Typography>
              {importing.parsed.errors.slice(0, 5).map((error) => (
                <Typography
                  key={error}
                  variant="caption"
                  color="warning.main"
                >
                  {error}
                </Typography>
              ))}
            </>
          ) : null}
          {WidgetSlot && importing?.parsed?.products.length ? (
            <WidgetSlot
              slot="productImport"
              hostId={hostId}
              orgId={undefined}
              count={importing.parsed.products.length}
              options={importOptions}
              setOption={setImportOption}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImporting(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!importing?.parsed?.products.length}
            onClick={handleImportApply}
          >
            {`Import${importing?.parsed?.products.length ? ` ${importing.parsed.products.length}` : ''}`}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Adjust stock — ${adjusting?.product.name ?? ''}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Variant"
            value={adjusting?.variantId ?? ''}
            onChange={(event) =>
              setAdjusting((prev) =>
                prev ? { ...prev, variantId: event.target.value } : prev,
              )
            }
            size="small"
            select
            sx={{ mt: 1 }}
          >
            {(adjusting?.product.variants ?? [])
              .filter((variant) => variant.inventory != null)
              .map((variant) => (
                <MenuItem key={variant.id} value={variant.id}>
                  {`${Object.values(variant.options ?? {}).join(' / ') || 'Default'} — ${variant.inventory} in stock${
                    CommerceModel.heldVariantUnits(
                      adjusting?.product,
                      variant.id,
                      nowMs,
                    ) > 0
                      ? `, ${CommerceModel.heldVariantUnits(
                          adjusting?.product,
                          variant.id,
                          nowMs,
                        )} reserved in checkout`
                      : ''
                  }`}
                </MenuItem>
              ))}
          </TextField>
          {(locationDocs?.length ?? 0) > 1 ? (
            <TextField
              label="Location"
              value={adjusting?.locationId ?? ''}
              onChange={(event) =>
                setAdjusting((prev) =>
                  prev ? { ...prev, locationId: event.target.value } : prev,
                )
              }
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
          <TextField
            label="Change"
            placeholder="+10 or -3"
            value={adjusting?.delta ?? ''}
            onChange={(event) =>
              setAdjusting((prev) =>
                prev
                  ? {
                      ...prev,
                      delta: event.target.value.replace(/[^0-9+-]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Reason"
            value={adjusting?.reason ?? 'restock'}
            onChange={(event) =>
              setAdjusting((prev) =>
                prev
                  ? {
                      ...prev,
                      reason: event.target
                        .value as CommerceModel.InventoryAdjustmentReason,
                    }
                  : prev,
              )
            }
            size="small"
            select
          >
            <MenuItem value="restock">{'Restock'}</MenuItem>
            <MenuItem value="correction">{'Correction'}</MenuItem>
            <MenuItem value="damage">{'Damaged'}</MenuItem>
            <MenuItem value="refund">{'Refund return'}</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjusting(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!Math.round(Number(adjusting?.delta))}
            onClick={handleAdjustSave}
          >
            {'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
      <ProductEditorDialog
        key={editing?.$id ?? (creating ? 'new' : 'closed')}
        hostId={hostId}
        product={editing}
        // The editor is seeded from a row of THIS listener and replaces the
        // whole document, so the freshness verdict belongs here (AGL-1358) —
        // the dialog has no listener of its own to ask.
        seedFromCache={productsFromCache}
        seedUnreadable={productsStatus === 'error'}
        open={creating || editing !== null}
        onClose={() => {
          setEditing(null)
          setCreating(false)
          // The dialog reports no verdict, so a create and a cancel look
          // the same from here. Re-reading on both is one aggregate and
          // keeps the cap off the dialog's shoulders (AGL-1716).
          setProductCountEpoch((epoch) => epoch + 1)
        }}
      />
    </CardDisplay>
  )
}
ProductsHubCard.displayName = 'ProductsHubCard'

export default ProductsHubCard
