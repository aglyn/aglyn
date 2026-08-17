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

import * as CommerceModel from '../../model'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
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
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { type PickedMedia, useMediaPicker } from '@aglyn/aglyn'

export interface ProductEditorDialogProps {
  hostId: string
  /** Product doc (with `$id`) to edit, `null` for a new product. */
  product: (CommerceModel.HostProduct & { $id: string }) | null
  /**
   * The listener that produced `product` has NOT been confirmed by the
   * server (AGL-1358). Required rather than optional on purpose: the
   * products listener lives in the parent hub card, so this dialog cannot
   * compute the verdict, and an optional prop a caller forgets is a guard
   * that is off while looking present.
   */
  seedFromCache: boolean
  /** That listener FAILED (`status === 'error'`). */
  seedUnreadable?: boolean
  open: boolean
  onClose: () => void
}

/** Stable key for matching variants across matrix regenerations. */
function comboKey(options: Record<string, string> | undefined): string {
  return Object.entries(options ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|')
}

function comboLabel(options: Record<string, string> | undefined): string {
  const values = Object.values(options ?? {})
  return values.length ? values.join(' / ') : 'Default'
}

/**
 * Products hub editor (AGL-279): the full catalog editor — basics,
 * media, tags, options → variants matrix, per-variant pricing/stock, and
 * SEO overrides. Saving denormalizes `priceUsd`/`inventory` from the
 * first variant so the legacy Product block + checkout API (AGL-90) keep
 * charging correctly without reading the variants array.
 */
export function ProductEditorDialog(props: ProductEditorDialogProps) {
  const { hostId, product, seedFromCache, seedUnreadable, open, onClose } =
    props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { data: categoryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'productCategories'),
        limit(250),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: allProductDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(300)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: supplierDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'suppliers'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const lifted = useMemo(
    () => (product ? CommerceModel.liftLegacyProduct(product) : null),
    [product],
  )
  const [draft, setDraft] = useState<CommerceModel.HostProduct | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  // The console media browser is provided by the shell (AGL-395); opening it
  // resolves with the chosen asset (or null if cancelled).
  const { pickMedia } = useMediaPicker()
  const pick = useCallback(
    async (apply: (media: PickedMedia) => void) => {
      const media = await pickMedia?.()
      if (media) apply(media)
    },
    [pickMedia],
  )
  // Lazy-init per open; parent remounts via `key` on product change.
  const current: CommerceModel.HostProduct =
    draft ??
    lifted ?? {
      name: '',
      slug: '',
      type: 'physical',
      status: 'draft',
      variants: [{ id: 'default', priceUsd: 0 }],
    }
  const update = (patch: Partial<CommerceModel.HostProduct>) =>
    setDraft({ ...current, ...patch })

  const error = current.name ? CommerceModel.validateProduct(current) : null

  /**
   * Stock tracking is inert on a subscription-only product (AGL-1744) —
   * nothing decrements it on the first charge or on any renewal, so the
   * editor stops offering a number it cannot keep true. Existing
   * configuration is NOT discarded: the stored value stays on the document
   * (this save is a full replace of `current`, and `current` is untouched
   * here), stays visible in the disabled field, and becomes editable again
   * the moment Billing goes back to "One-time purchase" or "Both".
   */
  const stockApplies = CommerceModel.stockTrackingApplies(current)
  const strandedStock = stockApplies
    ? null
    : CommerceModel.productInventory(current)

  /**
   * The one destructive move, and the merchant makes it deliberately.
   *
   * Needed because the checkout gate is unchanged: a stored `0` on a
   * subscription-only product still 409s every new subscriber, and with the
   * field disabled that would be a trap with no way out. `inventoryByLocation`
   * goes with it — `adjustVariantInventory` re-sums the flat count from those
   * buckets (AGL-286), so leaving them would let a later restock resurrect a
   * count this just cleared. Keys are DELETED rather than set undefined; the
   * save is a client-direct `setDoc`, which rejects undefined values.
   */
  const handleClearStockTracking = () => {
    update({
      variants: current.variants.map((variant) => {
        const { inventoryByLocation: _perLocation, ...rest } = variant
        return { ...rest, inventory: null }
      }),
    })
  }

  const handleName = (name: string) =>
    update({
      name,
      ...(!product && !slugTouched ? { slug: CommerceModel.commerceSlug(name) } : {}),
    })

  const handleOptionsChange = useCallback(
    (index: number, patch: Partial<CommerceModel.ProductOption> | null) => {
      const options = [...(current.options ?? [])]
      if (patch === null) options.splice(index, 1)
      else options[index] = { name: '', values: [], ...options[index], ...patch }
      // Regenerate the matrix, carrying data over by option-combo key so
      // edits to prices/SKUs survive option tweaks.
      const previous = new Map(
        current.variants.map((variant) => [comboKey(variant.options), variant]),
      )
      const fallback = current.variants[0]
      const variants = CommerceModel.expandVariantMatrix(options).map(
        (combo, comboIndex) => {
          const existing = previous.get(comboKey(combo))
          return (
            existing ?? {
              id: `v${Date.now().toString(36)}${comboIndex}`,
              options: combo,
              priceUsd: fallback?.priceUsd ?? 0,
              inventory: fallback?.inventory ?? null,
            }
          )
        },
      )
      update({ options, variants })
    },
    [current],
  )

  const handleVariantField = (
    index: number,
    field: keyof CommerceModel.ProductVariant,
    raw: string,
  ) => {
    const variants = [...current.variants]
    const numeric = ['priceUsd', 'compareAtPriceUsd', 'weightGrams']
    const value =
      field === 'inventory'
        ? raw.trim() === ''
          ? null
          : Math.max(0, Math.round(Number(raw)))
        : numeric.includes(field)
          ? raw.trim() === ''
            ? undefined
            : Number(raw)
          : raw
    variants[index] = { ...variants[index], [field]: value }
    if (
      value === undefined &&
      (field === 'compareAtPriceUsd' || field === 'weightGrams')
    ) {
      delete (variants[index] as any)[field]
    }
    update({ variants })
  }

  const handleSave = useCallback(async () => {
    if (!current.name.trim() || error) return
    const primaryVariant = current.variants[0]
    // JSON-safe base (no Firestore Timestamp — it won't survive the API
    // hop); millis fields are what the checkout + Product block read.
    /**
     * `$id` is dropped, not carried (AGL-1374).
     *
     * `current` is `draft ?? liftLegacyProduct(product)`, and the hub stamps
     * `$id` onto every row it lists (`{...liftLegacyProduct(p), $id: p.$id}`)
     * — a SYNTHETIC key `idField: '$id'` puts on the in-memory object, which
     * nothing persists. Spreading `current` carried it into the payload, and
     * this write is `merge: false`, so it was stored as a real field on every
     * product save. Nothing reads it; it is the listener's bookkeeping
     * leaking into storage, and once there no reader can tell it from a field
     * the editor meant to write. Excluding it also CLEANS the key off any
     * product a previous save corrupted, because a replacing write stores
     * exactly the payload.
     *
     * `product.$id` is still the doc path below — reading the synthetic key
     * is what it is for. Writing it is the bug.
     */
    const seeded = current as typeof current & { $id?: string }
    const { $id: _syntheticId, ...currentFields } = seeded
    const base = {
      ...currentFields,
      name: current.name.trim().slice(0, 120),
      slug: current.slug || CommerceModel.commerceSlug(current.name),
      priceUsd: primaryVariant?.priceUsd ?? 0,
      inventory: CommerceModel.productInventory(current),
      imageUrl: current.mediaUrls?.[0] ?? current.imageUrl ?? null,
      updatedAtMs: Date.now(),
    }
    try {
      /**
       * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
       *
       * `merge: false` — a genuine full-document replace, and the payload is
       * `{...current}`, which is `draft ?? lifted(product)`: every field the
       * dialog was seeded with, whether or not it was touched. So a cached
       * seed does not lose the one edit, it replaces the stored product with
       * the cache's whole picture of it — price, variants, stock, media,
       * status, SEO. Anything written since that snapshot, by a colleague or
       * by the checkout engine, is gone.
       *
       * Only the edit path is guarded. A NEW product goes through the
       * quota-enforcing resources API at a fresh uid and can overwrite
       * nothing; the first snapshot of any listener is `fromCache: true`, so
       * guarding a create would refuse a save that was never unsafe.
       *
       * The guard WRAPS the write: an early return is a shape you can keep
       * while losing the protection.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'product',
          unreadable: Boolean(product) && seedUnreadable,
          fromCache: Boolean(product) && seedFromCache,
        },
        async () => {
          if (product) {
            // Edit stays client-direct (no quota consumed); full replace.
            await setDoc(
              doc(firestore, 'hosts', hostId, 'products', product.$id),
              { ...base, updatedAt: Timestamp.now() },
              { merge: false },
            )
          } else {
            // New product rides the quota-enforcing resources API (AGL-473) —
            // it re-checks the `commerce` entitlement and productsPerHost.
            await createHostResource({
              hostId,
              resource: 'product',
              data: { ...base, createdAtMs: Date.now() },
            })
          }
        },
      )
      // A refusal leaves the editor open with every field as edited. Closing
      // it would discard the work AND look like a save that succeeded.
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      onClose()
      enqueueSnackbar('Product saved', { variant: 'success', persist: false })
    } catch (saveError: any) {
      console.error(saveError)
      enqueueSnackbar(saveError?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    current,
    error,
    product,
    seedFromCache,
    seedUnreadable,
    firestore,
    hostId,
    createHostResource,
    onClose,
    enqueueSnackbar,
  ])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{product ? 'Edit product' : 'Add product'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            value={current.name}
            onChange={(event) => handleName(event.target.value)}
            size="small"
            autoFocus
            fullWidth
          />
          <TextField
            label="Slug"
            value={current.slug}
            onChange={(event) => {
              setSlugTouched(true)
              update({ slug: CommerceModel.commerceSlug(event.target.value) })
            }}
            size="small"
            fullWidth
            helperText={current.slug ? `/products/${current.slug}` : undefined}
          />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField
            label="Type"
            value={current.type}
            onChange={(event) =>
              update({ type: event.target.value as CommerceModel.ProductType })
            }
            size="small"
            select
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="physical">{'Physical'}</MenuItem>
            <MenuItem value="digital">{'Digital'}</MenuItem>
            <MenuItem value="service">{'Service'}</MenuItem>
          </TextField>
          <TextField
            label="Status"
            value={current.status}
            onChange={(event) =>
              update({ status: event.target.value as CommerceModel.ProductStatus })
            }
            size="small"
            select
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="draft">{'Draft'}</MenuItem>
            <MenuItem value="active">{'Active'}</MenuItem>
            <MenuItem value="archived">{'Archived'}</MenuItem>
          </TextField>
          {(supplierDocs?.length ?? 0) > 0 ? (
            <TextField
              label="Supplier"
              value={current.supplierId ?? ''}
              onChange={(event) =>
                update({ supplierId: event.target.value || undefined })
              }
              size="small"
              select
              sx={{ minWidth: 160 }}
              helperText="Routes paid orders"
            >
              <MenuItem value="">{'None (self-fulfilled)'}</MenuItem>
              {(supplierDocs ?? []).map((supplier: any) => (
                <MenuItem key={supplier.$id} value={supplier.$id}>
                  {supplier.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>
        <TextField
          label="Description"
          value={current.description ?? ''}
          onChange={(event) => update({ description: event.target.value })}
          size="small"
          multiline
          minRows={2}
        />
        <Autocomplete
          multiple
          freeSolo
          options={[] as string[]}
          value={current.tags ?? []}
          onChange={(_event, tags) =>
            update({ tags: tags.map((tag) => String(tag).trim()).filter(Boolean) })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              size="small"
              placeholder="Type and press Enter"
            />
          )}
        />
        {(categoryDocs?.length ?? 0) > 0 ? (
          <Autocomplete
            multiple
            options={categoryDocs ?? []}
            getOptionLabel={(category: any) => category.name}
            isOptionEqualToValue={(option: any, value: any) =>
              option.$id === value.$id
            }
            value={(categoryDocs ?? []).filter((category: any) =>
              (current.categoryIds ?? []).includes(category.$id),
            )}
            onChange={(_event, picked) =>
              update({
                categoryIds: picked.map((category: any) => category.$id),
              })
            }
            renderInput={(params) => (
              <TextField {...params} label="Categories" size="small" />
            )}
          />
        ) : null}

        <Divider textAlign="left">{'Media'}</Divider>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(current.mediaUrls ?? []).map((url, index) => (
            <Box key={`${url}-${index}`} sx={{ position: 'relative' }}>
              <Box
                component="img"
                src={url}
                alt=""
                sx={{
                  width: 72,
                  height: 72,
                  objectFit: 'cover',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              />
              <IconButton
                size="small"
                aria-label="Remove image"
                onClick={() =>
                  update({
                    mediaUrls: (current.mediaUrls ?? []).filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
                sx={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  p: 0.25,
                }}
              >
                {'✕'}
              </IconButton>
            </Box>
          ))}
          <Button
            size="small"
            onClick={() =>
              void pick((media) =>
                update({
                  mediaUrls: [...(current.mediaUrls ?? []), media.url],
                }),
              )
            }
          >
            {'Add image'}
          </Button>
        </Box>

        <Divider textAlign="left">{'Options & variants'}</Divider>
        {(current.options ?? []).map((option, index) => (
          <Stack
            key={index}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              label="Option"
              value={option.name}
              onChange={(event) =>
                handleOptionsChange(index, { name: event.target.value })
              }
              size="small"
              sx={{ width: 160 }}
              placeholder="Size"
            />
            <Autocomplete
              multiple
              freeSolo
              options={[] as string[]}
              value={option.values}
              onChange={(_event, values) =>
                handleOptionsChange(index, {
                  values: values.map((value) => String(value).trim()).filter(Boolean),
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Values"
                  size="small"
                  placeholder="S, M, L…"
                />
              )}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              color="error"
              onClick={() => handleOptionsChange(index, null)}
              sx={{ mt: 0.5 }}
            >
              {'Remove'}
            </Button>
          </Stack>
        ))}
        {(current.options?.length ?? 0) < CommerceModel.COMMERCE_MAX_OPTIONS ? (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() =>
              handleOptionsChange(current.options?.length ?? 0, {
                name: '',
                values: [],
              })
            }
          >
            {'Add option'}
          </Button>
        ) : null}
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Variant'}</TableCell>
                <TableCell>{'Price ($)'}</TableCell>
                <TableCell>{'Compare-at'}</TableCell>
                <TableCell>{'SKU'}</TableCell>
                <TableCell>{'Barcode'}</TableCell>
                <TableCell>{'Stock'}</TableCell>
                <TableCell>{'Weight (g)'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {current.variants.map((variant, index) => (
                <TableRow key={variant.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {comboLabel(variant.options)}
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.priceUsd ?? ''}
                      onChange={(event) =>
                        handleVariantField(index, 'priceUsd', event.target.value)
                      }
                      size="small"
                      sx={{ width: 88 }}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.compareAtPriceUsd ?? ''}
                      onChange={(event) =>
                        handleVariantField(
                          index,
                          'compareAtPriceUsd',
                          event.target.value,
                        )
                      }
                      size="small"
                      sx={{ width: 88 }}
                      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.sku ?? ''}
                      onChange={(event) =>
                        handleVariantField(index, 'sku', event.target.value)
                      }
                      size="small"
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.barcode ?? ''}
                      onChange={(event) =>
                        handleVariantField(index, 'barcode', event.target.value)
                      }
                      size="small"
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.inventory ?? ''}
                      placeholder={stockApplies ? '—' : 'n/a'}
                      disabled={!stockApplies}
                      onChange={(event) =>
                        handleVariantField(index, 'inventory', event.target.value)
                      }
                      size="small"
                      sx={{ width: 72 }}
                      slotProps={{
                        htmlInput: {
                          inputMode: 'numeric',
                          'aria-label': `Stock — ${comboLabel(variant.options)}`,
                        },
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={variant.weightGrams ?? ''}
                      onChange={(event) =>
                        handleVariantField(index, 'weightGrams', event.target.value)
                      }
                      size="small"
                      sx={{ width: 88 }}
                      slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {stockApplies
            ? 'Blank stock = untracked; 0 shows sold out. The first variant’s ' +
              'price feeds legacy Product blocks.'
            : 'Stock is not tracked on a subscription-only product — nothing ' +
              'decrements it, on the first charge or on any renewal. Choose ' +
              '“Both — buyer chooses” below to track stock on the one-time ' +
              'sales. The first variant’s price feeds legacy Product blocks.'}
        </Typography>
        {strandedStock != null ? (
          <Alert
            severity="warning"
            action={
              <Button size="small" onClick={handleClearStockTracking}>
                {'Clear stock'}
              </Button>
            }
          >
            {`This product still has stock set (${strandedStock}), but ` +
              'subscriptions never decrement it — not the first charge, not ' +
              'any renewal — so the number will not change on its own and ' +
              'does not cap subscribers. It is kept, not deleted: a stored 0 ' +
              'still blocks new subscribers, and the value becomes editable ' +
              'again if you switch Billing back to one-time or “Both”.'}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={2}>
          <TextField
            label="When out of stock"
            value={current.oversellPolicy ?? 'deny'}
            onChange={(event) =>
              update({
                oversellPolicy: event.target.value as 'deny' | 'backorder',
              })
            }
            size="small"
            select
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="deny">{'Stop selling (sold out)'}</MenuItem>
            <MenuItem value="backorder">{'Keep selling (backorder)'}</MenuItem>
          </TextField>
          <TextField
            label="Kind"
            value={current.giftCard ? 'gift' : 'standard'}
            onChange={(event) =>
              update({ giftCard: event.target.value === 'gift' })
            }
            size="small"
            select
            sx={{ minWidth: 130 }}
            helperText="Gift cards issue a code"
          >
            <MenuItem value="standard">{'Standard'}</MenuItem>
            <MenuItem value="gift">{'Gift card'}</MenuItem>
          </TextField>
          <TextField
            label="Tax"
            value={current.taxExempt ? 'exempt' : 'taxable'}
            onChange={(event) =>
              update({ taxExempt: event.target.value === 'exempt' })
            }
            size="small"
            select
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="taxable">{'Taxable'}</MenuItem>
            <MenuItem value="exempt">{'Tax exempt'}</MenuItem>
          </TextField>
          <TextField
            label="Low-stock alert at"
            value={current.lowStockThreshold ?? ''}
            placeholder="Off"
            disabled={!stockApplies}
            onChange={(event) => {
              const raw = event.target.value.trim()
              update({
                lowStockThreshold:
                  raw === '' ? undefined : Math.max(0, Math.round(Number(raw))),
              })
            }}
            size="small"
            sx={{ width: 140 }}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            helperText="Notifies managers"
          />
        </Stack>

        <Stack direction="row" spacing={2}>
          <TextField
            label="Billing"
            value={
              current.subscription
                ? current.subscriptionOptional
                  ? 'both'
                  : current.subscription.interval
                : 'once'
            }
            onChange={(event) => {
              const value = event.target.value
              // "Both" (AGL-545): the PDP offers one-time OR subscribe at
              // the same price; the interval field beside picks the cadence.
              // Cleared keys are deleted (not set undefined) so the
              // client-direct setDoc on save never sees undefined values.
              const next = { ...current }
              if (value === 'once') {
                delete next.subscription
              } else {
                next.subscription = {
                  ...(current.subscription ?? {}),
                  interval:
                    value === 'both'
                      ? (current.subscription?.interval ?? 'month')
                      : (value as 'month' | 'year'),
                }
              }
              if (value === 'both') next.subscriptionOptional = true
              else delete next.subscriptionOptional
              // setDraft directly: update() spreads the patch over
              // `current`, which would resurrect the deleted keys.
              setDraft(next)
            }}
            size="small"
            select
            sx={{ minWidth: 180 }}
            helperText="Subscriptions bill until cancelled"
          >
            <MenuItem value="once">{'One-time purchase'}</MenuItem>
            <MenuItem value="month">{'Monthly subscription'}</MenuItem>
            <MenuItem value="year">{'Yearly subscription'}</MenuItem>
            <MenuItem value="both">{'Both — buyer chooses'}</MenuItem>
          </TextField>
          {current.subscription && current.subscriptionOptional ? (
            <TextField
              label="Interval"
              value={current.subscription.interval}
              onChange={(event) =>
                update({
                  subscription: {
                    ...current.subscription!,
                    interval: event.target.value as 'month' | 'year',
                  },
                })
              }
              size="small"
              select
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="month">{'Monthly'}</MenuItem>
              <MenuItem value="year">{'Yearly'}</MenuItem>
            </TextField>
          ) : null}
          {current.subscription ? (
            <TextField
              label="Free trial (days)"
              placeholder="None"
              value={current.subscription.trialDays ?? ''}
              onChange={(event) => {
                const raw = event.target.value.trim()
                update({
                  subscription: {
                    ...current.subscription!,
                    ...(raw === ''
                      ? { trialDays: undefined }
                      : { trialDays: Math.max(1, Math.round(Number(raw))) }),
                  },
                })
              }}
              size="small"
              sx={{ width: 140 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          ) : null}
        </Stack>
        {current.type === 'digital' ? (
          <>
            <Divider textAlign="left">{'Digital delivery'}</Divider>
            {(current.digitalFiles ?? []).map((file, index) => (
              <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {file.fileName}
                  {file.version ? ` · v${file.version}` : ''}
                </Typography>
                <TextField
                  label="Version"
                  value={file.version ?? ''}
                  onChange={(event) => {
                    const digitalFiles = [...(current.digitalFiles ?? [])]
                    digitalFiles[index] = {
                      ...file,
                      version: event.target.value.slice(0, 20),
                    }
                    update({ digitalFiles })
                  }}
                  size="small"
                  sx={{ width: 100 }}
                />
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    update({
                      digitalFiles: (current.digitalFiles ?? []).filter(
                        (_item, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  {'✕'}
                </Button>
              </Stack>
            ))}
            <Stack direction="row" spacing={2}>
              <Button
                size="small"
                onClick={() =>
                  void pick((media) =>
                    update({
                      digitalFiles: [
                        ...(current.digitalFiles ?? []),
                        { url: media.url, fileName: media.fileName ?? 'download' },
                      ],
                    }),
                  )
                }
              >
                {'Add file (media library)'}
              </Button>
              <TextField
                label="Download limit"
                placeholder="Unlimited"
                value={current.downloadLimit ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  update({
                    downloadLimit:
                      raw === ''
                        ? undefined
                        : Math.max(1, Math.round(Number(raw))),
                  })
                }}
                size="small"
                sx={{ width: 140 }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                helperText="Attempts per order"
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {'Buyers always download the current files — uploading a new ' +
                'version re-delivers to everyone.'}
            </Typography>
            {(current.gatedVideos ?? []).map((video, index) => (
              <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {`🎬 ${video.title || video.url}`}
                </Typography>
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    update({
                      gatedVideos: (current.gatedVideos ?? []).filter(
                        (_item, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  {'✕'}
                </Button>
              </Stack>
            ))}
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() =>
                void pick((media) =>
                  update({
                    gatedVideos: [
                      ...(current.gatedVideos ?? []),
                      { url: media.url, title: media.fileName ?? '' },
                    ],
                  }),
                )
              }
            >
              {'Add members video'}
            </Button>
          </>
        ) : null}

        <Autocomplete
          multiple
          options={(allProductDocs ?? []).filter(
            (item: any) => !item.deletedAt && item.$id !== product?.$id,
          )}
          getOptionLabel={(item: any) => item.name ?? item.$id}
          isOptionEqualToValue={(option: any, value: any) =>
            option.$id === value.$id
          }
          value={(allProductDocs ?? []).filter((item: any) =>
            (current.relatedProductIds ?? []).includes(item.$id),
          )}
          onChange={(_event, picked) =>
            update({
              relatedProductIds: picked.map((item: any) => item.$id),
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Related products (upsells)"
              size="small"
              helperText="Shown by the Related products block; blank falls back to frequently-bought-together"
            />
          )}
        />

        <Divider textAlign="left">{'Search engine listing'}</Divider>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="SEO title"
            value={current.seo?.title ?? ''}
            onChange={(event) =>
              update({ seo: { ...current.seo, title: event.target.value } })
            }
            size="small"
            fullWidth
          />
          <Button
            size="small"
            onClick={() =>
              void pick((media) =>
                update({ seo: { ...current.seo, imageUrl: media.url } }),
              )
            }
          >
            {current.seo?.imageUrl ? 'Change OG image' : 'OG image'}
          </Button>
        </Stack>
        <TextField
          label="SEO description"
          value={current.seo?.description ?? ''}
          onChange={(event) =>
            update({ seo: { ...current.seo, description: event.target.value } })
          }
          size="small"
          multiline
          minRows={2}
        />

        {error ? <Alert severity="warning">{error}</Alert> : null}
        {product?.$id ? (
          <Typography variant="caption" color="text.secondary">
            {`id: ${product.$id}`}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!current.name.trim() || Boolean(error)}
          onClick={handleSave}
        >
          {'Save product'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ProductEditorDialog.displayName = 'ProductEditorDialog'

export default ProductEditorDialog
