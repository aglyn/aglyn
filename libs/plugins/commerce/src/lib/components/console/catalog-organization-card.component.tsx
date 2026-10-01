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
import { collection, deleteDoc, doc, setDoc } from 'firebase/firestore'
import {
  type Dispatch,
  type SetStateAction,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestoreCollection,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * How many category documents the card reads.
 *
 * A CEILING, not a page size — the walk below is a TREE and cannot be sliced
 * by document without orphaning children from parents on another page.
 */
const CATEGORY_CEILING = 250
/** The same, for collections: the slug check needs every row to be correct. */
const COLLECTION_CEILING = 250
/**
 * The catalog the match counts are computed over.
 *
 * Neither a page size nor a promise: it is how much of the catalog this card
 * is willing to read, and the counts below say "at least" once the probe finds
 * a product past it.
 */
const PRODUCT_CEILING = 500

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

const productLabel = (product: ProductRow): string => product.name
const sameProduct = (option: ProductRow, value: ProductRow): boolean =>
  option.$id === value.$id

/**
 * A manual collection's products, as chips — MEMOIZED, and every prop it
 * takes is stable while the picked products are (AGL-3423).
 *
 * A multiple Autocomplete hands its input a new chip array as
 * `startAdornment` on every render, and MUI's `InputBase` copies that into
 * its `FormControl` from a passive effect: a state update left pending after
 * every commit the field takes part in. React 19 counts each such commit as a
 * nested update, and keystrokes delivered back to back commit one after
 * another with nothing to clear the count, so the fifty-first throws
 * "Maximum update depth exceeded" (#185). The collection's name, slug and
 * rules share one draft with this list, so each keystroke in them
 * re-rendered it; kept out of those renders, it commits only when it changes.
 */
const CollectionProductsField = memo(function CollectionProductsField(props: {
  products: readonly ProductRow[]
  value: readonly ProductRow[]
  onChange(picked: ProductRow[]): void
}) {
  const { onChange } = props
  return (
    <Autocomplete
      multiple
      options={props.products as ProductRow[]}
      getOptionLabel={productLabel}
      isOptionEqualToValue={sameProduct}
      value={props.value as ProductRow[]}
      onChange={(_event, picked) => onChange(picked)}
      renderInput={(params) => (
        <TextField {...params} label="Products" size="small" />
      )}
    />
  )
})

type CategoryDraft = { id: string | null; name: string; parentId: string }
type CollectionDraft = CommerceModel.HostCollection & { id: string | null }
type WalkedCategory = CategoryRow & { depth: number }
type DraftSetter<T> = Dispatch<SetStateAction<T | null>>

/** A change to one rule, or `null` to remove it. */
type RuleChange = (
  index: number,
  patch: Partial<CommerceModel.CollectionRule> | null,
) => void

type FieldChange = { target: { value: string } }

/**
 * A text field that redraws only when what it shows changes (AGL-3423).
 *
 * Both editors keep their draft in this card, so a keystroke in either one
 * re-renders the card, and drawn whole that is both lists with a match count
 * per collection, their pagers, and every field of the dialog typed into.
 * When a keystroke costs that much, typed input queues and is processed back
 * to back, which is what lets a chip list's pending update climb to #185 (see
 * `CollectionProductsField`). The lists and each part of the dialogs are
 * memoized on what they show, and each field is this, handed a handler and
 * styles that keep their identity, so the keystroke redraws the field it
 * lands in.
 */
const MemoTextField = memo(TextField) as typeof TextField

const FIRST_FIELD = { mt: 1 } as const
const RULE_FIELD = { width: 130 } as const
const RULE_OP = { width: 110 } as const
const RULE_VALUE = { flex: 1 } as const

const MODE_MENU = [
  <MenuItem key="manual" value="manual">
    {'Manual — pick products'}
  </MenuItem>,
  <MenuItem key="smart" value="smart">
    {'Smart — rule based'}
  </MenuItem>,
]
const RULE_FIELD_MENU = RULE_FIELDS.map((field) => (
  <MenuItem key={field.value} value={field.value}>
    {field.label}
  </MenuItem>
))
const RULE_OP_MENU = RULE_OPS.map((op) => (
  <MenuItem key={op.value} value={op.value}>
    {op.label}
  </MenuItem>
))

/** The category tree, a page at a time, and the button that adds one. */
const CategoriesSection = memo(function CategoriesSection(props: {
  /** Every category, walked; the page is `visible`. */
  categories: readonly WalkedCategory[]
  visible: readonly WalkedCategory[]
  page: number
  pageSize: number
  truncated: boolean
  onPageChange(page: number): void
  onPageSizeChange(pageSize: number): void
  onEdit: DraftSetter<CategoryDraft>
  onDelete(category: CategoryRow): () => Promise<void>
}) {
  const { categories, visible, onEdit, onDelete } = props
  return (
    <>
      <Typography variant="subtitle2">{'Categories'}</Typography>
      {categories.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'Group products into a browsable tree (e.g. Brakes → Pads).'}
        </Typography>
      ) : (
        visible.map((category) => (
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
                onEdit({
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
              onClick={onDelete(category)}
            >
              {'Delete'}
            </Button>
          </Stack>
        ))
      )}
      {categories.length === 0 ? null : (
        <ListPagination
          page={props.page}
          pageSize={props.pageSize}
          rowCount={visible.length}
          // The categories the card HOLDS — a client slice of rows already
          // read, so the total is known exactly.
          count={categories.length}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
        />
      )}
      {props.truncated ? (
        <Alert severity="info">
          {`Showing ${CATEGORY_CEILING} categories, ordered by id. This ` +
            'catalog has more — a category whose parent is past that ' +
            'boundary is drawn at the top level here rather than under it.'}
        </Alert>
      ) : null}
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => onEdit({ id: null, name: '', parentId: '' })}
      >
        {'Add category'}
      </Button>
    </>
  )
})

/** The catalog collections, a page at a time, and the button that adds one. */
const CollectionsSection = memo(function CollectionsSection(props: {
  /** Every catalog collection; the page is `visible`. */
  collections: readonly CollectionRow[]
  visible: readonly CollectionRow[]
  products: readonly ProductRow[]
  /** "at least " while the catalog window is short of the catalog. */
  countPrefix: string
  page: number
  pageSize: number
  truncated: boolean
  onPageChange(page: number): void
  onPageSizeChange(pageSize: number): void
  onEdit: DraftSetter<CollectionDraft>
  onDelete(row: CollectionRow): () => Promise<void>
}) {
  const { collections, visible, products, countPrefix, onEdit, onDelete } = props
  /**
   * How many products a collection holds — over the CATALOG WINDOW.
   *
   * Rendered with "at least" when the probe found a product past the ceiling,
   * because past that point this is a lower bound and printing it as a total
   * is the count-that-is-a-window-length defect. The number itself is honest
   * either way; only the claim around it changes.
   */
  const collectionCount = (row: CollectionRow) =>
    products.filter((product) =>
      CommerceModel.matchesCollection(product, row, product.$id),
    ).length
  return (
    <>
      <Typography variant="subtitle2">{'Collections'}</Typography>
      {visible.map((row) => (
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
              {` · ${row.mode ?? 'manual'} · ${countPrefix}${collectionCount(
                row,
              )} products`}
            </Typography>
          </Typography>
          <Button
            size="small"
            onClick={() =>
              onEdit({
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
          <Button size="small" color="error" onClick={onDelete(row)}>
            {'Delete'}
          </Button>
        </Stack>
      ))}
      {collections.length === 0 ? null : (
        <ListPagination
          page={props.page}
          pageSize={props.pageSize}
          rowCount={visible.length}
          // The CATALOG collections, which is what this list is. Not the
          // window's length: content collections share the subcollection
          // and are classified out before this count is taken.
          count={collections.length}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
        />
      )}
      {props.truncated ? (
        <Alert severity="info">
          {`Showing ${COLLECTION_CEILING} collections, ordered by id. This ` +
            'site has more — the slug check below only covers the ones ' +
            'listed here, so an address may already be taken by one that ' +
            'is not.'}
        </Alert>
      ) : null}
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onEdit({
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
    </>
  )
})

/** The category editor: a name and a parent. */
const CategoryDialog = memo(function CategoryDialog(props: {
  draft: CategoryDraft | null
  /** Every category, as the parent picker offers them. */
  categories: readonly WalkedCategory[]
  setDraft: DraftSetter<CategoryDraft>
  onSave(): void
}) {
  const { draft, categories, setDraft } = props
  const draftId = draft?.id
  const close = useCallback(() => setDraft(null), [setDraft])
  const setName = useCallback(
    (event: FieldChange) =>
      setDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev)),
    [setDraft],
  )
  const setParent = useCallback(
    (event: FieldChange) =>
      setDraft((prev) =>
        prev ? { ...prev, parentId: event.target.value } : prev,
      ),
    [setDraft],
  )
  const parentMenu = useMemo(
    () => [
      <MenuItem key="" value="">
        {'None (top level)'}
      </MenuItem>,
      // The whole set, not `visibleCategories` — a parent picker that
      // offered only the current page could not reparent a category under
      // one two pages away.
      ...categories
        .filter((category) => category.$id !== draftId)
        .map((category) => (
          <MenuItem key={category.$id} value={category.$id}>
            {`${'— '.repeat(category.depth)}${category.name}`}
          </MenuItem>
        )),
    ],
    [categories, draftId],
  )
  return (
    <Dialog open={Boolean(draft)} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{draft?.id ? 'Edit category' : 'New category'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <MemoTextField
          label="Name"
          value={draft?.name ?? ''}
          onChange={setName}
          size="small"
          autoFocus
          sx={FIRST_FIELD}
        />
        <MemoTextField
          label="Parent category"
          value={draft?.parentId ?? ''}
          onChange={setParent}
          size="small"
          select
        >
          {parentMenu}
        </MemoTextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{'Cancel'}</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!draft?.name.trim()}
          onClick={props.onSave}
        >
          {'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
})

const CollectionRuleRow = memo(function CollectionRuleRow(props: {
  index: number
  rule: CommerceModel.CollectionRule
  /** The category picker's entries, for a rule on a category. */
  categoryMenu: readonly JSX.Element[]
  onChange: RuleChange
}) {
  const { index, rule, onChange } = props
  const setField = useCallback(
    (event: FieldChange) =>
      onChange(index, {
        field: event.target.value as CommerceModel.CollectionRuleField,
      }),
    [index, onChange],
  )
  const setOp = useCallback(
    (event: FieldChange) =>
      onChange(index, {
        op: event.target.value as CommerceModel.CollectionRuleOp,
      }),
    [index, onChange],
  )
  const setCategory = useCallback(
    (event: FieldChange) => onChange(index, { value: event.target.value }),
    [index, onChange],
  )
  const ruleField = rule.field
  const setValue = useCallback(
    (event: FieldChange) =>
      onChange(index, {
        value:
          ruleField === 'priceUsd'
            ? Number(event.target.value)
            : event.target.value,
      }),
    [index, onChange, ruleField],
  )
  return (
    <Stack direction="row" spacing={1}>
      <MemoTextField
        value={rule.field}
        onChange={setField}
        size="small"
        select
        sx={RULE_FIELD}
      >
        {RULE_FIELD_MENU}
      </MemoTextField>
      <MemoTextField
        value={rule.op}
        onChange={setOp}
        size="small"
        select
        sx={RULE_OP}
      >
        {RULE_OP_MENU}
      </MemoTextField>
      {rule.field === 'categoryId' ? (
        <MemoTextField
          value={rule.value}
          onChange={setCategory}
          size="small"
          select
          sx={RULE_VALUE}
        >
          {props.categoryMenu}
        </MemoTextField>
      ) : (
        <MemoTextField
          value={rule.value}
          onChange={setValue}
          size="small"
          sx={RULE_VALUE}
          placeholder={rule.field === 'type' ? 'physical' : 'Value'}
        />
      )}
      <Button size="small" color="error" onClick={() => onChange(index, null)}>
        {'✕'}
      </Button>
    </Stack>
  )
})

/** Whether every rule must hold, or any one. */
const CollectionMatchSwitch = memo(function CollectionMatchSwitch(props: {
  matchAll: boolean
  setDraft: DraftSetter<CollectionDraft>
}) {
  const { matchAll, setDraft } = props
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2">{'Match'}</Typography>
      <Switch
        size="small"
        checked={matchAll}
        onChange={(event) =>
          setDraft((prev) =>
            prev ? { ...prev, matchAll: event.target.checked } : prev,
          )
        }
      />
      <Typography variant="body2">
        {matchAll ? 'all rules' : 'any rule'}
      </Typography>
    </Stack>
  )
})

/** A smart collection's rules, whether all or any must hold, and the button that adds one. */
const CollectionRulesFields = memo(function CollectionRulesFields(props: {
  rules: readonly CommerceModel.CollectionRule[]
  matchAll: boolean
  categories: readonly WalkedCategory[]
  setDraft: DraftSetter<CollectionDraft>
  onRule: RuleChange
}) {
  const { rules, matchAll, categories, setDraft, onRule } = props
  const categoryMenu = useMemo(
    () =>
      categories.map((category) => (
        <MenuItem key={category.$id} value={category.$id}>
          {category.name}
        </MenuItem>
      )),
    [categories],
  )
  return (
    <>
      <CollectionMatchSwitch matchAll={matchAll} setDraft={setDraft} />
      {rules.map((rule, index) => (
        <CollectionRuleRow
          key={index}
          index={index}
          rule={rule}
          categoryMenu={categoryMenu}
          onChange={onRule}
        />
      ))}
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => onRule(rules.length, {})}
      >
        {'Add rule'}
      </Button>
    </>
  )
})

/** The products a draft collection holds, the first few by name. */
const CollectionPreview = memo(function CollectionPreview(props: {
  matches: readonly ProductRow[]
  countPrefix: string
}) {
  const { matches, countPrefix } = props
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary">
        {`Matches ${countPrefix}${matches.length} products: `}
      </Typography>
      {matches.slice(0, 6).map((product) => (
        <Chip key={product.$id} label={product.name} size="small" />
      ))}
      {matches.length > 6 ? (
        <Typography variant="caption" color="text.secondary">
          {`+${matches.length - 6} more`}
        </Typography>
      ) : null}
    </Stack>
  )
})

/** The collection editor: a name, a mode, and the products or rules it holds. */
const CollectionDialog = memo(function CollectionDialog(props: {
  draft: CollectionDraft | null
  /** The address the draft will be saved at. */
  slug: string
  slugTaken: boolean
  error: string | null
  products: readonly ProductRow[]
  /** The draft's manual products, as rows. */
  picked: readonly ProductRow[]
  categories: readonly WalkedCategory[]
  matches: readonly ProductRow[]
  countPrefix: string
  setDraft: DraftSetter<CollectionDraft>
  onProducts(picked: ProductRow[]): void
  onRule: RuleChange
  onSave(): void
}) {
  const { draft, error, setDraft } = props
  const close = useCallback(() => setDraft(null), [setDraft])
  const setName = useCallback(
    (event: FieldChange) =>
      setDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev)),
    [setDraft],
  )
  const setMode = useCallback(
    (event: FieldChange) =>
      setDraft((prev) =>
        prev
          ? { ...prev, mode: event.target.value as 'manual' | 'smart' }
          : prev,
      ),
    [setDraft],
  )
  return (
    <Dialog open={Boolean(draft)} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{draft?.id ? 'Edit collection' : 'New collection'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <MemoTextField
          label="Name"
          value={draft?.name ?? ''}
          onChange={setName}
          size="small"
          autoFocus
          sx={FIRST_FIELD}
          error={props.slugTaken}
          helperText={draft?.name ? `/collections/${props.slug}` : undefined}
        />
        <MemoTextField
          label="Mode"
          value={draft?.mode ?? 'manual'}
          onChange={setMode}
          size="small"
          select
        >
          {MODE_MENU}
        </MemoTextField>
        {draft?.mode === 'manual' ? (
          <CollectionProductsField
            products={props.products}
            value={props.picked}
            onChange={props.onProducts}
          />
        ) : (
          <CollectionRulesFields
            rules={draft?.rules ?? NO_RULES}
            matchAll={draft?.matchAll !== false}
            categories={props.categories}
            setDraft={setDraft}
            onRule={props.onRule}
          />
        )}
        {error ? <Alert severity="warning">{error}</Alert> : null}
        {draft ? (
          <CollectionPreview matches={props.matches} countPrefix={props.countPrefix} />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{'Cancel'}</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!draft?.name.trim() || Boolean(error)}
          onClick={props.onSave}
        >
          {'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
})

/** A collection with no rules yet, the same list on every render. */
const NO_RULES: readonly CommerceModel.CollectionRule[] = []

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

  const {
    data: categoryDocs,
    status: categoriesStatus,
    /**
     * The category rows are unconfirmed by the server (AGL-1358). Two writes
     * are seeded from them: the editor carries `parentId` off the row whether
     * or not the author touched it, and the delete REPARENTS every child of
     * the deleted category — a set computed entirely from this cached read,
     * so a stale snapshot can miss children that should have been moved.
     * (The reparent write itself is narrow since AGL-1374; what remains
     * cache-dependent is WHICH rows it runs on.)
     */
    fromCache: categoriesFromCache,
  } = useFirestoreCollection<any>(
    /*
     * ORDERED AND CEILINGED, deliberately not paged by the query (AGL-2501).
     *
     * `limit(250)` alone is answered in DOCUMENT-ID order and the ids are
     * `createResourceUid()`, so the window was a pseudo-random sample. Naming
     * the order does not change WHICH 250 come back; what it changes is that
     * the obvious next edit is caught — `orderBy('name')` would HIDE every
     * category saved without one, and `orderBy('order')` is worse still, since
     * the walk below already treats a missing `order` as 0.
     *
     * The QUERY is not paged because this is a TREE. The walk puts parents
     * before children and collects orphans by scanning the whole set, so a
     * page boundary would separate a child from the parent that positions it
     * and re-label as an orphan every category whose parent is on another
     * page. The parent PICKER in the dialog reads the same rows for the same
     * reason.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'productCategories'),
        CATEGORY_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readCategories, truncated: categoriesTruncated } =
    ceilingedWindow<any>(categoryDocs, CATEGORY_CEILING)
  const {
    data: collectionDocs,
    status: collectionsStatus,
    /**
     * The collection rows are unconfirmed by the server (AGL-1358). The
     * editor copies a whole stored row and the save posts all of it — the
     * transport is the AGL-978 route rather than a client `setDoc`, but the
     * shape is identical, and so is the damage: `productIds` is the manual
     * membership, so a cached seed drops every product added since that
     * snapshot and the storefront blocks pointing at the collection go empty.
     */
    fromCache: collectionsFromCache,
  } = useFirestoreCollection<any>(
    /*
     * ORDERED AND CEILINGED, deliberately not paged (AGL-2501).
     *
     * The slug check below tests a draft against these rows — two catalog
     * collections answering `/collections/{slug}` is a storefront route that
     * resolves to whichever the server reaches first — so a ten-row server
     * page would compare a new collection against a tenth of the catalog and
     * create the collision the check exists to prevent.
     *
     * The rows are also filtered after reading: content collections (AGL-81)
     * share this subcollection and are classified out below, so a page of ten
     * documents arrives holding anywhere from zero to ten catalog collections.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'collections'),
        COLLECTION_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readCollections, truncated: collectionsTruncated } =
    ceilingedWindow<any>(collectionDocs, COLLECTION_CEILING)
  const { data: productDocs } = useFirestoreCollection<any>(
    /*
     * The catalog behind the MATCH COUNTS, ceilinged with a probe (AGL-2501).
     *
     * `collectionCount` and the smart-collection preview both count this array
     * and print the result as a number of products. It was a bare `limit(500)`,
     * so on a three-thousand-product catalog "Matches 47 products" meant "47 of
     * the five hundred I read" — a count that is a window length, on the
     * control that decides what a collection contains.
     *
     * It stays a window, because the honest alternative is reading the whole
     * catalog on every mount of this card. What changes is that the probe makes
     * the shortfall a FACT, and the counts say "at least" when it bit rather
     * than stating a total they cannot know.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'products'),
        PRODUCT_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readProducts, truncated: productsTruncated } =
    ceilingedWindow<any>(productDocs, PRODUCT_CEILING)
  const products: ProductRow[] = useMemo(
    () =>
      [...readProducts]
        .filter((product: any) => !product.deletedAt)
        .map((product: any) => ({
          ...CommerceModel.liftLegacyProduct(product),
          $id: product.$id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productDocs],
  )
  // Content collections (AGL-81) live in the same `hosts/{hostId}/collections`
  // subcollection. This used to keep them out by requiring a non-empty
  // `name`, which held only because the Content page happens to write
  // `displayName` — a content doc that ever acquired a `name` (an import, a
  // hand edit) would land in this list, and its Delete reached the
  // recursiveDelete route (AGL-947). The shared classifier is the real
  // check (AGL-954); the route re-checks it, and AGL-1324 now refuses any
  // collection with entries besides.
  const commerceCollections: CollectionRow[] = useMemo(
    () => readCollections.filter(Aglyn.isHostCollectionKind('catalog')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collectionDocs],
  )

  // Categories ordered as a walked tree: parents before children.
  const categories: Array<CategoryRow & { depth: number }> = useMemo(() => {
    const rows = [...readCategories] as CategoryRow[]
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryDocs])

  /*
   * Both pages are SLICES: the rows are already in hand, and the tree walk,
   * the parent picker and the slug check all need every one of them.
   */
  const [categoryPage, setCategoryPage] = useState(0)
  const [categoryPageSize, setCategoryPageSize] = useState(
    TABLE_PAGE_SIZE_DEFAULT,
  )
  const visibleCategories = useMemo(
    () =>
      categories.slice(
        categoryPage * categoryPageSize,
        categoryPage * categoryPageSize + categoryPageSize,
      ),
    [categories, categoryPage, categoryPageSize],
  )
  const [collectionPage, setCollectionPage] = useState(0)
  const [collectionPageSize, setCollectionPageSize] = useState(
    TABLE_PAGE_SIZE_DEFAULT,
  )
  const visibleCollections = useMemo(
    () =>
      commerceCollections.slice(
        collectionPage * collectionPageSize,
        collectionPage * collectionPageSize + collectionPageSize,
      ),
    [commerceCollections, collectionPage, collectionPageSize],
  )

  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft | null>(
    null,
  )

  const handleCategorySave = useCallback(async () => {
    if (!categoryDraft?.name.trim()) return
    const id = categoryDraft.id ?? Aglyn.createResourceUid()
    /**
     * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
     *
     * The payload is narrower than most sites in this issue, but `parentId`
     * is carried off the seeded row on every save whether or not the author
     * opened the parent picker — so renaming a category against a cached read
     * can move it, and the whole subtree under it, back to a parent someone
     * had already reorganised away from.
     *
     * Only the edit path. A NEW category is built from blanks at a fresh uid
     * and can overwrite nothing, and the first snapshot of any listener is
     * `fromCache: true`, so guarding a create would refuse a save that was
     * never unsafe.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'category',
        unreadable: Boolean(categoryDraft.id) && categoriesStatus === 'error',
        fromCache: Boolean(categoryDraft.id) && categoriesFromCache,
      },
      async () => {
        /**
         * `merge: true`, because this payload is NARROWER than the document
         * (AGL-1372). A replacing write deletes every stored key the form
         * does not send, and this form sends four:
         *
         * - `order` — the tree position. Both sorts read it (the walk above,
         *   and `queryPublicCatalog`'s facet chips), and nothing in this card
         *   can set it, so it is not the form's to send: a rename dropped it
         *   and the category fell back to `?? 0`, reordering the storefront's
         *   filter chips.
         * - `createdAt` — written at creation by the seeder, never by this
         *   card, so a rename erased it too.
         *
         * Carrying `order` in the payload would have fixed the field we
         * happened to notice and left `createdAt`, plus whatever the document
         * grows next. Merging fixes the shape. Nothing here needs delete
         * semantics — `parentId` clears to an explicit `null`, which merges.
         */
        await setDoc(
          doc(firestore, 'hosts', hostId, 'productCategories', id),
          {
            name: categoryDraft.name.trim().slice(0, 80),
            slug: CommerceModel.commerceSlug(categoryDraft.name),
            parentId: categoryDraft.parentId || null,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
      },
    )
    // Before `setCategoryDraft(null)`, so a refusal keeps the dialog open
    // with what was typed.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setCategoryDraft(null)
    enqueueSnackbar('Category saved', { variant: 'success', persist: false })
  }, [
    categoryDraft,
    firestore,
    hostId,
    enqueueSnackbar,
    categoriesStatus,
    categoriesFromCache,
  ])

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
      /**
       * Refuse the whole sequence when the rows it reads were never confirmed
       * by the server (AGL-1358).
       *
       * The reparent is this issue's shape at its least visible: the author
       * opened no editor, so there is nothing on screen to look stale, and
       * `children` is read straight out of the cache. The write itself is
       * now narrow (see below), so a stale row can no longer be copied back
       * over a child — but WHICH rows are children is still a cached answer.
       *
       * The guard encloses the DELETE as well, for the reason the site
       * details rename did: `children` is computed from the same seed, so a
       * cached read can miss children entirely, and deleting the parent
       * without reparenting them leaves them pointing at a category that no
       * longer exists. Half of this sequence is worse than none of it.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'categories',
          unreadable: categoriesStatus === 'error',
          fromCache: categoriesFromCache,
        },
        async () => {
          // Reparent children to root, then remove.
          const children = (categoryDocs ?? []).filter(
            (row: any) => row.parentId === category.$id,
          )
          /**
           * Write only the field the reparent changes (AGL-1374).
           *
           * `{...child}` spread the listener row, and that row carries a
           * SYNTHETIC `$id` — `idField: '$id'` stamps the document id onto
           * the in-memory object, where nothing persists it. Spreading it
           * into the payload persisted it: every delete-with-children added
           * a real `$id` key to each child, permanently, and a child
           * reparented twice could end up carrying one that no longer
           * matched its own document id. Nothing reads it, so nothing broke
           * — it is the listener's bookkeeping leaking into storage, and
           * once there no reader can tell it from a real field.
           *
           * `{ parentId: null }` with `{ merge: true }` is what the reparent
           * actually means, and it is the stronger fix than stripping `$id`
           * off a full spread: the old write had no options argument, so it
           * was also a whole-document REPLACE of a cached row — the AGL-1358
           * hazard in miniature (and AGL-1372's, one collection over). A
           * narrow merge cannot carry a synthetic key it never names, and
           * cannot rewrite a field the delete has no business touching.
           *
           * `null` is a value, not a deletion, so it merges: the child ends
           * up at the top level, which is what the confirmation promised.
           */
          for (const child of children) {
            await setDoc(
              doc(firestore, 'hosts', hostId, 'productCategories', child.$id),
              { parentId: null },
              { merge: true },
            )
          }
          await deleteDoc(
            doc(firestore, 'hosts', hostId, 'productCategories', category.$id),
          )
        },
      )
      // This path had no report of its own. A delete that silently does
      // nothing after the user confirmed it reads as a delete that worked.
      if (!verdict.ok) {
        enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
    },
    [
      confirm,
      categoryDocs,
      firestore,
      hostId,
      enqueueSnackbar,
      categoriesStatus,
      categoriesFromCache,
    ],
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

  const collectionProductIds = collectionDraft?.productIds
  const collectionProducts = useMemo(
    () =>
      products.filter((product) =>
        (collectionProductIds ?? []).includes(product.$id),
      ),
    [products, collectionProductIds],
  )
  const setCollectionProducts = useCallback(
    (picked: ProductRow[]) =>
      setCollectionDraft((prev) =>
        prev ? { ...prev, productIds: picked.map((item) => item.$id) } : prev,
      ),
    [],
  )

  /*
   * Recomputed when what decides membership changes — the mode, the picked
   * products, the rules and whether all must hold — and not on a keystroke in
   * the name, which no match reads (AGL-3423).
   */
  const draftMode = collectionDraft?.mode
  const draftRules = collectionDraft?.rules
  const draftMatchAll = collectionDraft?.matchAll
  const previewMatches = useMemo(() => {
    if (!draftMode) return []
    const candidate = {
      mode: draftMode,
      productIds: collectionProductIds,
      rules: draftRules,
      matchAll: draftMatchAll,
    } as CommerceModel.HostCollection
    return products.filter((product) =>
      CommerceModel.matchesCollection(product, candidate, product.$id),
    )
  }, [draftMode, collectionProductIds, draftRules, draftMatchAll, products])

  /**
   * Which products a smart collection holds is stored on the products
   * (`collectionIds`, AGL-3321), so a save or a delete re-stamps them —
   * bounded passes through the commerce route until it says it is done.
   * A failure is reported, not thrown: the collection itself saved.
   */
  const restampMembership = useCallback(
    async (collectionId: string) => {
      try {
        let after: string | undefined
        for (let pass = 0; pass < 100; pass += 1) {
          const response = await authorizedFetch(
            user,
            '/api/commerce/collection-membership',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hostId, collectionId, ...(after ? { after } : {}) }),
            },
          )
          const result = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(result?.error ?? 'Membership update failed')
          if (result.done || !result.after) return
          after = result.after
        }
      } catch (error: any) {
        enqueueSnackbar(
          `${error?.message ?? 'Membership update failed'} — the storefront may list this collection's old products until it is saved again.`,
          { variant: 'warning' },
        )
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleCollectionSave = useCallback(async () => {
    if (!collectionDraft?.name.trim() || collectionError) return
    const { id: draftId, ...data } = collectionDraft
    // Both create and rename go through the route (AGL-978): this save writes
    // the whole document including `slug`, which is the collection's public
    // address and is claimed transactionally there. Rules deny a client
    // create, and freeze `slug`/`kind` on update.
    /**
     * Refuse an UPDATE whose seed the server never confirmed (AGL-1358).
     *
     * The transport is the route rather than a client `setDoc`, but the shape
     * is the one this issue is about: `data` is the whole stored row copied
     * out of the listener, and the route writes what it is sent. `productIds`
     * is the manual membership, so a cached seed drops every product added
     * since that snapshot and the storefront blocks pointing at the
     * collection go empty; `rules` and `matchAll` do the same for a smart
     * collection. That the write leaves the browser over HTTP changes who
     * performs it, not what it destroys.
     *
     * Only the update path. A CREATE is built from blanks, and the route
     * claims a fresh slug transactionally, so it can overwrite nothing.
     *
     * The guard WRAPS the request — an early return is a shape you can keep
     * while losing the protection.
     */
    let verdict: Awaited<ReturnType<typeof writeGuardedBySeed>>
    let savedId = ''
    try {
      verdict = await writeGuardedBySeed(
        {
          subject: 'collection',
          unreadable: Boolean(draftId) && collectionsStatus === 'error',
          fromCache: Boolean(draftId) && collectionsFromCache,
        },
        async () => {
          const response = await authorizedFetch(
            user,
            '/api/hosts/collections',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
            },
          )
          const result = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(result?.error ?? 'Collection save failed')
          }
          savedId = String(draftId ?? result?.id ?? '')
        },
      )
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Collection save failed', {
        variant: 'error',
      })
    }
    // Before `setCollectionDraft(null)`, so a refusal keeps the dialog open
    // with the membership that was picked.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setCollectionDraft(null)
    enqueueSnackbar('Collection saved', { variant: 'success', persist: false })
    if (savedId) await restampMembership(savedId)
  }, [
    restampMembership,
    collectionDraft,
    collectionError,
    draftSlug,
    user,
    hostId,
    enqueueSnackbar,
    collectionsStatus,
    collectionsFromCache,
  ])

  const handleCollectionDelete = useCallback(
    (row: CollectionRow) => async () => {
      const confirmed = await confirm({
        title: 'Delete this collection?',
        // NOT a cascade any more (AGL-1324/AGL-1336): the route REFUSES a
        // collection anything still depends on. Promising to take the
        // entries with it was the opposite of what happens, and the two
        // blockers are the whole point of the feature — say them before the
        // button is armed, not in a 409 afterwards.
        description:
          `Storefront blocks pointing at "${row.name}" go empty. The delete ` +
          'is refused while the collection still has entries, or while a ' +
          'page uses it as a list or entry template — empty it and detach ' +
          'those pages first. It also takes the site admin role.',
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
      // Admin-SDK-only, hence the route (AGL-947). Since AGL-1324 the route
      // also refuses rather than cascading; the 409's message names the
      // blockers and is surfaced by the catch below.
      try {
        const response = await authorizedFetch(user, '/api/resources/erase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      await restampMembership(row.$id)
    },
    [confirm, user, hostId, enqueueSnackbar, restampMembership],
  )

  /*
   * "at least", or nothing at all.
   *
   * Every count on this card is computed over `products`, which is the catalog
   * WINDOW rather than the catalog. While the probe finds a product past the
   * ceiling those counts are lower bounds, and printing one as a total is the
   * count-that-is-a-window-length defect this ceiling exists to make visible.
   *
   * Keyed on the probe rather than on `products.length >= PRODUCT_CEILING`,
   * because a catalog of exactly the ceiling is complete: nothing is missing,
   * and a comparison would put "at least" on a number that is exact.
   */
  const countPrefix = productsTruncated ? 'at least ' : ''

  /*
   * A rule's change, written over the collection draft as last rendered, from
   * a handler that keeps its identity so a rule row redraws only when its own
   * rule changes (AGL-3423).
   */
  const latestCollectionDraft = useRef(collectionDraft)
  latestCollectionDraft.current = collectionDraft
  const updateRule = useCallback<RuleChange>((index, patch) => {
    const draft = latestCollectionDraft.current
    if (!draft) return
    const rules = [...(draft.rules ?? [])]
    if (patch === null) rules.splice(index, 1)
    else
      rules[index] = {
        field: 'tag',
        op: 'eq',
        value: '',
        ...rules[index],
        ...patch,
      }
    setCollectionDraft({ ...draft, rules })
  }, [])

  return (
    <CardDisplay
      header={'Categories & collections'}
      help={pluginDocsHelp('catalog', { anchor: '#categories-and-tags' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <CategoriesSection
          categories={categories}
          visible={visibleCategories}
          page={categoryPage}
          pageSize={categoryPageSize}
          truncated={categoriesTruncated}
          onPageChange={setCategoryPage}
          onPageSizeChange={setCategoryPageSize}
          onEdit={setCategoryDraft}
          onDelete={handleCategoryDelete}
        />

        <Divider sx={{ my: 1 }} />
        <CollectionsSection
          collections={commerceCollections}
          visible={visibleCollections}
          products={products}
          countPrefix={countPrefix}
          page={collectionPage}
          pageSize={collectionPageSize}
          truncated={collectionsTruncated}
          onPageChange={setCollectionPage}
          onPageSizeChange={setCollectionPageSize}
          onEdit={setCollectionDraft}
          onDelete={handleCollectionDelete}
        />
      </Stack>

      <CategoryDialog
        draft={categoryDraft}
        categories={categories}
        setDraft={setCategoryDraft}
        onSave={handleCategorySave}
      />

      <CollectionDialog
        draft={collectionDraft}
        slug={draftSlug}
        slugTaken={slugTaken}
        error={collectionError}
        products={products}
        picked={collectionProducts}
        categories={categories}
        matches={previewMatches}
        countPrefix={countPrefix}
        setDraft={setCollectionDraft}
        onProducts={setCollectionProducts}
        onRule={updateRule}
        onSave={handleCollectionSave}
      />
    </CardDisplay>
  )
}
CatalogOrganizationCard.displayName = 'CatalogOrganizationCard'

export default CatalogOrganizationCard
