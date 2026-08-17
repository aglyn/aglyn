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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import OrderDetailDialog, {
  DISPUTE_COLOR,
} from './order-detail-dialog.component'

export interface HostOrdersCardProps {
  hostId: string
}

/**
 * Orders console (AGL-287): filterable list over webhook-written order
 * docs with a detail dialog (timeline, fulfill, refund, cancel, notes,
 * packing slip) and draft orders that send the buyer a payment link.
 */
export function HostOrdersCard(props: HostOrdersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: orderDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'orders'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const productNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const product of productDocs ?? []) {
      map[product.$id] = product.name ?? product.$id
    }
    return map
  }, [productDocs])

  // Sorted client-side: orderBy would drop docs missing createdAt.
  const orders = [...(orderDocs ?? [])].sort(
    (a: any, b: any) =>
      (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  )

  // Filters + CSV export (AGL-96) over the loaded window.
  const [productFilter, setProductFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  /**
   * Disputes filter (AGL-1796), separate from Status on purpose: the two are
   * orthogonal. An OPEN dispute sits on an order that is still `paid`, and a
   * lost one sits on `refunded` beside every ordinary refund — so folding
   * either into the Status select would make that control lie about what it
   * selects.
   */
  const [disputeFilter, setDisputeFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    productId: string
    variantId: string
    quantity: string
    email: string
    /** Destination the merchant declared, once they have been asked. */
    shipTo?: string
    /**
     * Revealed only when the server refuses for want of a destination
     * (AGL-1792). A merchant whose rates are the same everywhere — or who
     * configured none — is never asked and never sees this field.
     */
    shipCountries?: string[]
    busy?: boolean
  } | null>(null)
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const visibleOrders = useMemo(() => {
    const now = Date.now() / 1000
    return orders.filter((order: any) => {
      const lifted = CommerceModel.liftLegacyOrder(order)
      // Line items first (AGL-1747): the flat `productId` is written only by
      // the two buy-now Stripe paths, so matching on it alone hid every cart,
      // POS and draft order behind the product filter.
      if (productFilter && !CommerceModel.orderContainsProduct(lifted, productFilter)) {
        return false
      }
      if (statusFilter && lifted.status !== statusFilter) return false
      if (channelFilter && (lifted.channel ?? 'online') !== channelFilter) {
        return false
      }
      if (
        disputeFilter === 'open' &&
        !CommerceModel.orderHasOpenDispute(lifted)
      ) {
        return false
      }
      // `lost` is the tone, not the raw status: a dispute that was WON also
      // closes with money untouched, and listing it under "charged back"
      // would tell a merchant they lost a case they won.
      if (
        disputeFilter === 'lost' &&
        CommerceModel.describeOrderDispute(lifted)?.tone !== 'lost'
      ) {
        return false
      }
      const created = order.createdAt?.seconds ?? 0
      if (dateFilter === '7d' && now - created > 7 * 86400) return false
      if (dateFilter === '30d' && now - created > 30 * 86400) return false
      return true
    })
  }, [
    orders,
    productFilter,
    dateFilter,
    statusFilter,
    channelFilter,
    disputeFilter,
  ])

  /**
   * Raised over EVERY loaded order, not the visible ones (AGL-1796). A
   * merchant filtered to "delivered" still has a deadline running on a `paid`
   * order, and the evidence window is days long.
   */
  const openDisputes = useMemo(
    () =>
      CommerceModel.summariseOpenDisputes(
        orders.map((order: any) => CommerceModel.liftLegacyOrder(order)),
      ),
    [orders],
  )
  const handleExportCsv = useCallback(() => {
    // The rows themselves are built by the pure model helper (AGL-1747) so the
    // column-by-column arithmetic is unit-testable without a Firestore mock.
    const csv = CommerceModel.buildOrdersCsv(visibleOrders, productNames)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'orders.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [visibleOrders, productNames])

  /**
   * Idempotency key for ONE draft attempt (AGL-1697).
   *
   * Minted lazily on the first create click, NOT per call — two clicks (or a
   * click retried after a lost response) must present ONE key so the server
   * replays the original payment link instead of minting a second order.
   * Retired whenever a content field changes: an edited draft is a different
   * order, and replaying the old one against it would hand the merchant a
   * link priced for fields they no longer see. Answering the shipping-country
   * ask also retires it, which is safe — that refusal is served before the
   * server takes the claim, so the first key was never spent.
   */
  const draftAttemptKey = useRef('')
  useEffect(() => {
    draftAttemptKey.current = ''
  }, [
    draft?.productId,
    draft?.variantId,
    draft?.quantity,
    draft?.email,
    draft?.shipTo,
  ])

  const handleDraftCreate = useCallback(async () => {
    if (!draft?.productId) return
    setDraft((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      if (!draftAttemptKey.current) {
        draftAttemptKey.current =
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/draft-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Stable across a retry of THIS attempt (AGL-1697), so a
          // double-click cannot mint two live payment links.
          'Idempotency-Key': draftAttemptKey.current,
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          productId: draft.productId,
          variantId: draft.variantId || undefined,
          quantity: Number(draft.quantity) || 1,
          email: draft.email || undefined,
          // A request, never an instruction: the server resolves the rates for
          // this country AND restricts the payment link's collectable
          // addresses to it, so declaring one cannot buy a cheaper zone's rate
          // than the address the buyer then enters (AGL-1721).
          ...(draft.shipTo ? { shippingCountry: draft.shipTo } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        // The merchant's rates differ by destination, so the server will not
        // price this order until it knows one (AGL-1792). Reveal the field and
        // let them answer; a store whose rates are the same everywhere, or
        // which configured none, never sends this and never shows it.
        if (payload?.needsShippingCountry) {
          setDraft((prev) =>
            prev
              ? {
                  ...prev,
                  shipCountries: (
                    payload.shippingCountries as string[] | undefined
                  )?.length
                    ? (payload.shippingCountries as string[])
                    : [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
                }
              : prev,
          )
        }
        return void enqueueSnackbar(payload?.error ?? 'Draft order failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      await navigator.clipboard.writeText(payload.url).catch(() => undefined)
      enqueueSnackbar('Draft created — payment link copied', {
        variant: 'success',
        persist: false,
      })
      setDraft(null)
    } finally {
      setDraft((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [draft, user, hostId, enqueueSnackbar])

  const selectedOrder =
    (orderDocs ?? []).find((order: any) => order.$id === selectedId) ?? null

  /**
   * Shared by the two triggers (AGL-1805) so the empty state and the toolbar
   * cannot drift into opening the dialog with different starting fields.
   */
  const openDraft = useCallback(
    () => setDraft({ productId: '', variantId: '', quantity: '1', email: '' }),
    [],
  )

  /** What the draft dialog can actually offer. */
  const selectableProducts = useMemo(
    () => (productDocs ?? []).filter((product: any) => !product.deletedAt),
    [productDocs],
  )

  return (
    <CardDisplay header={'Orders'} contentGutterX contentGutterY>
      {orders.length === 0 ? (
        /*
         * An invitation, not a report (AGL-1805). The "Draft order" button
         * used to live in the other arm of this ternary, so the one state a
         * draft order exists for — no sales yet, invoice the customer you
         * already have — was the only state that could not reach it, and
         * every other route into the dialog needs an order to exist first.
         *
         * The filters stay behind deliberately: they belong to a list with
         * rows in it. Export CSV likewise — a header-only file is not
         * something a merchant on day one is looking for.
         */
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {
              'No orders yet. Storefront sales, POS sales and draft orders ' +
              'all appear here as they come in.'
            }
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {
              'Selling to someone directly? Draft their order and send them ' +
              'a payment link.'
            }
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={openDraft}
          >
            {'Draft order'}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1}>
          {openDisputes.count > 0 ? (
            <Alert
              severity={openDisputes.overdue ? 'error' : 'warning'}
              action={
                disputeFilter === 'open' ? undefined : (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setDisputeFilter('open')}
                  >
                    {'Show them'}
                  </Button>
                )
              }
            >
              <AlertTitle>
                {openDisputes.count === 1
                  ? 'A shopper has disputed a charge with their bank'
                  : `${openDisputes.count} charges are disputed with the shopper’s bank`}
              </AlertTitle>
              {openDisputes.soonestDaysLeft === undefined
                ? 'Answer in the Stripe dashboard while the case is open — an unanswered dispute is decided for the shopper.'
                : openDisputes.soonestDaysLeft < 0
                  ? 'The evidence deadline has passed on at least one of these. Stripe decides an unanswered dispute for the shopper.'
                  : `Evidence is due to Stripe in ${openDisputes.soonestDaysLeft} day${
                      openDisputes.soonestDaysLeft === 1 ? '' : 's'
                    } on the tightest of these. An unanswered dispute is decided for the shopper.`}
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Product"
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{'All products'}</MenuItem>
              {(productDocs ?? []).map((product: any) => (
                <MenuItem key={product.$id} value={product.$id}>
                  {product.name ?? product.$id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Period"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">{'All time'}</MenuItem>
              <MenuItem value="7d">{'Last 7 days'}</MenuItem>
              <MenuItem value="30d">{'Last 30 days'}</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="">{'All statuses'}</MenuItem>
              {['pending', 'paid', 'fulfilled', 'delivered', 'cancelled', 'refunded'].map(
                (status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ),
              )}
            </TextField>
            <TextField
              select
              size="small"
              label="Channel"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">{'All channels'}</MenuItem>
              <MenuItem value="online">{'Online'}</MenuItem>
              <MenuItem value="pos">{'POS'}</MenuItem>
              <MenuItem value="draft">{'Draft'}</MenuItem>
              <MenuItem value="subscription">{'Subscription'}</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Disputes"
              value={disputeFilter}
              onChange={(event) => setDisputeFilter(event.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{'All orders'}</MenuItem>
              <MenuItem value="open">{'Open dispute'}</MenuItem>
              <MenuItem value="lost">{'Charged back'}</MenuItem>
            </TextField>
            <Button size="small" onClick={handleExportCsv}>
              {'Export CSV'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={openDraft}
            >
              {'Draft order'}
            </Button>
          </Stack>
          {visibleOrders.map((order: any) => {
            const lifted = CommerceModel.liftLegacyOrder(order)
            // A lost chargeback leaves `status: 'refunded'` (AGL-1787), so the
            // status chip on this row cannot tell the two apart either.
            const dispute = CommerceModel.describeOrderDispute(lifted)
            return (
              <Stack
                key={order.$id}
                spacing={0}
                onClick={() => setSelectedId(order.$id)}
                sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {`${CommerceModel.formatOrderNumber(lifted, order.$id)} · ` +
                      (lifted.lineItems?.[0]?.name ??
                        productNames[order.productId] ??
                        order.productId ??
                        '') +
                      ` · $${(((lifted.totals?.totalCents ?? order.amountCents) ?? 0) / 100).toFixed(2)}`}
                  </Typography>
                  {dispute ? (
                    <Tooltip title={dispute.detail}>
                      <Chip
                        label={dispute.label}
                        size="small"
                        color={DISPUTE_COLOR[dispute.tone]}
                        variant="filled"
                      />
                    </Tooltip>
                  ) : null}
                  <Chip
                    label={lifted.status.replace('_', ' ')}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {(order.customerEmail ? `${order.customerEmail} · ` : '') +
                    (order.createdAt?.toDate?.()
                      ? order.createdAt.toDate().toLocaleString()
                      : '')}
                </Typography>
                {/*
                  The deadline on the row itself, while the case is open —
                  the one fact on this screen that expires.
                 */}
                {dispute?.evidenceDaysLeft !== undefined ? (
                  <Typography
                    variant="caption"
                    color={
                      dispute.evidenceDaysLeft < 0 ? 'error' : 'warning.main'
                    }
                  >
                    {dispute.evidenceDaysLeft < 0
                      ? 'Evidence deadline passed'
                      : `Evidence due in ${dispute.evidenceDaysLeft} day${
                          dispute.evidenceDaysLeft === 1 ? '' : 's'
                        }`}
                  </Typography>
                ) : null}
              </Stack>
            )
          })}
        </Stack>
      )}
      {selectedOrder ? (
        <OrderDetailDialog
          hostId={hostId}
          order={selectedOrder}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Draft order'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Product"
            value={draft?.productId ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, productId: event.target.value, variantId: '' }
                  : prev,
              )
            }
            size="small"
            select
            sx={{ mt: 1 }}
            /*
             * The second dead end behind the first (AGL-1805): a store with
             * no orders may have no products either, and a draft order is
             * composed from one — so "Create & copy link" stays disabled. Say
             * why, rather than opening an empty menu onto nothing.
             */
            helperText={
              selectableProducts.length === 0
                ? 'Add a product to this store first — a draft order is built from one.'
                : undefined
            }
          >
            {selectableProducts.map((product: any) => (
              <MenuItem key={product.$id} value={product.$id}>
                {product.name ?? product.$id}
              </MenuItem>
            ))}
          </TextField>
          {(() => {
            const product = (productDocs ?? []).find(
              (item: any) => item.$id === draft?.productId,
            )
            const variants = product
              ? CommerceModel.liftLegacyProduct(product).variants
              : []
            return variants.length > 1 ? (
              <TextField
                label="Variant"
                value={draft?.variantId ?? ''}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, variantId: event.target.value } : prev,
                  )
                }
                size="small"
                select
              >
                {variants.map((variant) => (
                  <MenuItem key={variant.id} value={variant.id}>
                    {`${Object.values(variant.options ?? {}).join(' / ') || 'Default'} — $${variant.priceUsd}`}
                  </MenuItem>
                ))}
              </TextField>
            ) : null
          })()}
          <TextField
            label="Quantity"
            value={draft?.quantity ?? '1'}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      quantity: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label="Buyer email (optional)"
            value={draft?.email ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, email: event.target.value } : prev,
              )
            }
            size="small"
          />
          {draft?.shipCountries?.length ? (
            <TextField
              label="Ships to"
              value={draft?.shipTo ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, shipTo: event.target.value } : prev,
                )
              }
              size="small"
              select
              helperText={
                'This store’s shipping rates differ by destination, so the ' +
                'payment link has to be priced for one.'
              }
            >
              {draft.shipCountries.map((code) => (
                <MenuItem key={code} value={code}>
                  {CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !draft?.productId ||
              draft?.busy ||
              // Once asked, the answer is required: retrying without one is
              // refused again, so the button would only look broken.
              Boolean(draft?.shipCountries?.length && !draft?.shipTo)
            }
            onClick={handleDraftCreate}
          >
            {'Create & copy link'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostOrdersCard.displayName = 'HostOrdersCard'

export default HostOrdersCard
