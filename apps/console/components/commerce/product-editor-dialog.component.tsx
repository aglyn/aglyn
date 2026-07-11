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
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import MediaPickerDialog from '../media/media-picker-dialog.component'

export interface ProductEditorDialogProps {
  hostId: string
  /** Product doc (with `$id`) to edit, `null` for a new product. */
  product: (Aglyn.HostProduct & { $id: string }) | null
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
  const { hostId, product, open, onClose } = props
  const firestore = useFirestore()
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

  const lifted = useMemo(
    () => (product ? Aglyn.liftLegacyProduct(product) : null),
    [product],
  )
  const [draft, setDraft] = useState<Aglyn.HostProduct | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [pickerFor, setPickerFor] = useState<'media' | 'seo' | null>(null)
  // Lazy-init per open; parent remounts via `key` on product change.
  const current: Aglyn.HostProduct =
    draft ??
    lifted ?? {
      name: '',
      slug: '',
      type: 'physical',
      status: 'draft',
      variants: [{ id: 'default', priceUsd: 0 }],
    }
  const update = (patch: Partial<Aglyn.HostProduct>) =>
    setDraft({ ...current, ...patch })

  const error = current.name ? Aglyn.validateProduct(current) : null

  const handleName = (name: string) =>
    update({
      name,
      ...(!product && !slugTouched ? { slug: Aglyn.commerceSlug(name) } : {}),
    })

  const handleOptionsChange = useCallback(
    (index: number, patch: Partial<Aglyn.ProductOption> | null) => {
      const options = [...(current.options ?? [])]
      if (patch === null) options.splice(index, 1)
      else options[index] = { name: '', values: [], ...options[index], ...patch }
      // Regenerate the matrix, carrying data over by option-combo key so
      // edits to prices/SKUs survive option tweaks.
      const previous = new Map(
        current.variants.map((variant) => [comboKey(variant.options), variant]),
      )
      const fallback = current.variants[0]
      const variants = Aglyn.expandVariantMatrix(options).map(
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
    field: keyof Aglyn.ProductVariant,
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
    try {
      const id = product?.$id ?? Aglyn.createResourceUid()
      const primaryVariant = current.variants[0]
      await setDoc(
        doc(firestore, 'hosts', hostId, 'products', id),
        {
          ...current,
          name: current.name.trim().slice(0, 120),
          slug: current.slug || Aglyn.commerceSlug(current.name),
          // Legacy denormalization: the AGL-90 checkout + Product block
          // read these flat fields.
          priceUsd: primaryVariant?.priceUsd ?? 0,
          inventory: Aglyn.productInventory(current),
          imageUrl: current.mediaUrls?.[0] ?? current.imageUrl ?? null,
          updatedAtMs: Date.now(),
          ...(product ? {} : { createdAtMs: Date.now() }),
          updatedAt: Timestamp.now(),
        },
        { merge: false },
      )
      onClose()
      enqueueSnackbar('Product saved', { variant: 'success', persist: false })
    } catch (saveError) {
      console.error(saveError)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [current, error, product, firestore, hostId, onClose, enqueueSnackbar])

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
              update({ slug: Aglyn.commerceSlug(event.target.value) })
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
              update({ type: event.target.value as Aglyn.ProductType })
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
              update({ status: event.target.value as Aglyn.ProductStatus })
            }
            size="small"
            select
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="draft">{'Draft'}</MenuItem>
            <MenuItem value="active">{'Active'}</MenuItem>
            <MenuItem value="archived">{'Archived'}</MenuItem>
          </TextField>
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
          options={[]}
          value={current.tags ?? []}
          onChange={(_event, tags) =>
            update({ tags: tags.map((tag) => String(tag).trim()).filter(Boolean) })
          }
          renderTags={(value, getTagProps) =>
            value.map((tag, index) => (
              <Chip
                label={tag}
                size="small"
                {...getTagProps({ index })}
                key={tag}
              />
            ))
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
          <Button size="small" onClick={() => setPickerFor('media')}>
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
              options={[]}
              value={option.values}
              onChange={(_event, values) =>
                handleOptionsChange(index, {
                  values: values.map((value) => String(value).trim()).filter(Boolean),
                })
              }
              renderTags={(value, getTagProps) =>
                value.map((item, itemIndex) => (
                  <Chip
                    label={item}
                    size="small"
                    {...getTagProps({ index: itemIndex })}
                    key={item}
                  />
                ))
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
        {(current.options?.length ?? 0) < Aglyn.COMMERCE_MAX_OPTIONS ? (
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
                      inputProps={{ inputMode: 'decimal' }}
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
                      inputProps={{ inputMode: 'decimal' }}
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
                      placeholder="—"
                      onChange={(event) =>
                        handleVariantField(index, 'inventory', event.target.value)
                      }
                      size="small"
                      sx={{ width: 72 }}
                      inputProps={{ inputMode: 'numeric' }}
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
                      inputProps={{ inputMode: 'numeric' }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {'Blank stock = untracked; 0 shows sold out. The first variant’s ' +
            'price feeds legacy Product blocks.'}
        </Typography>

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
          <Button size="small" onClick={() => setPickerFor('seo')}>
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
          color="secondary"
          disabled={!current.name.trim() || Boolean(error)}
          onClick={handleSave}
        >
          {'Save product'}
        </Button>
      </DialogActions>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={(media) => {
          if (pickerFor === 'media') {
            update({ mediaUrls: [...(current.mediaUrls ?? []), media.url] })
          } else if (pickerFor === 'seo') {
            update({ seo: { ...current.seo, imageUrl: media.url } })
          }
          setPickerFor(null)
        }}
      />
    </Dialog>
  )
}
ProductEditorDialog.displayName = 'ProductEditorDialog'

export default ProductEditorDialog
