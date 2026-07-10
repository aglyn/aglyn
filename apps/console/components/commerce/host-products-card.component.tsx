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

import { COMMERCE_MAX_PRICE_USD, createResourceUid } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

export interface HostProductsCardProps {
  hostId: string
}

interface ProductDraft {
  id: string | null
  name: string
  price: string
  description: string
  imageUrl: string
  /** Blank = untracked; 0 = sold out (AGL-96). */
  inventory: string
}

/**
 * Commerce Starter products (AGL-90): CRUD on `hosts/{hostId}/products`.
 * The Product canvas component references a product id from here, and the
 * checkout API charges this doc's price — display props on the canvas are
 * cosmetic. Delete is a soft delete so past order rows keep resolving.
 */
export function HostProductsCard(props: HostProductsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products = [...(productDocs ?? [])]
    .filter((product: any) => !product.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const price = Number(draft?.price ?? 0)
  const validPrice = price > 0 && price <= COMMERCE_MAX_PRICE_USD

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim() || !validPrice) return
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'products', id),
        {
          name: draft.name.trim().slice(0, 120),
          priceUsd: price,
          ...(draft.description.trim() && {
            description: draft.description.trim().slice(0, 500),
          }),
          ...(draft.imageUrl.trim() && {
            imageUrl: draft.imageUrl.trim().slice(0, 500),
          }),
          inventory:
            draft.inventory.trim() === ''
              ? null
              : Math.max(0, Math.round(Number(draft.inventory))),
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Product saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, validPrice, price, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (product: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this product?',
        description:
          `"${product.name}" stops being purchasable; Product blocks ` +
          'referencing it show a checkout error until repointed.',
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

  // Coupons (AGL-96): percent-off codes at hosts/{hostId}/coupons/{CODE}.
  const { data: couponDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'coupons'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const coupons = [...(couponDocs ?? [])].sort((a: any, b: any) =>
    String(a.$id).localeCompare(String(b.$id)),
  )
  const [couponDraft, setCouponDraft] = useState<{
    code: string
    percentOff: string
    maxRedemptions: string
  } | null>(null)
  const handleCouponSave = useCallback(async () => {
    if (!couponDraft) return
    const code = couponDraft.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 40)
    const percentOff = Math.round(Number(couponDraft.percentOff))
    if (!code || !(percentOff > 0 && percentOff <= 100)) return
    await setDoc(doc(firestore, 'hosts', hostId, 'coupons', code), {
      percentOff,
      enabled: true,
      redemptions: 0,
      ...(couponDraft.maxRedemptions.trim()
        ? { maxRedemptions: Math.max(1, Math.round(Number(couponDraft.maxRedemptions))) }
        : {}),
      createdAt: Timestamp.now(),
    })
    setCouponDraft(null)
    enqueueSnackbar(`Coupon ${code} created`, {
      variant: 'success',
      persist: false,
    })
  }, [couponDraft, firestore, hostId, enqueueSnackbar])
  const handleCouponToggle = useCallback(
    (coupon: any) => () =>
      updateDoc(doc(firestore, 'hosts', hostId, 'coupons', coupon.$id), {
        enabled: coupon.enabled === false,
      }),
    [firestore, hostId],
  )

  return (
    <CardDisplay header={'Products'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {products.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Sell a few things: add a product here, then place a Product ' +
              'block on any screen and point it at the product id.'}
          </Typography>
        ) : (
          products.map((product: any) => (
            <Stack
              key={product.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${product.name} · $${product.priceUsd}` +
                    (product.inventory != null
                      ? Number(product.inventory) > 0
                        ? ` · ${product.inventory} in stock`
                        : ' · sold out'
                      : '')}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`id: ${product.$id}`}
                </Typography>
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: product.$id,
                    name: product.name ?? '',
                    price: String(product.priceUsd ?? ''),
                    description: product.description ?? '',
                    imageUrl: product.imageUrl ?? '',
                    inventory:
                      product.inventory == null
                        ? ''
                        : String(product.inventory),
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button size="small" color="error" onClick={handleDelete(product)}>
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setDraft({
              id: null,
              name: '',
              price: '',
              description: '',
              imageUrl: '',
              inventory: '',
            })
          }
        >
          {'Add product'}
        </Button>
      </Stack>
      <Stack spacing={1} sx={{ mt: 2 }}>
        <Typography variant="subtitle2">{'Coupons'}</Typography>
        {coupons.map((coupon: any) => (
          <Stack
            key={coupon.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Typography variant="body2" sx={{ flex: 1 }} noWrap>
              {`${coupon.$id} · ${coupon.percentOff}% off · ` +
                `${coupon.redemptions ?? 0}${
                  coupon.maxRedemptions ? `/${coupon.maxRedemptions}` : ''
                } used` +
                (coupon.enabled === false ? ' · disabled' : '')}
            </Typography>
            <Button size="small" onClick={handleCouponToggle(coupon)}>
              {coupon.enabled === false ? 'Enable' : 'Disable'}
            </Button>
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setCouponDraft({ code: '', percentOff: '', maxRedemptions: '' })
          }
        >
          {'Add coupon'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(couponDraft)}
        onClose={() => setCouponDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New coupon'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Code"
            value={couponDraft?.code ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, code: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText="Letters/numbers; stored uppercase, e.g. LAUNCH20"
          />
          <TextField
            label="Percent off"
            type="number"
            value={couponDraft?.percentOff ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, percentOff: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Max redemptions"
            type="number"
            placeholder="Blank = unlimited"
            value={couponDraft?.maxRedemptions ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, maxRedemptions: event.target.value } : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCouponDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              !couponDraft?.code.trim() ||
              !(Number(couponDraft?.percentOff) > 0) ||
              Number(couponDraft?.percentOff) > 100
            }
            onClick={handleCouponSave}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit product' : 'Add product'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Price (USD)"
            value={draft?.price ?? ''}
            error={Boolean(draft?.price) && !validPrice}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      price: event.target.value.replace(/[^0-9.]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Description"
            value={draft?.description ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label="Inventory"
            type="number"
            placeholder="Blank = untracked"
            helperText="0 shows the block as sold out; each sale decrements"
            value={draft?.inventory ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, inventory: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Image URL"
            placeholder="Copy from the Media library"
            value={draft?.imageUrl ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, imageUrl: event.target.value } : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.name.trim() || !validPrice}
            onClick={handleSave}
          >
            {'Save product'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostProductsCard.displayName = 'HostProductsCard'

export default HostProductsCard
