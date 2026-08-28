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
import { PRODUCT_LIST_FILTER_FIELDS } from '../../constants/product-filters'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  doc,
  documentId,
  getCountFromServer,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  listFilterConstraints,
  useFirestoreCollection,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { useOrgPlan } from '@aglyn/tenant-feature-instance'
import ProductEditorDialog from './product-editor-dialog.component'
import { pluginDocsHelp } from '@aglyn/aglyn'

/**
 * How many catalog documents the table's listener holds.
 *
 * A CEILING, not a page size: a 25,000-product catalog does not belong in a
 * table, and three other readers on this card — the CSV export, the importer's
 * duplicate-slug check and the reserved-stock clock — need the window whole.
 * The footer pages what this holds; the query is what bounds it.
 */
const CATALOG_CEILING = 500

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

/**
 * Products hub v1 (AGL-279): the catalog manager replacing the Commerce
 * Starter card — search + status filter over `hosts/{hostId}/products`,
 * full editor dialog, duplicate, archive/activate, soft delete (past
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
  const [search, setSearch] = useState('')
  /*
   * WHICH field the search box searches (AGL-693).
   *
   * The box used to compare four fields at once — name, slug, tag, SKU — over
   * the rows the listener had already fetched. Server-side that is not one
   * query: Firestore allows a single `array-contains` per query and cannot OR
   * across fields, so four fields at once means four queries and a merge, and
   * a merged result cannot be paged or capped coherently.
   *
   * Naming the field is the honest trade. It buys a search that reaches the
   * WHOLE catalog instead of an arbitrary five hundred rows of it, which is
   * the case the old box got wrong — and a merchant looking for a SKU knows
   * they are looking for a SKU.
   */
  const [searchField, setSearchField] = useState<'name' | 'skus' | 'barcodes'>(
    'name',
  )
  const [statusFilter, setStatusFilter] = useState('all')
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

  const {
    data: productDocs,
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
  } = useFirestoreCollection<any>(
    () => {
      /*
       * FILTERED BY THE QUERY, and ordered rather than merely capped
       * (AGL-693, AGL-2292).
       *
       * `limit(500)` with no `orderBy` returns documents in ID order, and
       * products are created at `createResourceUid()` — so that was a
       * pseudo-random SAMPLE of five hundred, which the client `.sort()` by
       * name below dressed up as a reliable alphabetical page. The search then
       * ran over that sample, so a product on the wrong side of the cap
       * answered "no products match": the one answer a search must never get
       * wrong, on the list a merchant uses to find one item in their catalog.
       *
       * The cap STAYS — a 25,000-product catalog does not belong in a table,
       * and the head-count has been a server aggregate since AGL-1716. What
       * changes is that a filter now reaches the whole collection BEFORE the
       * cap applies.
       *
       * ONE request, because Firestore allows one `array-contains` and the
       * shared translator builds one predicate. Whichever control is set alone
       * is answered entirely by the server; with BOTH set the name reaches the
       * whole catalog and the status narrows those matches client-side below,
       * which is complete unless a single name matches more than five hundred
       * products.
       *
       * ⚠️ The default ordering is by DOCUMENT ID, not by `nameLower`.
       * Ordering by a denormalized key drops every document that lacks it, and
       * an unfiltered list must not be able to hide a product — a catalog
       * imported before the search keys existed, or written by a path that
       * forgot them, would simply stop appearing. Under a name filter the
       * ordering does move to `nameLower`, and there it is safe: a document
       * without the key has no `nameTokens` either, so the `array-contains`
       * has already excluded it.
       */
      const constraints = listFilterConstraints(
        PRODUCT_LIST_FILTER_FIELDS,
        search.trim()
          ? { field: searchField, op: 'contains', value: search.trim() }
          : statusFilter !== 'all'
            ? { field: 'status', op: 'equals', value: statusFilter }
            : null,
      )
      return query(
        collection(firestore, 'hosts', hostId, 'products'),
        ...(constraints ?? [orderBy(documentId())]),
        /*
         * `CATALOG_CEILING + 1` is a PROBE (AGL-693). One document past the
         * ceiling turns "this catalog is larger than the table" into a fact.
         * The probe row is dropped below and never rendered, exported or
         * counted.
         */
        limit(CATALOG_CEILING + 1),
      )
    },
    [firestore, hostId, search, searchField, statusFilter],
    { idField: '$id' },
  )
  /*
   * License key pool (AGL-308) for the open dialog's product — asked FOR that
   * product, and ordered (AGL-693).
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
  /** The read went past the ceiling, so the catalog is larger than the window. */
  const catalogTruncated = (productDocs?.length ?? 0) > CATALOG_CEILING
  const products = useMemo(() => {
    /*
     * The SEARCH is gone from here — it is the query's job now, and running it
     * twice would be worse than redundant. A server `contains` matches a word
     * PREFIX ("cof" finds "Coffee"), while the old `includes` matched a raw
     * substring, so a two-word search would have been sent to the server as
     * its first word and then dropped again here by a whole-string compare
     * that the matching row never satisfies: rows found, then hidden.
     *
     * The status narrowing stays, and only earns its keep when a name search
     * is also active — that is the one combination the single predicate above
     * cannot express, and here it runs over rows the server already matched by
     * name across the whole catalog rather than over an arbitrary window.
     *
     * Soft-deleted products are still dropped here rather than in the query:
     * `deletedAt` is absent on a live product, and Firestore cannot ask for
     * documents that LACK a field.
     */
    return (productDocs ?? [])
      .slice(0, CATALOG_CEILING)
      .filter((product: any) => !product.deletedAt)
      .map((product: any) => ({
        ...CommerceModel.liftLegacyProduct(product),
        $id: product.$id,
      }))
      .filter(
        (product: ProductRow) =>
          statusFilter === 'all' || product.status === statusFilter,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [productDocs, statusFilter])

  /*==========================================
   * THE TABLE PAGES, and the READ deliberately does not (AGL-693).
   *
   * The card rendered every row of a five-hundred-document window in one wall
   * with no footer under it — the shape this sweep is about. What it must not
   * become is a server-paged query, because three other things in this file
   * read the same window and every one of them needs it whole:
   *
   *  * `handleExport` writes the CSV from these rows. A ten-row page would
   *    silently export ten products under a filename that claims the catalog.
   *  * the CSV importer builds `existingSlugs` from them to refuse a
   *    duplicate slug. Narrowed to a page, it would stop seeing the clash and
   *    create the duplicate it exists to prevent.
   *  * the reserved-stock clock arms off them.
   *
   * The window is also already correct: `orderBy(documentId())` unfiltered,
   * `nameLower` under a name filter, and the filters themselves reach the
   * whole collection through the query. So the fix here is the CONTROL, not
   * the read — and the head-count beside it has been a server aggregate since
   * AGL-1716.
   *=========================================*/
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // A filter narrows the list under the reader's feet, and page four of the
  // unfiltered catalog is not a position in the filtered one.
  useEffect(() => setPage(0), [search, searchField, statusFilter])
  const visibleProducts = useMemo(
    () => products.slice(page * pageSize, page * pageSize + pageSize),
    [products, page, pageSize],
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
   * re-arms this.
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
   * THE LIST KEEPS ITS CAP, and the filtered `products` view above still
   * drives the table, the export and the slug set. A one-shot goes stale
   * where a listener refreshed for free, so the count is re-read after any
   * mutation that moves it.
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
  // Cap against ALL live products, not the filtered view (AGL-471). This is
  // the fallback now: pending or denied, it can only UNDERSTATE, never
  // overstate, so nothing it gates fires on a count larger than the truth.
  const loadedProductCount = useMemo(
    () => (productDocs ?? []).filter((product: any) => !product.deletedAt).length,
    [productDocs],
  )
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
      const { $id: _sourceId, ...copy } = product
      try {
        // Duplicate is a create — rides the quota-enforcing API (AGL-473).
        await createHostResource({
          hostId,
          resource: 'product',
          data: {
            ...copy,
            name: `${product.name} (copy)`,
            slug: CommerceModel.commerceSlug(`${product.slug}-copy`),
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
    [hostId, createHostResource, enqueueSnackbar, productQuota],
  )

  const handleStatus = useCallback(
    (product: ProductRow, status: CommerceModel.ProductStatus) => async () => {
      await updateDoc(doc(firestore, 'hosts', hostId, 'products', product.$id), {
        status,
        updatedAtMs: Date.now(),
        updatedAt: Timestamp.now(),
      })
    },
    [firestore, hostId],
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

  // CSV import/export (AGL-282): Shopify-dialect columns, dry-run first.
  const handleExport = useCallback(() => {
    const csv = CommerceModel.productsToCsv(products)
    const blob = new Blob([csv], { type: 'text/csv' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `products-${hostId}.csv`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }, [products, hostId])

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
    const existingSlugs = new Set(products.map((product) => product.slug))
    try {
      // Each create rides the quota-enforcing API (AGL-473); the batch cap
      // above short-circuits before we start, so this loop stays bounded.
      for (const product of parsed.products) {
        let slug = product.slug
        while (existingSlugs.has(slug)) slug = `${product.slug}-${Date.now() % 1000}`
        existingSlugs.add(slug)
        await createHostResource({
          hostId,
          resource: 'product',
          data: {
            ...product,
            // Search keys travel with the name on the IMPORT path too — a
            // catalog arrives here in bulk, which is exactly the catalog the
            // 500-row window cannot show and the search has to reach.
            ...CommerceModel.productSearchFields(product),
            slug,
            priceUsd: product.variants[0]?.priceUsd ?? 0,
            inventory: CommerceModel.productInventory(product),
            imageUrl: product.mediaUrls?.[0] ?? null,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          },
        })
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Import failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setImporting(null)
    setProductCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar(`Imported ${parsed.products.length} products`, {
      variant: 'success',
      persist: false,
    })
  }, [
    importing,
    products,
    hostId,
    createHostResource,
    enqueueSnackbar,
    org,
    planReady,
    productCount,
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
            inventory: CommerceModel.productInventory({ variants }),
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
        search || statusFilter !== 'all'
          ? 'Products'
          : `Products${productCount ? ` (${productCount})` : ''}`
      }
      help={pluginDocsHelp('commerce', { anchor: '#products-hub' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Search"
            placeholder={
              searchField === 'name'
                ? 'Product name'
                : searchField === 'skus'
                  ? 'Whole SKU'
                  : 'Whole barcode'
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label="In"
            value={searchField}
            onChange={(event) =>
              setSearchField(
                event.target.value as 'name' | 'skus' | 'barcodes',
              )
            }
            size="small"
            select
            sx={{ minWidth: 110 }}
          >
            <MenuItem value="name">{'Name'}</MenuItem>
            <MenuItem value="skus">{'SKU'}</MenuItem>
            <MenuItem value="barcodes">{'Barcode'}</MenuItem>
          </TextField>
          <TextField
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            size="small"
            select
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="all">{'All'}</MenuItem>
            <MenuItem value="active">{'Active'}</MenuItem>
            <MenuItem value="draft">{'Draft'}</MenuItem>
            <MenuItem value="archived">{'Archived'}</MenuItem>
          </TextField>
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
            onClick={() => setImporting({ text: '', parsed: null })}
          >
            {'Import'}
          </Button>
          <Button
            size="small"
            disabled={products.length === 0}
            onClick={handleExport}
          >
            {'Export'}
          </Button>
        </Stack>
        {/* The cap, standing rather than only on refusal (AGL-2113). The
            count is `productCount` — the site's products, the same number
            the gate above counts — not `products.length`, which is the
            filtered, `limit()`-ed page (AGL-1716). */}
        <QuotaReadoutComponent
          ready={productQuota !== null}
          used={productCount}
          limit={productQuota?.limit ?? 0}
          noun="product"
        />
        {products.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {search || statusFilter !== 'all'
              ? 'No products match the current filters.'
              : 'Build your catalog: add a product, then drop commerce ' +
                'blocks on any screen in the besigner.'}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Product'}</TableCell>
                  <TableCell>{'Status'}</TableCell>
                  <TableCell>{'Type'}</TableCell>
                  <TableCell>{'Price'}</TableCell>
                  <TableCell>{'Stock'}</TableCell>
                  <TableCell>{'Variants'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleProducts.map((product) => (
                  <TableRow key={product.$id} hover>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="body2" noWrap>
                        {product.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ display: 'block' }}
                      >
                        {`/${product.slug} · id: ${product.$id}`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={product.status}
                        size="small"
                        color={STATUS_COLOR[product.status] ?? 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{product.type}</TableCell>
                    <TableCell>{formatPrice(product)}</TableCell>
                    <TableCell>
                      {formatStock(product)}
                      {formatHeld(product) ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="span"
                        >
                          {formatHeld(product)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{product.variants.length}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
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
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDelete(product)}
                      >
                        {'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        {products.length === 0 ? null : (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visibleProducts.length}
            // The rows matching the current filters, which the card holds in
            // full below the ceiling. NOT the catalog total — that is
            // `productCount`, and it answers a different question.
            count={products.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {catalogTruncated ? (
          <Alert severity="info">
            {`This table holds ${CATALOG_CEILING} products at a time and this ` +
              'catalog is larger. Search reaches every product; the CSV ' +
              'export covers what the table holds.'}
          </Alert>
        ) : null}
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
