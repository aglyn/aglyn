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
  Alert,
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface CatalogOrganizationCardProps {
  hostId: string
}

type CategoryRow = CommerceModel.ProductCategory & { $id: string }
type CollectionRow = CommerceModel.HostCollection & { $id: string }
type ProductRow = CommerceModel.HostProduct & { $id: string }

const RULE_FIELDS: Array<{ value: CommerceModel.CollectionRuleField; label: string }> = [
  { value: 'tag', label: 'Tag' },
  { value: 'categoryId', label: 'Category' },
  { value: 'priceUsd', label: 'Price' },
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
]
const RULE_OPS: Array<{ value: CommerceModel.CollectionRuleOp; label: string }> = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'lt', label: 'below' },
  { value: 'gt', label: 'above' },
  { value: 'contains', label: 'contains' },
]

/**
 * Categories & collections manager (AGL-280): category tree (parentId)
 * at `hosts/{hostId}/productCategories`, manual + smart collections at
 * `hosts/{hostId}/collections` with a live matched-product preview from
 * the same `matchesCollection` matcher the storefront uses.
 */
export function CatalogOrganizationCard(props: CatalogOrganizationCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: user } = useUser()

  const { data: categoryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'productCategories'),
        limit(250),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: collectionDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'collections'), limit(250)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'products'), limit(500)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products: ProductRow[] = useMemo(
    () =>
      [...(productDocs ?? [])]
        .filter((product: any) => !product.deletedAt)
        .map((product: any) => ({
          ...CommerceModel.liftLegacyProduct(product),
          $id: product.$id,
        })),
    [productDocs],
  )
  // Content collections (AGL-81) live in the same `hosts/{hostId}/collections`
  // subcollection. This used to keep them out by requiring a non-empty
  // `name`, which held only because the Content page happens to write
  // `displayName` — a content doc that ever acquired a `name` (an import, a
  // hand edit) would land in this list, and its Delete now cascades into
  // `entries` (AGL-947). The shared classifier is the real check (AGL-954).
  const commerceCollections: CollectionRow[] = useMemo(
    () => (collectionDocs ?? []).filter(Aglyn.isHostCollectionKind('catalog')),
    [collectionDocs],
  )

  // Categories ordered as a walked tree: parents before children.
  const categories: Array<CategoryRow & { depth: number }> = useMemo(() => {
    const rows = [...(categoryDocs ?? [])] as CategoryRow[]
    rows.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
    )
    const byParent = new Map<string | null, CategoryRow[]>()
    for (const row of rows) {
      const key = row.parentId ?? null
      byParent.set(key, [...(byParent.get(key) ?? []), row])
    }
    const walked: Array<CategoryRow & { depth: number }> = []
    const walk = (parentId: string | null, depth: number) => {
      for (const row of byParent.get(parentId) ?? []) {
        walked.push({ ...row, depth })
        if (depth < 4) walk(row.$id, depth + 1)
      }
    }
    walk(null, 0)
    // Orphans (parent deleted) still show, at the root.
    for (const row of rows) {
      if (!walked.some((item) => item.$id === row.$id)) {
        walked.push({ ...row, depth: 0 })
      }
    }
    return walked
  }, [categoryDocs])

  const [categoryDraft, setCategoryDraft] = useState<{
    id: string | null
    name: string
    parentId: string
  } | null>(null)
  const [collectionDraft, setCollectionDraft] = useState<
    (CommerceModel.HostCollection & { id: string | null }) | null
  >(null)

  const handleCategorySave = useCallback(async () => {
    if (!categoryDraft?.name.trim()) return
    const id = categoryDraft.id ?? Aglyn.createResourceUid()
    await setDoc(doc(firestore, 'hosts', hostId, 'productCategories', id), {
      name: categoryDraft.name.trim().slice(0, 80),
      slug: CommerceModel.commerceSlug(categoryDraft.name),
      parentId: categoryDraft.parentId || null,
      updatedAt: Timestamp.now(),
    })
    setCategoryDraft(null)
    enqueueSnackbar('Category saved', { variant: 'success', persist: false })
  }, [categoryDraft, firestore, hostId, enqueueSnackbar])

  const handleCategoryDelete = useCallback(
    (category: CategoryRow) => async () => {
      const confirmed = await confirm({
        title: 'Delete this category?',
        description:
          `Products keep their other categories; children of ` +
          `"${category.name}" move to the top level.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // Reparent children to root, then remove.
      const children = (categoryDocs ?? []).filter(
        (row: any) => row.parentId === category.$id,
      )
      for (const child of children) {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'productCategories', child.$id),
          { ...child, parentId: null },
        )
      }
      await deleteDoc(
        doc(firestore, 'hosts', hostId, 'productCategories', category.$id),
      )
    },
    [confirm, categoryDocs, firestore, hostId],
  )

  const draftSlug = collectionDraft
    ? collectionDraft.slug || CommerceModel.commerceSlug(collectionDraft.name)
    : ''
  // The slug is the collection's public address at /collections/{slug} and
  // nothing enforced uniqueness (AGL-957) — a second one at the same slug
  // made the first unreachable with no error anywhere. Checked against the
  // catalog collections only; content collections have their own namespace.
  const slugTaken =
    collectionDraft !== null &&
    Aglyn.isCollectionSlugTaken(
      draftSlug,
      'catalog',
      commerceCollections,
      collectionDraft.id,
    )
  const collectionError = collectionDraft
    ? collectionDraft.name
      ? (CommerceModel.validateCollection({
          ...collectionDraft,
          slug: draftSlug,
        }) ??
        (slugTaken
          ? `Another collection already serves /collections/${draftSlug}`
          : null))
      : null
    : null

  const previewMatches = useMemo(() => {
    if (!collectionDraft) return []
    const candidate: CommerceModel.HostCollection = {
      ...collectionDraft,
      slug: collectionDraft.slug || CommerceModel.commerceSlug(collectionDraft.name),
    }
    return products.filter((product) =>
      CommerceModel.matchesCollection(product, candidate, product.$id),
    )
  }, [collectionDraft, products])

  const handleCollectionSave = useCallback(async () => {
    if (!collectionDraft?.name.trim() || collectionError) return
    const { id: draftId, ...data } = collectionDraft
    // Both create and rename go through the route (AGL-978): this save writes
    // the whole document including `slug`, which is the collection's public
    // address and is claimed transactionally there. Rules deny a client
    // create, and freeze `slug`/`kind` on update.
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/collections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          action: draftId ? 'update' : 'create',
          kind: 'catalog',
          ...(draftId ? { id: draftId } : {}),
          data: {
            ...data,
            name: collectionDraft.name.trim().slice(0, 80),
            slug: draftSlug,
          },
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'Collection save failed')
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Collection save failed', {
        variant: 'error',
      })
    }
    setCollectionDraft(null)
    enqueueSnackbar('Collection saved', { variant: 'success', persist: false })
  }, [collectionDraft, collectionError, draftSlug, user, hostId, enqueueSnackbar])

  const handleCollectionDelete = useCallback(
    (row: CollectionRow) => async () => {
      const confirmed = await confirm({
        title: 'Delete this collection?',
        description:
          `Storefront blocks pointing at "${row.name}" go empty, and any ` +
          'content entries published under it are deleted with it.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      // A collection owns an `entries` subcollection (the Content page's
      // published entries) and Firestore doesn't cascade, so deleting the
      // doc from here stranded them — still editor-writable through the
      // host catch-all rule, just unreachable. recursiveDelete is
      // Admin-SDK-only, hence the route (AGL-947).
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/resources/erase', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            scope: 'hosts',
            scopeId: hostId,
            kind: 'collections',
            id: row.$id,
            // The route re-checks this server-side (AGL-954): a stale client
            // must not be able to recursiveDelete a content collection's
            // entries through the catalog card.
            collectionKind: 'catalog',
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(result?.error ?? 'Collection delete failed')
        }
      } catch (error: any) {
        return void enqueueSnackbar(error?.message ?? 'Collection delete failed', {
          variant: 'error',
        })
      }
      enqueueSnackbar('Collection deleted', { variant: 'success', persist: false })
    },
    [confirm, user, hostId, enqueueSnackbar],
  )

  const collectionCount = (row: CollectionRow) =>
    products.filter((product) =>
      CommerceModel.matchesCollection(product, row, product.$id),
    ).length

  const updateRule = (
    index: number,
    patch: Partial<CommerceModel.CollectionRule> | null,
  ) => {
    if (!collectionDraft) return
    const rules = [...(collectionDraft.rules ?? [])]
    if (patch === null) rules.splice(index, 1)
    else
      rules[index] = {
        field: 'tag',
        op: 'eq',
        value: '',
        ...rules[index],
        ...patch,
      }
    setCollectionDraft({ ...collectionDraft, rules })
  }

  return (
    <CardDisplay header={'Categories & collections'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Categories'}</Typography>
        {categories.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Group products into a browsable tree (e.g. Brakes → Pads).'}
          </Typography>
        ) : (
          categories.map((category) => (
            <Stack
              key={category.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', pl: category.depth * 2 }}
            >
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {category.name}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                >
                  {` /${category.slug}`}
                </Typography>
              </Typography>
              <Button
                size="small"
                onClick={() =>
                  setCategoryDraft({
                    id: category.$id,
                    name: category.name,
                    parentId: category.parentId ?? '',
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleCategoryDelete(category)}
              >
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => setCategoryDraft({ id: null, name: '', parentId: '' })}
        >
          {'Add category'}
        </Button>

        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2">{'Collections'}</Typography>
        {commerceCollections.map((row) => (
          <Stack
            key={row.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Typography variant="body2" sx={{ flex: 1 }} noWrap>
              {row.name}
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
              >
                {` · ${row.mode ?? 'manual'} · ${collectionCount(row)} products`}
              </Typography>
            </Typography>
            <Button
              size="small"
              onClick={() =>
                setCollectionDraft({
                  id: row.$id,
                  name: row.name,
                  slug: row.slug ?? '',
                  mode: row.mode ?? 'manual',
                  productIds: row.productIds ?? [],
                  rules: row.rules ?? [],
                  matchAll: row.matchAll !== false,
                })
              }
            >
              {'Edit'}
            </Button>
            <Button size="small" color="error" onClick={handleCollectionDelete(row)}>
              {'Delete'}
            </Button>
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setCollectionDraft({
              id: null,
              name: '',
              slug: '',
              mode: 'manual',
              productIds: [],
              rules: [],
              matchAll: true,
            })
          }
        >
          {'Add collection'}
        </Button>
      </Stack>

      <Dialog
        open={Boolean(categoryDraft)}
        onClose={() => setCategoryDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {categoryDraft?.id ? 'Edit category' : 'New category'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={categoryDraft?.name ?? ''}
            onChange={(event) =>
              setCategoryDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Parent category"
            value={categoryDraft?.parentId ?? ''}
            onChange={(event) =>
              setCategoryDraft((prev) =>
                prev ? { ...prev, parentId: event.target.value } : prev,
              )
            }
            size="small"
            select
          >
            <MenuItem value="">{'None (top level)'}</MenuItem>
            {categories
              .filter((category) => category.$id !== categoryDraft?.id)
              .map((category) => (
                <MenuItem key={category.$id} value={category.$id}>
                  {`${'— '.repeat(category.depth)}${category.name}`}
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoryDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!categoryDraft?.name.trim()}
            onClick={handleCategorySave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(collectionDraft)}
        onClose={() => setCollectionDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {collectionDraft?.id ? 'Edit collection' : 'New collection'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={collectionDraft?.name ?? ''}
            onChange={(event) =>
              setCollectionDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            error={slugTaken}
            helperText={
              collectionDraft?.name ? `/collections/${draftSlug}` : undefined
            }
          />
          <TextField
            label="Mode"
            value={collectionDraft?.mode ?? 'manual'}
            onChange={(event) =>
              setCollectionDraft((prev) =>
                prev
                  ? { ...prev, mode: event.target.value as 'manual' | 'smart' }
                  : prev,
              )
            }
            size="small"
            select
          >
            <MenuItem value="manual">{'Manual — pick products'}</MenuItem>
            <MenuItem value="smart">{'Smart — rule based'}</MenuItem>
          </TextField>
          {collectionDraft?.mode === 'manual' ? (
            <Autocomplete
              multiple
              options={products}
              getOptionLabel={(product) => product.name}
              isOptionEqualToValue={(option, value) => option.$id === value.$id}
              value={products.filter((product) =>
                (collectionDraft.productIds ?? []).includes(product.$id),
              )}
              onChange={(_event, picked) =>
                setCollectionDraft((prev) =>
                  prev
                    ? { ...prev, productIds: picked.map((item) => item.$id) }
                    : prev,
                )
              }
              renderInput={(params) => (
                <TextField {...params} label="Products" size="small" />
              )}
            />
          ) : (
            <>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2">{'Match'}</Typography>
                <Switch
                  size="small"
                  checked={collectionDraft?.matchAll !== false}
                  onChange={(event) =>
                    setCollectionDraft((prev) =>
                      prev ? { ...prev, matchAll: event.target.checked } : prev,
                    )
                  }
                />
                <Typography variant="body2">
                  {collectionDraft?.matchAll !== false
                    ? 'all rules'
                    : 'any rule'}
                </Typography>
              </Stack>
              {(collectionDraft?.rules ?? []).map((rule, index) => (
                <Stack key={index} direction="row" spacing={1}>
                  <TextField
                    value={rule.field}
                    onChange={(event) =>
                      updateRule(index, {
                        field: event.target.value as CommerceModel.CollectionRuleField,
                      })
                    }
                    size="small"
                    select
                    sx={{ width: 130 }}
                  >
                    {RULE_FIELDS.map((field) => (
                      <MenuItem key={field.value} value={field.value}>
                        {field.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    value={rule.op}
                    onChange={(event) =>
                      updateRule(index, {
                        op: event.target.value as CommerceModel.CollectionRuleOp,
                      })
                    }
                    size="small"
                    select
                    sx={{ width: 110 }}
                  >
                    {RULE_OPS.map((op) => (
                      <MenuItem key={op.value} value={op.value}>
                        {op.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {rule.field === 'categoryId' ? (
                    <TextField
                      value={rule.value}
                      onChange={(event) =>
                        updateRule(index, { value: event.target.value })
                      }
                      size="small"
                      select
                      sx={{ flex: 1 }}
                    >
                      {categories.map((category) => (
                        <MenuItem key={category.$id} value={category.$id}>
                          {category.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <TextField
                      value={rule.value}
                      onChange={(event) =>
                        updateRule(index, {
                          value:
                            rule.field === 'priceUsd'
                              ? Number(event.target.value)
                              : event.target.value,
                        })
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      placeholder={rule.field === 'type' ? 'physical' : 'Value'}
                    />
                  )}
                  <Button
                    size="small"
                    color="error"
                    onClick={() => updateRule(index, null)}
                  >
                    {'✕'}
                  </Button>
                </Stack>
              ))}
              <Button
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  updateRule(collectionDraft?.rules?.length ?? 0, {})
                }
              >
                {'Add rule'}
              </Button>
            </>
          )}
          {collectionError ? (
            <Alert severity="warning">{collectionError}</Alert>
          ) : null}
          {collectionDraft ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary">
                {`Matches ${previewMatches.length} products: `}
              </Typography>
              {previewMatches.slice(0, 6).map((product) => (
                <Chip key={product.$id} label={product.name} size="small" />
              ))}
              {previewMatches.length > 6 ? (
                <Typography variant="caption" color="text.secondary">
                  {`+${previewMatches.length - 6} more`}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCollectionDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!collectionDraft?.name.trim() || Boolean(collectionError)}
            onClick={handleCollectionSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
CatalogOrganizationCard.displayName = 'CatalogOrganizationCard'

export default CatalogOrganizationCard
