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
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
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
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import ProductEditorDialog from './product-editor-dialog.component'

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
  const orgId = useHostOrgId(hostId)
  const { data: org } = useFirestoreDoc<any>(
    () => doc(firestore, 'orgs', orgId ?? '-pending-'),
    [firestore, orgId],
  )
  const { confirm } = useConfirmationContext()
  const [search, setSearch] = useState('')
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

  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'products'), limit(500)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // License key pool (AGL-308) for the open dialog's product.
  const { data: keyDocs } = useFirestoreCollection<any>(
    () =>
      keysFor
        ? query(
            collection(firestore, 'hosts', hostId, 'licenseKeys'),
            limit(500),
          )
        : null,
    [firestore, hostId, keysFor?.$id],
    { idField: '$id' },
  )
  // Locations (AGL-286): the stock dialog buckets deltas when they exist.
  const { data: locationDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'locations'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return [...(productDocs ?? [])]
      .filter((product: any) => !product.deletedAt)
      .map((product: any) => ({
        ...CommerceModel.liftLegacyProduct(product),
        $id: product.$id,
      }))
      .filter((product: ProductRow) => {
        if (statusFilter !== 'all' && product.status !== statusFilter) {
          return false
        }
        if (!needle) return true
        return (
          product.name.toLowerCase().includes(needle) ||
          product.slug.includes(needle) ||
          (product.tags ?? []).some((tag) =>
            tag.toLowerCase().includes(needle),
          ) ||
          product.variants.some((variant) =>
            variant.sku?.toLowerCase().includes(needle),
          )
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [productDocs, search, statusFilter])

  // Cap against ALL live products, not the filtered view (AGL-471).
  const productCount = useMemo(
    () => (productDocs ?? []).filter((product: any) => !product.deletedAt).length,
    [productDocs],
  )
  const productQuota = Aglyn.checkQuota(org, 'productsPerHost', productCount)

  const handleDuplicate = useCallback(
    (product: ProductRow) => async () => {
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
    enqueueSnackbar(`Imported ${parsed.products.length} products`, {
      variant: 'success',
      persist: false,
    })
  }, [importing, products, hostId, createHostResource, enqueueSnackbar, org, productCount])

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
    await updateDoc(
      doc(firestore, 'hosts', hostId, 'products', adjusting.product.$id),
      {
        variants,
        inventory: CommerceModel.productInventory({ variants }),
        updatedAtMs: Date.now(),
      },
    )
    // Adjustment history (AGL-281): the same log the sale webhook writes.
    await addDoc(collection(firestore, 'hosts', hostId, 'inventoryAdjustments'), {
      productId: adjusting.product.$id,
      variantId: adjusting.variantId,
      delta,
      reason: adjusting.reason,
      ...(adjusting.locationId ? { locationId: adjusting.locationId } : {}),
      atMs: Date.now(),
    } satisfies CommerceModel.InventoryAdjustment)
    setAdjusting(null)
    enqueueSnackbar('Stock adjusted', { variant: 'success', persist: false })
  }, [adjusting, firestore, hostId, enqueueSnackbar])

  const formatPrice = (product: ProductRow) => {
    const [min, max] = CommerceModel.productPriceRange(product)
    return min === max ? `$${min}` : `$${min}–$${max}`
  }
  const formatStock = (product: ProductRow) => {
    const total = CommerceModel.productInventory(product)
    if (total == null) return '—'
    return total > 0 ? String(total) : 'Sold out'
  }

  return (
    <CardDisplay
      header={`Products${products.length ? ` (${products.length})` : ''}`}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Search"
            placeholder="Name, slug, tag, or SKU"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
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
            color="secondary"
            size="small"
            onClick={() => {
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
                {products.map((product) => (
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
                    <TableCell>{formatStock(product)}</TableCell>
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
            const productKeys = (keyDocs ?? []).filter(
              (key: any) => key.productId === keysFor?.$id,
            )
            const available = productKeys.filter(
              (key: any) => !key.assignedAtMs,
            )
            return (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {`${available.length} available · ${productKeys.length - available.length} assigned. ` +
                    'Keys deliver automatically on purchase (receipt + account).'}
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
            color="secondary"
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
            color="secondary"
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
                  {`${Object.values(variant.options ?? {}).join(' / ') || 'Default'} — ${variant.inventory} in stock`}
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
            color="secondary"
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
        open={creating || editing !== null}
        onClose={() => {
          setEditing(null)
          setCreating(false)
        }}
      />
    </CardDisplay>
  )
}
ProductsHubCard.displayName = 'ProductsHubCard'

export default ProductsHubCard
