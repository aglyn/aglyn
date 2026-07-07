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
import { useFirestore, useFirestoreCollectionData } from 'reactfire'

export interface HostProductsCardProps {
  hostId: string
}

interface ProductDraft {
  id: string | null
  name: string
  price: string
  description: string
  imageUrl: string
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
  const { data: productDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'products'), limit(100)),
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
                  {`${product.name} · $${product.priceUsd}`}
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
            })
          }
        >
          {'Add product'}
        </Button>
      </Stack>
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
