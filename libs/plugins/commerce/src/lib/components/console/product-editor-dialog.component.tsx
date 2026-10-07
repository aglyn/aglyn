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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, getDoc } from 'firebase/firestore'
import { ScanAdornment } from '../../barcode/scan-button.component'
import { productCollectionFields } from './smart-collections'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  writeGuardedBySeed,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import { type PickedMedia, useMediaPicker } from '@aglyn/aglyn'
import {
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import {
  seoListingFieldCount,
  seoListingFieldTooLong,
  type SeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { ConsoleSeoFieldValues } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useContentStable } from '@aglyn/shared-ui-jsx/hooks/use-content-stable'
import {
  EntitlementUpsell,
  useCommerceEntitlement,
} from './entitlement-gate.component'
import {
  PRODUCT_EDITOR_ZONE,
  type ConsoleProductCopyValues,
  type ConsoleProductEditorZoneProps,
} from './product-zones'
import {
  type MembersVideo,
  MembersVideosField,
  PaidDownloadAddButton,
  PaidMediaProtection,
} from './paid-media'
import { ProductRegisterFields } from './product-register-fields.component'

/**
 * What each picker in this dialog will offer.
 *
 * Every one is a chooser rather than a list, so the ceiling is the number of
 * options a reader can meaningfully scan, and the walk that reaches it is
 * ordered by document name — a picker that silently omits an option is worse
 * than one that admits it stops, because the omission looks like the option
 * not existing.
 */
const CATEGORY_CEILING = 250
const RELATED_PRODUCT_CEILING = 300
const SUPPLIER_CEILING = 50

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

/**
 * The search listing fields this editor holds (AGL-2910): `product.seo`
 * carries a title and a description beside its share image, and nothing
 * else a listing zone may propose.
 */
const PRODUCT_SEO_LISTING_FIELDS: readonly Extract<SeoListingFieldKey, 'title' | 'description'>[] = [
  'title',
  'description',
]

/** A product nobody has saved yet, as the editor starts one. */
function blankProduct(): CommerceModel.HostProduct {
  return {
    name: '',
    slug: '',
    type: 'physical',
    status: 'draft',
    variants: [{ id: 'default', priceUsd: 0 }],
  }
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


/** Stand-in for a list the product does not hold yet, the same one each render. */
const NO_ITEMS: readonly string[] = []
const NO_OPTIONS: readonly CommerceModel.ProductOption[] = []
const NO_FILES: readonly DigitalFile[] = []
const NO_VIDEOS: readonly MembersVideo[] = []
const FILL_ROW = { flex: 1 } as const

const categoryLabel = (category: any): string => category.name
const recordLabel = (item: any): string => item.name ?? item.$id
const sameRecord = (option: any, value: any): boolean => option.$id === value.$id

interface ProductChipsFieldProps<T> {
  label: string
  options: readonly T[]
  value: readonly T[]
  /** `index` is the prop of the same name, handed back for a per-row field. */
  onChange(next: T[], index: number): void
  index?: number
  freeSolo?: boolean
  getOptionLabel?: (option: T) => string
  isOptionEqualToValue?: (option: T, value: T) => boolean
  placeholder?: string
  helperText?: string
  fill?: boolean
}

/**
 * One of the editor's chip lists — tags, categories, an option's values,
 * related products — MEMOIZED, and every prop it takes is stable while its
 * own list is (AGL-3423).
 *
 * A multiple Autocomplete hands its input a new chip array as
 * `startAdornment` on every render, and MUI's `InputBase` copies that into
 * its `FormControl` from a passive effect: a state update left pending after
 * every commit the field takes part in. React 19 counts each such commit as a
 * nested update, and keystrokes delivered back to back commit one after
 * another with nothing to clear the count, so the fifty-first throws
 * "Maximum update depth exceeded" (#185). Every field in this editor writes
 * one draft, so every keystroke in any of them re-rendered all four lists;
 * kept out of those renders, a list commits only when it changes.
 */
const ProductChipsField = memo(function ProductChipsField<T>(
  props: ProductChipsFieldProps<T>,
) {
  const { index = 0, onChange } = props
  return (
    <Autocomplete<T, true, false, boolean>
      multiple
      freeSolo={props.freeSolo}
      options={props.options as T[]}
      value={props.value as T[]}
      getOptionLabel={props.getOptionLabel as (option: T | string) => string}
      isOptionEqualToValue={props.isOptionEqualToValue}
      onChange={(_event, next) => onChange(next as T[], index)}
      renderInput={(params) => (
        <TextField
          {...params}
          label={props.label}
          size="small"
          placeholder={props.placeholder}
          helperText={props.helperText}
        />
      )}
      sx={props.fill ? FILL_ROW : undefined}
    />
  )
}) as <T>(props: ProductChipsFieldProps<T>) => JSX.Element

type DigitalFile = NonNullable<CommerceModel.HostProduct['digitalFiles']>[number]

/** A change to the product, or a function of the product as it stands. */
type ProductPatch =
  | Partial<CommerceModel.HostProduct>
  | ((product: CommerceModel.HostProduct) => Partial<CommerceModel.HostProduct>)

/** Spreads a patch over the draft as last rendered. One identity per dialog. */
type ProductUpdate = (patch: ProductPatch) => void

/** A stable empty list, so a product without modifiers never redraws its section. */
const NO_MODIFIER_GROUPS: CommerceModel.ProductModifierGroup[] = []

/** Replaces the draft with what `build` makes of it as last rendered. */
type DraftReplace = (
  build: (product: CommerceModel.HostProduct) => CommerceModel.HostProduct,
) => void

/** Opens the media browser and hands what was chosen to `apply`. */
type MediaPick = (apply: (media: PickedMedia) => void) => Promise<void>

/** A change to one option, or `null` to remove it. */
type OptionChange = (
  index: number,
  patch: Partial<CommerceModel.ProductOption> | null,
) => void

/** What was typed into one variant's field, as the matrix hands it on. */
type VariantFieldChange = (
  index: number,
  field: keyof CommerceModel.ProductVariant,
  raw: string,
) => void

type FieldChange = { target: { value: string } }

/**
 * A text field that redraws only when what it shows changes (AGL-3423).
 *
 * Every field in this editor writes one draft, so a keystroke in any of them
 * re-renders the dialog, and drawn whole that is some forty inputs and twelve
 * hundred components for one letter in a product with four variants. When a
 * keystroke costs that much, typed input queues and is processed back to
 * back, which is what lets a chip list's pending update climb to #185 (see
 * `ProductChipsField`). The sections below are memoized on the slice of the
 * draft they show, and each field in them is this, handed a handler and
 * styles that keep their identity, so the keystroke redraws the field it
 * lands in.
 */
const MemoTextField = memo(TextField) as typeof TextField

const FIRST_ROW = { mt: 1 } as const
const WIDE_ROW = { xs: 'column', sm: 'row' } as const
const NARROW_SELECT = { minWidth: 140 } as const
const SUPPLIER_SELECT = { minWidth: 160 } as const
const OVERSELL_SELECT = { minWidth: 200 } as const
const KIND_SELECT = { minWidth: 130 } as const
const SHORT_SELECT = { minWidth: 120 } as const
const BILLING_SELECT = { minWidth: 180 } as const
const COUNT_FIELD = { width: 140 } as const
const VERSION_FIELD = { width: 100 } as const
const OPTION_FIELD = { width: 160 } as const
const PRICE_CELL = { width: 88 } as const
const CODE_CELL = { width: 110 } as const
const BARCODE_CELL = { width: 150 } as const
const STOCK_CELL = { width: 72 } as const
const DECIMAL_INPUT = { htmlInput: { inputMode: 'decimal' } } as const
const NUMERIC_INPUT = { htmlInput: { inputMode: 'numeric' } } as const

const TYPE_MENU = [
  <MenuItem key="physical" value="physical">{'Physical'}</MenuItem>,
  <MenuItem key="digital" value="digital">{'Digital'}</MenuItem>,
  <MenuItem key="service" value="service">{'Service'}</MenuItem>,
]
const STATUS_MENU = [
  <MenuItem key="draft" value="draft">{'Draft'}</MenuItem>,
  <MenuItem key="active" value="active">{'Active'}</MenuItem>,
  <MenuItem key="archived" value="archived">{'Archived'}</MenuItem>,
]
const OVERSELL_MENU = [
  <MenuItem key="deny" value="deny">{'Stop selling (sold out)'}</MenuItem>,
  <MenuItem key="backorder" value="backorder">{'Keep selling (backorder)'}</MenuItem>,
]
const TAX_MENU = [
  <MenuItem key="taxable" value="taxable">{'Taxable'}</MenuItem>,
  <MenuItem key="exempt" value="exempt">{'Tax exempt'}</MenuItem>,
]
const INTERVAL_MENU = [
  <MenuItem key="month" value="month">{'Monthly'}</MenuItem>,
  <MenuItem key="year" value="year">{'Yearly'}</MenuItem>,
]

/**
 * A zone hosted in the dialog, drawn again only when what it is handed
 * changes (AGL-3423). The shell's renderer is not memoized: drawn straight
 * into the dialog, every widget in the zone would redraw on each keystroke in
 * any field.
 */
const HostedZone = memo(function HostedZone(
  props: { renderer: ConsoleWidgetSlotRenderer; slot: string } & Record<string, unknown>,
) {
  const { renderer: Renderer, ...zone } = props
  return <Renderer {...zone} />
})

interface ProductBasicsFieldsProps {
  name: string
  slug: string
  type: CommerceModel.ProductType
  status: CommerceModel.ProductStatus
  supplierId: string | undefined
  description: string
  suppliers: readonly any[]
  onName(event: FieldChange): void
  onSlug(event: FieldChange): void
  update: ProductUpdate
}

/** The product's name and address, type, status, supplier and description. */
const ProductBasicsFields = memo(function ProductBasicsFields(
  props: ProductBasicsFieldsProps,
) {
  const { suppliers, update } = props
  const setType = useCallback(
    (event: FieldChange) =>
      update({ type: event.target.value as CommerceModel.ProductType }),
    [update],
  )
  const setStatus = useCallback(
    (event: FieldChange) =>
      update({ status: event.target.value as CommerceModel.ProductStatus }),
    [update],
  )
  const setSupplier = useCallback(
    (event: FieldChange) => update({ supplierId: event.target.value || undefined }),
    [update],
  )
  const setDescription = useCallback(
    (event: FieldChange) => update({ description: event.target.value }),
    [update],
  )
  const supplierMenu = useMemo(
    () => [
      <MenuItem key="" value="">
        {'None (self-fulfilled)'}
      </MenuItem>,
      ...suppliers.map((supplier: any) => (
        <MenuItem key={supplier.$id} value={supplier.$id}>
          {supplier.name}
        </MenuItem>
      )),
    ],
    [suppliers],
  )
  return (
    <>
      <Stack direction={WIDE_ROW} spacing={2} sx={FIRST_ROW}>
        <MemoTextField
          label="Name"
          value={props.name}
          onChange={props.onName}
          size="small"
          autoFocus
          fullWidth
        />
        <MemoTextField
          label="Slug"
          value={props.slug}
          onChange={props.onSlug}
          size="small"
          fullWidth
          helperText={props.slug ? `/products/${props.slug}` : undefined}
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        <MemoTextField
          label="Type"
          value={props.type}
          onChange={setType}
          size="small"
          select
          sx={NARROW_SELECT}
        >
          {TYPE_MENU}
        </MemoTextField>
        <MemoTextField
          label="Status"
          value={props.status}
          onChange={setStatus}
          size="small"
          select
          sx={NARROW_SELECT}
        >
          {STATUS_MENU}
        </MemoTextField>
        {suppliers.length > 0 ? (
          <MemoTextField
            label="Supplier"
            value={props.supplierId ?? ''}
            onChange={setSupplier}
            size="small"
            select
            sx={SUPPLIER_SELECT}
            helperText="Routes paid orders"
          >
            {supplierMenu}
          </MemoTextField>
        ) : null}
      </Stack>
      <MemoTextField
        label="Description"
        value={props.description}
        onChange={setDescription}
        size="small"
        multiline
        minRows={2}
      />
    </>
  )
})

/** The product's images, each removable, and the button that adds one. */
const ProductMediaFields = memo(function ProductMediaFields(props: {
  mediaUrls: readonly string[]
  update: ProductUpdate
  pick: MediaPick
}) {
  const { mediaUrls, update, pick } = props
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {mediaUrls.map((url, index) => (
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
              update((product) => ({
                mediaUrls: (product.mediaUrls ?? []).filter(
                  (_item, itemIndex) => itemIndex !== index,
                ),
              }))
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
            update((product) => ({
              mediaUrls: [...(product.mediaUrls ?? []), media.url],
            })),
          )
        }
      >
        {'Add image'}
      </Button>
    </Box>
  )
})

const ProductOptionRow = memo(function ProductOptionRow(props: {
  index: number
  option: CommerceModel.ProductOption
  onChange: OptionChange
  onValues(values: string[], index: number): void
}) {
  const { index, option, onChange, onValues } = props
  const setName = useCallback(
    (event: FieldChange) => onChange(index, { name: event.target.value }),
    [index, onChange],
  )
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <MemoTextField
        label="Option"
        value={option.name}
        onChange={setName}
        size="small"
        sx={OPTION_FIELD}
        placeholder="Size"
      />
      <ProductChipsField<string>
        freeSolo
        fill
        label="Values"
        placeholder="S, M, L…"
        options={NO_ITEMS}
        value={option.values}
        index={index}
        onChange={onValues}
      />
      <Button
        size="small"
        color="error"
        onClick={() => onChange(index, null)}
        sx={{ mt: 0.5 }}
      >
        {'Remove'}
      </Button>
    </Stack>
  )
})

/** The product's options, one row each, and the button that adds one. */
const ProductOptionsFields = memo(function ProductOptionsFields(props: {
  options: readonly CommerceModel.ProductOption[]
  onChange: OptionChange
  onValues(values: string[], index: number): void
}) {
  const { options, onChange, onValues } = props
  return (
    <>
      {options.map((option, index) => (
        <ProductOptionRow
          key={index}
          index={index}
          option={option}
          onChange={onChange}
          onValues={onValues}
        />
      ))}
      {options.length < CommerceModel.COMMERCE_MAX_OPTIONS ? (
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => onChange(options.length, { name: '', values: [] })}
        >
          {'Add option'}
        </Button>
      ) : null}
    </>
  )
})

const ProductVariantRow = memo(function ProductVariantRow(props: {
  index: number
  variant: CommerceModel.ProductVariant
  stockApplies: boolean
  onField: VariantFieldChange
}) {
  const { index, variant, stockApplies, onField } = props
  const label = comboLabel(variant.options)
  // One handler per cell, each keeping its identity while the row's does.
  const set = useMemo(() => {
    const cell =
      (field: keyof CommerceModel.ProductVariant) => (event: FieldChange) =>
        onField(index, field, event.target.value)
    return {
      priceUsd: cell('priceUsd'),
      compareAtPriceUsd: cell('compareAtPriceUsd'),
      sku: cell('sku'),
      barcode: cell('barcode'),
      inventory: cell('inventory'),
      weightGrams: cell('weightGrams'),
    }
  }, [index, onField])
  const stockInput = useMemo(
    () => ({
      htmlInput: {
        inputMode: 'numeric' as const,
        'aria-label': `Stock — ${label}`,
      },
    }),
    [label],
  )
  // A camera scan fills the barcode the same way typing it does (AGL-3619).
  const barcodeInput = useMemo(
    () => ({
      htmlInput: { 'aria-label': `Barcode — ${label}` },
      input: {
        endAdornment: (
          <ScanAdornment
            label={`Scan the barcode for ${label}`}
            onScan={(code) => onField(index, 'barcode', code)}
          />
        ),
      },
    }),
    [label, index, onField],
  )
  return (
    <TableRow>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{label}</TableCell>
      <TableCell>
        <MemoTextField
          value={variant.priceUsd ?? ''}
          onChange={set.priceUsd}
          size="small"
          sx={PRICE_CELL}
          // An empty price is marked (AGL-2916): a proposed
          // product arrives with none, and Save waits for one.
          error={!CommerceModel.variantHasPrice(variant)}
          placeholder="Set"
          slotProps={DECIMAL_INPUT}
        />
      </TableCell>
      <TableCell>
        <MemoTextField
          value={variant.compareAtPriceUsd ?? ''}
          onChange={set.compareAtPriceUsd}
          size="small"
          sx={PRICE_CELL}
          slotProps={DECIMAL_INPUT}
        />
      </TableCell>
      <TableCell>
        <MemoTextField
          value={variant.sku ?? ''}
          onChange={set.sku}
          size="small"
          sx={CODE_CELL}
        />
      </TableCell>
      <TableCell>
        <MemoTextField
          value={variant.barcode ?? ''}
          onChange={set.barcode}
          size="small"
          sx={BARCODE_CELL}
          slotProps={barcodeInput}
        />
      </TableCell>
      <TableCell>
        <MemoTextField
          value={variant.inventory ?? ''}
          placeholder={stockApplies ? '—' : 'n/a'}
          disabled={!stockApplies}
          onChange={set.inventory}
          size="small"
          sx={STOCK_CELL}
          slotProps={stockInput}
        />
      </TableCell>
      <TableCell>
        <MemoTextField
          value={variant.weightGrams ?? ''}
          onChange={set.weightGrams}
          size="small"
          sx={PRICE_CELL}
          slotProps={NUMERIC_INPUT}
        />
      </TableCell>
    </TableRow>
  )
})

/** The matrix's column headings, one element for every render. */
const VARIANTS_HEAD = (
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
)

/**
 * The variants matrix: one row per combination of the options above, each
 * with its own price, SKU, barcode, stock and weight. A keystroke in one row
 * leaves the others' props as they were.
 */
const ProductVariantsTable = memo(function ProductVariantsTable(props: {
  variants: readonly CommerceModel.ProductVariant[]
  stockApplies: boolean
  onField: VariantFieldChange
}) {
  const { variants, stockApplies, onField } = props
  return (
    <Box>
      <ScrollTable size="small">
        {VARIANTS_HEAD}
        <TableBody>
          {variants.map((variant, index) => (
            <ProductVariantRow
              key={variant.id}
              index={index}
              variant={variant}
              stockApplies={stockApplies}
              onField={onField}
            />
          ))}
        </TableBody>
      </ScrollTable>
    </Box>
  )
})

/** What happens when stock runs out, the gift-card kind, tax, and the low-stock alert. */
const ProductSellingFields = memo(function ProductSellingFields(props: {
  oversellPolicy: 'deny' | 'backorder'
  giftCard: boolean
  taxExempt: boolean
  lowStockThreshold: number | undefined
  stockApplies: boolean
  giftsLocked: boolean
  giftsPlanLabel: string | undefined
  update: ProductUpdate
}) {
  const { giftsLocked, giftsPlanLabel, update } = props
  const setOversellPolicy = useCallback(
    (event: FieldChange) =>
      update({ oversellPolicy: event.target.value as 'deny' | 'backorder' }),
    [update],
  )
  const setKind = useCallback(
    (event: FieldChange) => update({ giftCard: event.target.value === 'gift' }),
    [update],
  )
  const setTax = useCallback(
    (event: FieldChange) => update({ taxExempt: event.target.value === 'exempt' }),
    [update],
  )
  const setLowStock = useCallback(
    (event: FieldChange) => {
      const raw = event.target.value.trim()
      update({
        lowStockThreshold:
          raw === '' ? undefined : Math.max(0, Math.round(Number(raw))),
      })
    },
    [update],
  )
  const kindMenu = useMemo(
    () => [
      <MenuItem key="standard" value="standard">
        {'Standard'}
      </MenuItem>,
      // Disabled, never removed (AGL-2080). A product saved as a gift
      // card before the plan lapsed still has `giftCard: true`, and a
      // MUI select whose value is absent from its options renders
      // blank — the next edit would silently rewrite the product to
      // Standard. Locking the option refuses NEW configuration
      // without rewriting existing data.
      <MenuItem value="gift" key="gift" disabled={giftsLocked}>
        {giftsLocked ? `Gift card — ${giftsPlanLabel ?? 'upgrade'} plan` : 'Gift card'}
      </MenuItem>,
    ],
    [giftsLocked, giftsPlanLabel],
  )
  return (
    <Stack direction="row" spacing={2}>
      <MemoTextField
        label="When out of stock"
        value={props.oversellPolicy}
        onChange={setOversellPolicy}
        size="small"
        select
        sx={OVERSELL_SELECT}
      >
        {OVERSELL_MENU}
      </MemoTextField>
      <MemoTextField
        label="Kind"
        value={props.giftCard ? 'gift' : 'standard'}
        onChange={setKind}
        size="small"
        select
        sx={KIND_SELECT}
        helperText={
          giftsLocked
            ? `Gift cards are on ${giftsPlanLabel ?? 'a higher plan'}`
            : 'Gift cards issue a code'
        }
      >
        {kindMenu}
      </MemoTextField>
      <MemoTextField
        label="Tax"
        value={props.taxExempt ? 'exempt' : 'taxable'}
        onChange={setTax}
        size="small"
        select
        sx={SHORT_SELECT}
      >
        {TAX_MENU}
      </MemoTextField>
      <MemoTextField
        label="Low-stock alert at"
        value={props.lowStockThreshold ?? ''}
        placeholder="Off"
        disabled={!props.stockApplies}
        onChange={setLowStock}
        size="small"
        sx={COUNT_FIELD}
        slotProps={NUMERIC_INPUT}
        helperText="Notifies managers"
      />
    </Stack>
  )
})

/** One-time or subscription billing, its interval, and a free trial. */
const ProductBillingFields = memo(function ProductBillingFields(props: {
  subscription: CommerceModel.HostProduct['subscription']
  subscriptionOptional: boolean | undefined
  subsLocked: boolean
  subsPlanLabel: string | undefined
  update: ProductUpdate
  replaceDraft: DraftReplace
}) {
  const { subscription, subscriptionOptional, subsLocked, update, replaceDraft } =
    props
  const setBilling = useCallback(
    (event: FieldChange) => {
      const value = event.target.value
      // `replaceDraft`, not `update`: a patch is spread over the draft,
      // which would resurrect the keys deleted below.
      replaceDraft((product) => {
        // "Both" (AGL-545): the PDP offers one-time OR subscribe at
        // the same price; the interval field beside picks the cadence.
        // Cleared keys are deleted (not set undefined) so the
        // client-direct setDoc on save never sees undefined values.
        const next = { ...product }
        if (value === 'once') {
          delete next.subscription
        } else {
          next.subscription = {
            ...(product.subscription ?? {}),
            interval:
              value === 'both'
                ? (product.subscription?.interval ?? 'month')
                : (value as 'month' | 'year'),
          }
        }
        if (value === 'both') next.subscriptionOptional = true
        else delete next.subscriptionOptional
        return next
      })
    },
    [replaceDraft],
  )
  const setBillingInterval = useCallback(
    (event: FieldChange) => {
      const interval = event.target.value as 'month' | 'year'
      update((product) => ({
        subscription: { ...product.subscription!, interval },
      }))
    },
    [update],
  )
  const setTrialDays = useCallback(
    (event: FieldChange) => {
      const raw = event.target.value.trim()
      update((product) => ({
        subscription: {
          ...product.subscription!,
          ...(raw === ''
            ? { trialDays: undefined }
            : { trialDays: Math.max(1, Math.round(Number(raw))) }),
        },
      }))
    },
    [update],
  )
  const billingMenu = useMemo(
    () => [
      <MenuItem key="once" value="once">
        {'One-time purchase'}
      </MenuItem>,
      // Same rule as the gift-card option: disabled, not removed, so an
      // existing subscription product keeps its interval instead of being
      // silently reset to one-time.
      <MenuItem value="month" key="month" disabled={subsLocked}>
        {'Monthly subscription'}
      </MenuItem>,
      <MenuItem value="year" key="year" disabled={subsLocked}>
        {'Yearly subscription'}
      </MenuItem>,
      <MenuItem value="both" key="both" disabled={subsLocked}>
        {'Both — buyer chooses'}
      </MenuItem>,
    ],
    [subsLocked],
  )
  return (
    <Stack direction="row" spacing={2}>
      <MemoTextField
        label="Billing"
        value={
          subscription
            ? subscriptionOptional
              ? 'both'
              : subscription.interval
            : 'once'
        }
        onChange={setBilling}
        size="small"
        select
        sx={BILLING_SELECT}
        helperText={
          subsLocked
            ? `Subscriptions are on ${props.subsPlanLabel ?? 'a higher plan'}`
            : 'Subscriptions bill until canceled'
        }
      >
        {billingMenu}
      </MemoTextField>
      {subscription && subscriptionOptional ? (
        <MemoTextField
          label="Interval"
          value={subscription.interval}
          onChange={setBillingInterval}
          size="small"
          select
          sx={SHORT_SELECT}
        >
          {INTERVAL_MENU}
        </MemoTextField>
      ) : null}
      {subscription ? (
        <MemoTextField
          label="Free trial (days)"
          placeholder="None"
          value={subscription.trialDays ?? ''}
          onChange={setTrialDays}
          size="small"
          sx={COUNT_FIELD}
          slotProps={NUMERIC_INPUT}
        />
      ) : null}
    </Stack>
  )
})

const DigitalFileRow = memo(function DigitalFileRow(props: {
  index: number
  file: DigitalFile
  hostId: string
  productId: string | undefined
  update: ProductUpdate
}) {
  const { index, file, update } = props
  const setVersion = useCallback(
    (event: FieldChange) => {
      const version = event.target.value.slice(0, 20)
      update((product) => {
        const digitalFiles = [...(product.digitalFiles ?? [])]
        digitalFiles[index] = { ...file, version }
        return { digitalFiles }
      })
    },
    [file, index, update],
  )
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
        {file.fileName}
        {file.version ? ` · v${file.version}` : ''}
      </Typography>
      <PaidMediaProtection
        url={file.url}
        hostId={props.hostId}
        productId={props.productId}
        kind="download"
      />
      <MemoTextField
        label="Version"
        value={file.version ?? ''}
        onChange={setVersion}
        size="small"
        sx={VERSION_FIELD}
      />
      <Button
        size="small"
        color="error"
        onClick={() =>
          update((product) => ({
            digitalFiles: (product.digitalFiles ?? []).filter(
              (_item, itemIndex) => itemIndex !== index,
            ),
          }))
        }
      >
        {'✕'}
      </Button>
    </Stack>
  )
})

/*
 * The paid-media controls beside the digital fields, drawn again only when
 * what they are handed changes: a keystroke in the download limit leaves the
 * videos, and the protection check on each, as they were.
 */
const MemoMembersVideosField = memo(MembersVideosField)
const MemoPaidDownloadAddButton = memo(PaidDownloadAddButton)

/** A digital product's files, its download limit and its members videos. */
const ProductDigitalFields = memo(function ProductDigitalFields(props: {
  hostId: string
  productId: string | undefined
  digitalFiles: readonly DigitalFile[]
  downloadLimit: number | undefined
  gatedVideos: readonly MembersVideo[]
  update: ProductUpdate
}) {
  const { hostId, productId, update } = props
  const addFile = useCallback(
    (file: DigitalFile) =>
      update((product) => ({
        digitalFiles: [...(product.digitalFiles ?? []), file],
      })),
    [update],
  )
  const setDownloadLimit = useCallback(
    (event: FieldChange) => {
      const raw = event.target.value.trim()
      update({
        downloadLimit:
          raw === '' ? undefined : Math.max(1, Math.round(Number(raw))),
      })
    },
    [update],
  )
  const setVideos = useCallback(
    (gatedVideos: MembersVideo[]) => update({ gatedVideos }),
    [update],
  )
  return (
    <>
      <Divider textAlign="left">{'Digital delivery'}</Divider>
      {props.digitalFiles.map((file, index) => (
        <DigitalFileRow
          key={index}
          index={index}
          file={file}
          hostId={hostId}
          productId={productId}
          update={update}
        />
      ))}
      <Stack direction="row" spacing={2}>
        {/* Paid downloads are private files delivered through expiring
            links (AGL-2847); adding one makes the file private. */}
        <MemoPaidDownloadAddButton
          hostId={hostId}
          productId={productId}
          onAdd={addFile}
        />
        <MemoTextField
          label="Download limit"
          placeholder="Unlimited"
          value={props.downloadLimit ?? ''}
          onChange={setDownloadLimit}
          size="small"
          sx={COUNT_FIELD}
          slotProps={NUMERIC_INPUT}
          helperText="Attempts per order"
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {'Buyers always download the current files — uploading a new ' +
          'version re-delivers to everyone.'}
      </Typography>
      {/* Members videos are private files delivered through expiring
          links (AGL-2814); adding one makes the file private. */}
      <MemoMembersVideosField
        hostId={hostId}
        productId={productId}
        videos={props.gatedVideos}
        onChange={setVideos}
      />
    </>
  )
})

/** The product's search listing: its title, description and share image. */
const ProductSeoFields = memo(function ProductSeoFields(props: {
  title: string | undefined
  description: string | undefined
  hasImage: boolean
  update: ProductUpdate
  pick: MediaPick
}) {
  const { title, description, update, pick } = props
  const setTitle = useCallback(
    (event: FieldChange) => {
      const next = event.target.value
      update((product) => ({ seo: { ...product.seo, title: next } }))
    },
    [update],
  )
  const setDescription = useCallback(
    (event: FieldChange) => {
      const next = event.target.value
      update((product) => ({ seo: { ...product.seo, description: next } }))
    },
    [update],
  )
  return (
    <>
      <Divider textAlign="left">{'Search engine listing'}</Divider>
      <Stack direction={WIDE_ROW} spacing={2}>
        <MemoTextField
          label="SEO title"
          value={title ?? ''}
          onChange={setTitle}
          // The counts every search listing editor prints (AGL-2910): what a
          // search result shows before it truncates.
          helperText={seoListingFieldCount('title', title)}
          error={seoListingFieldTooLong('title', title)}
          size="small"
          fullWidth
        />
        <Button
          size="small"
          onClick={() =>
            void pick((media) =>
              update((product) => ({
                seo: { ...product.seo, imageUrl: media.url },
              })),
            )
          }
        >
          {props.hasImage ? 'Change OG image' : 'OG image'}
        </Button>
      </Stack>
      <MemoTextField
        label="SEO description"
        value={description ?? ''}
        onChange={setDescription}
        helperText={seoListingFieldCount('description', description)}
        error={seoListingFieldTooLong('description', description)}
        size="small"
        multiline
        minRows={2}
      />
    </>
  )
})

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

  /**
   * Field-level entitlement gates (AGL-2080). Both of these were fully
   * configurable by an unentitled org and refused only at checkout — by
   * `server/checkout.ts:149` for subscriptions and `:157` /
   * `cart-checkout.ts:156` for gift cards. The operator saw a saved product;
   * the buyer saw the refusal.
   *
   * `ready && !entitled`, never `!entitled`. `checkEntitlement(undefined)`
   * resolves the FREE tier rather than "unknown", so gating on the raw call
   * would disable these controls at a PAYING org for the render or two its
   * org doc is in flight. Erring open for that window costs nothing — the
   * server enforces regardless — while erring closed is a paying customer
   * told they cannot use what they bought.
   */
  const subs = useCommerceEntitlement(hostId, 'storefrontSubscriptions')
  const gifts = useCommerceEntitlement(hostId, 'giftCards')
  // The register settings show only where the plan includes POS (AGL-3607).
  const pos = useCommerceEntitlement(hostId, 'pos')
  const subsLocked = subs.ready && !subs.entitled
  const giftsLocked = gifts.ready && !gifts.entitled
  const firestore = useFirestore()
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  /**
   * The three pickers this dialog draws, read only once it is OPEN.
   *
   * `ProductEditorDialog` is rendered unconditionally by the products hub and
   * takes `open` as a prop, so its body runs on every render of that page. A
   * listener built here without the gate subscribes whether or not anyone
   * opens the editor, which charges every visit to the catalog for three
   * collections the visitor never sees.
   *
   * `null` is what `useFirestoreCollection` takes to mean "do not subscribe",
   * so the closed dialog costs nothing and the open one pays once.
   */
  const { data: categoryDocs } = useFirestoreCollection<any>(
    () =>
      open
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'productCategories'),
            CATEGORY_CEILING,
          )
        : null,
    [firestore, hostId, open],
    { idField: '$id' },
  )
  const { data: allProductDocs } = useFirestoreCollection<any>(
    () =>
      open
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'products'),
            RELATED_PRODUCT_CEILING,
          )
        : null,
    [firestore, hostId, open],
    { idField: '$id' },
  )
  const { data: supplierDocs } = useFirestoreCollection<any>(
    () =>
      open
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'suppliers'),
            SUPPLIER_CEILING,
          )
        : null,
    [firestore, hostId, open],
    { idField: '$id' },
  )
  const categories = useMemo(
    () => ceilingedWindow<any>(categoryDocs ?? undefined, CATEGORY_CEILING),
    [categoryDocs],
  )
  const relatedProducts = useMemo(
    () =>
      ceilingedWindow<any>(allProductDocs ?? undefined, RELATED_PRODUCT_CEILING),
    [allProductDocs],
  )
  const suppliers = useMemo(
    () => ceilingedWindow<any>(supplierDocs ?? undefined, SUPPLIER_CEILING),
    [supplierDocs],
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
  const pick = useCallback<MediaPick>(
    async (apply) => {
      const media = await pickMedia?.()
      if (media) apply(media)
    },
    [pickMedia],
  )
  // Lazy-init per open; parent remounts via `key` on product change.
  const current: CommerceModel.HostProduct = draft ?? lifted ?? blankProduct()
  /*
   * The two writes every field goes through, each keeping its identity for
   * the life of the dialog so a memoized section redraws only when its own
   * slice of the draft does (AGL-3423). Both write from the draft as last
   * rendered, which `latest` holds: `update` spreads a patch over it, and a
   * patch that is a function is handed it, so no field holds a copy of the
   * product to spread. A write that lands after a picker closes lands on the
   * draft as it is then.
   */
  const latest = useRef(current)
  latest.current = current
  const replaceDraft = useCallback<DraftReplace>(
    (build) => setDraft(build(latest.current)),
    [],
  )
  const update = useCallback<ProductUpdate>(
    (patch) =>
      replaceDraft((at) => ({
        ...at,
        ...(typeof patch === 'function' ? patch(at) : patch),
      })),
    [replaceDraft],
  )
  const setTags = useCallback(
    (tags: string[]) =>
      update({ tags: tags.map((tag) => String(tag).trim()).filter(Boolean) }),
    [update],
  )
  const setCategories = useCallback(
    (picked: any[]) =>
      update({ categoryIds: picked.map((category: any) => category.$id) }),
    [update],
  )
  const setRelatedProducts = useCallback(
    (picked: any[]) =>
      update({ relatedProductIds: picked.map((item: any) => item.$id) }),
    [update],
  )
  const categoryIds = current.categoryIds
  const pickedCategories = useMemo(
    () =>
      categories.rows.filter((category: any) =>
        (categoryIds ?? []).includes(category.$id),
      ),
    [categories.rows, categoryIds],
  )
  const relatedProductIds = current.relatedProductIds
  const productId = product?.$id
  const relatedOptions = useMemo(
    () =>
      relatedProducts.rows.filter(
        (item: any) => !item.deletedAt && item.$id !== productId,
      ),
    [relatedProducts.rows, productId],
  )
  const pickedRelated = useMemo(
    () =>
      relatedProducts.rows.filter((item: any) =>
        (relatedProductIds ?? []).includes(item.$id),
      ),
    [relatedProducts.rows, relatedProductIds],
  )

  /** The shell's zone renderer (AGL-2910); `null` outside the console shell. */
  const WidgetSlot = useConsoleWidgetSlot()
  /**
   * A listing zone widget's proposal, staged into the draft like typing.
   * Functional, because a proposal can arrive after a generation finishes,
   * and a closure over the render that started it would put back every edit
   * made while it ran. Only the fields a product's listing holds are taken.
   */
  const proposeSeoValues = useCallback(
    (values: ConsoleSeoFieldValues) => {
      const staged: { title?: string; description?: string } = {}
      for (const field of PRODUCT_SEO_LISTING_FIELDS) {
        const value = values[field]
        if (typeof value === 'string') staged[field] = value
      }
      if (!Object.keys(staged).length) return
      setDraft((prior) => {
        const base = prior ?? lifted ?? blankProduct()
        return { ...base, seo: { ...base.seo, ...staged } }
      })
    },
    [lifted],
  )

  /**
   * The product zone's proposal (AGL-2916): copy staged into the draft like
   * typing, functional for the reason `proposeSeoValues` gives. Option names
   * go through `renameProductOptions`, so every variant keeps its price, SKU
   * and stock.
   */
  const proposeProductValues = useCallback(
    (values: ConsoleProductCopyValues) => {
      setDraft((prior) => {
        const base = prior ?? lifted ?? blankProduct()
        return { ...base, ...CommerceModel.productCopyPatch(base, values) }
      })
    },
    [lifted],
  )
  const zoneCategories = useMemo(
    () => categories.rows.map((category: any) => ({ id: String(category.$id), name: String(category.name ?? '') })),
    [categories.rows],
  )
  /*
   * What the two zones are handed, held by content: a keystroke in a field
   * neither zone reads (a SKU, a price) leaves both as they were.
   */
  const zoneProduct = useContentStable<ConsoleProductEditorZoneProps['product']>({
    id: product?.$id ?? null,
    name: current.name,
    type: current.type,
    description: String(current.description ?? ''),
    tags: current.tags ?? [],
    categoryIds: current.categoryIds ?? [],
    options: (current.options ?? []).map((option) => ({ name: option.name, values: option.values })),
    mediaUrls: current.mediaUrls ?? [],
    seoTitle: current.seo?.title ?? '',
    seoDescription: current.seo?.description ?? '',
    shipping: {
      lengthCm: current.shipping?.lengthCm ?? null,
      widthCm: current.shipping?.widthCm ?? null,
      heightCm: current.shipping?.heightCm ?? null,
      hsCode: current.shipping?.hsCode ?? '',
      originCountry: current.shipping?.originCountry ?? '',
    },
    channel: {
      brand: current.channel?.brand ?? '',
      gtin: current.channel?.gtin ?? '',
      mpn: current.channel?.mpn ?? '',
      condition: current.channel?.condition ?? '',
      googleProductCategory: current.channel?.googleProductCategory ?? '',
    },
  })
  const seoSubject = useContentStable({
    kind: 'product',
    id: product?.$id ?? null,
    name: current.name,
    description: String(current.description ?? ''),
  })
  const seoValues = useContentStable({
    title: current.seo?.title ?? '',
    description: current.seo?.description ?? '',
  })

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
    update((at) => ({
      variants: at.variants.map((variant) => {
        const { inventoryByLocation: _perLocation, ...rest } = variant
        return { ...rest, inventory: null }
      }),
    }))
  }

  const handleName = useCallback(
    (event: FieldChange) => {
      const name = event.target.value
      update({
        name,
        ...(!product && !slugTouched ? { slug: CommerceModel.commerceSlug(name) } : {}),
      })
    },
    [product, slugTouched, update],
  )
  const handleSlug = useCallback(
    (event: FieldChange) => {
      setSlugTouched(true)
      update({ slug: CommerceModel.commerceSlug(event.target.value) })
    },
    [update],
  )

  const handleOptionsChange = useCallback<OptionChange>(
    (index, patch) =>
      update((at) => {
        // A RENAME moves each variant's selection to the new name (AGL-3066).
        // Rebuilding the matrix matches variants by name and value, so under a
        // new name it finds none and replaces every variant, its id, price, SKU
        // and stock with them. Only a change of values rebuilds.
        if (
          patch &&
          at.options?.[index] &&
          Object.keys(patch).length === 1 &&
          typeof patch.name === 'string'
        ) {
          return CommerceModel.renameProductOptions(
            at,
            at.options.map((option, optionIndex) =>
              optionIndex === index ? patch.name : option.name,
            ),
          )
        }
        const options = [...(at.options ?? [])]
        if (patch === null) options.splice(index, 1)
        else options[index] = { name: '', values: [], ...options[index], ...patch }
        // Regenerate the matrix, carrying data over by option-combo key so
        // edits to prices/SKUs survive option tweaks.
        const previous = new Map(
          at.variants.map((variant) => [comboKey(variant.options), variant]),
        )
        const fallback = at.variants[0]
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
        return { options, variants }
      }),
    [update],
  )
  const setOptionValues = useCallback(
    (values: string[], index: number) =>
      handleOptionsChange(index, {
        values: values.map((value) => String(value).trim()).filter(Boolean),
      }),
    [handleOptionsChange],
  )

  const handleVariantField = useCallback<VariantFieldChange>(
    (index, field, raw) =>
      update((at) => {
        const variants = [...at.variants]
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
        return { variants }
      }),
    [update],
  )


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
    const seeded = current as typeof current & {
      $id?: string
      skus?: string[]
      barcodes?: string[]
    }
    /*
     * The seed's `skus` / `barcodes` are dropped too (AGL-3321):
     * `productSearchFields` below OMITS each when no variant has one, so a
     * seeded copy would survive a save that removed the last SKU, and the
     * product would go on answering a SKU filter for a code it no longer has.
     */
    const {
      $id: _syntheticId,
      skus: _seededSkus,
      barcodes: _seededBarcodes,
      ...currentFields
    } = seeded
    const base = {
      ...currentFields,
      /*
       * `name` comes from `productSearchFields`, not from a bare assignment
       * (AGL-2501) — it returns the trimmed name ALONGSIDE the keys derived
       * from it, so the two cannot drift. Writing the name here and the keys
       * anywhere else is the shape that leaves a renamed product findable
       * only by what it used to be called.
       */
      ...CommerceModel.productSearchFields({
        name: current.name.trim().slice(0, 120),
        variants: current.variants,
      }),
      slug: current.slug || CommerceModel.commerceSlug(current.name),
      priceUsd: primaryVariant?.priceUsd ?? 0,
      ...CommerceModel.productStockFields({
        variants: current.variants,
        oversellPolicy: current.oversellPolicy,
      }),
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
          // The smart collections this product's rules answer, from the
          // host's rules as they stand now (AGL-3321).
          const membership = await productCollectionFields(firestore, hostId, {
            name: base.name,
            type: current.type,
            tags: current.tags,
            categoryIds: current.categoryIds,
            variants: current.variants,
          })
          if (product) {
            /**
             * RESERVATIONS ARE NOT THE EDITOR'S TO WRITE (AGL-2356).
             *
             * Checkout stores live stock holds in a `stockHolds` map on this
             * document, and this is a `merge: false` replace of a payload
             * built from the dialog's SEED. Left alone it would write whatever
             * that seed happened to carry, and both directions are wrong: a
             * seed taken before a shopper reached checkout erases a live
             * reservation and reopens the oversell for that session, and a
             * seed carrying a hold that has since settled resurrects a
             * reservation against stock that is already sold.
             *
             * So the field is dropped from the payload and re-read from the
             * server immediately before the write. One extra read on a product
             * save, in exchange for an editor that cannot invent or destroy a
             * reservation. The AGL-1358 seed guard above bounds how stale the
             * REST of this payload can be; it cannot help here, because a hold
             * legitimately appears seconds after a perfectly fresh seed.
             */
            const productRef = doc(
              firestore,
              'hosts',
              hostId,
              'products',
              product.$id,
            )
            const { stockHolds: _seededHolds, ...withoutHolds } =
              base as typeof base & { stockHolds?: Record<string, unknown> }
            const liveHolds = await getDoc(productRef)
              .then((snapshot) => snapshot.get('stockHolds'))
              .catch(() => undefined)
            // Edit stays client-direct (no quota consumed); full replace.
            // The product page renders it with no publish step, so the save
            // carries the site's cache drop with it (AGL-3386).
            await writeSiteWideChange({
              firestore,
              user,
              hostId,
              write: (batch) =>
                batch.set(
                  productRef,
                  {
                    ...withoutHolds,
                    ...membership,
                    ...(liveHolds ? { stockHolds: liveHolds } : {}),
                    // The editor edits a LIVE product, and the products table
                    // lists only `deletedAt == null` (AGL-3321): a replace
                    // whose seed lacked the field would take the product off
                    // the list.
                    deletedAt: null,
                    updatedAt: Timestamp.now(),
                  },
                  { merge: false },
                ),
            })
          } else {
            // New product rides the quota-enforcing resources API (AGL-473) —
            // it re-checks the `commerce` entitlement and productsPerHost.
            await createHostResource({
              hostId,
              resource: 'product',
              data: { ...base, ...membership, createdAtMs: Date.now() },
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
    user,
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
        <ProductBasicsFields
          name={current.name}
          slug={current.slug}
          type={current.type}
          status={current.status}
          supplierId={current.supplierId}
          description={current.description ?? ''}
          suppliers={suppliers.rows}
          onName={handleName}
          onSlug={handleSlug}
          update={update}
        />
        <ProductChipsField<string>
          freeSolo
          label="Tags"
          placeholder="Type and press Enter"
          options={NO_ITEMS}
          value={current.tags ?? NO_ITEMS}
          onChange={setTags}
        />
        {categories.rows.length > 0 ? (
          <ProductChipsField<any>
            label="Categories"
            options={categories.rows}
            getOptionLabel={categoryLabel}
            isOptionEqualToValue={sameRecord}
            value={pickedCategories}
            onChange={setCategories}
          />
        ) : null}
        {/*
          The product zone (AGL-2916), hosted like the listing zone below: a
          widget proposes copy from what this product says and shows, staged in
          the fields above like typing. Save product is still the only write.
        */}
        {WidgetSlot ? (
          <HostedZone
            renderer={WidgetSlot}
            slot={PRODUCT_EDITOR_ZONE.id}
            hostId={hostId}
            orgId={undefined}
            product={zoneProduct}
            categories={zoneCategories}
            proposeValues={proposeProductValues}
          />
        ) : null}

        <Divider textAlign="left">{'Media'}</Divider>
        <ProductMediaFields
          mediaUrls={current.mediaUrls ?? NO_ITEMS}
          update={update}
          pick={pick}
        />

        <Divider textAlign="left">{'Options & variants'}</Divider>
        <ProductOptionsFields
          options={current.options ?? NO_OPTIONS}
          onChange={handleOptionsChange}
          onValues={setOptionValues}
        />
        <ProductVariantsTable
          variants={current.variants}
          stockApplies={stockApplies}
          onField={handleVariantField}
        />
        <Typography variant="caption" color="text.secondary">
          {stockApplies
            ? 'Blank stock = untracked; 0 shows sold out. The first variant’s ' +
              'price feeds legacy Product blocks.'
            : 'Stock is not tracked on a digital or service subscription — ' +
              'nothing decrements it, on the first charge or on any renewal. ' +
              'A physical subscription decrements per cycle, and “Both — ' +
              'buyer chooses” tracks the one-time sales. The first variant’s ' +
              'price feeds legacy Product blocks.'}
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
            {`This product still has stock set (${strandedStock}), but a ` +
              'digital or service subscription never decrements it — not the ' +
              'first charge, not any renewal — so the number will not change ' +
              'on its own and does not cap subscribers. It is kept, not ' +
              'deleted: a stored 0 still blocks new subscribers, and the ' +
              'value becomes editable again if you switch Billing back to ' +
              'one-time or “Both”, or the Type to physical.'}
          </Alert>
        ) : null}
        {/* One linked upsell for both locked selectors (AGL-2080). The
            helper text under each control names the plan, but a disabled
            MenuItem is only visible with the menu open and neither is a
            path anywhere — the retention directive wants the upgrade
            prominent and one-click, so the link lives here, beside the
            controls it unlocks. */}
        {subsLocked || giftsLocked ? (
          <EntitlementUpsell
            planLabel={undefined}
            upgradeHref={subsLocked ? subs.upgradeHref : gifts.upgradeHref}
          >
            {subsLocked && giftsLocked
              ? `Subscription products (${subs.planLabel ?? 'higher plan'}) ` +
                `and gift cards (${gifts.planLabel ?? 'higher plan'}) are ` +
                'not on your plan. You can still save this product — those ' +
                'two options stay locked until you upgrade.'
              : subsLocked
                ? `Subscription products are on ${subs.planLabel ?? 'a higher plan'}. ` +
                  'A subscription saved without it is refused at checkout, ' +
                  'so the option stays locked here instead.'
                : `Gift cards are on ${gifts.planLabel ?? 'a higher plan'}. ` +
                  'A gift-card product saved without it is refused at ' +
                  'checkout, so the option stays locked here instead.'}
          </EntitlementUpsell>
        ) : null}
        <ProductSellingFields
          oversellPolicy={current.oversellPolicy ?? 'deny'}
          giftCard={Boolean(current.giftCard)}
          taxExempt={Boolean(current.taxExempt)}
          lowStockThreshold={current.lowStockThreshold}
          stockApplies={stockApplies}
          giftsLocked={giftsLocked}
          giftsPlanLabel={gifts.planLabel}
          update={update}
        />
        <ProductBillingFields
          subscription={current.subscription}
          subscriptionOptional={current.subscriptionOptional}
          subsLocked={subsLocked}
          subsPlanLabel={subs.planLabel}
          update={update}
          replaceDraft={replaceDraft}
        />
        {pos.ready && pos.entitled ? (
          <ProductRegisterFields
            posQuickKey={Boolean(current.posQuickKey)}
            modifierGroups={current.modifierGroups ?? NO_MODIFIER_GROUPS}
            update={update}
          />
        ) : null}
        {current.type === 'digital' ? (
          <ProductDigitalFields
            hostId={hostId}
            productId={product?.$id}
            digitalFiles={current.digitalFiles ?? NO_FILES}
            downloadLimit={current.downloadLimit}
            gatedVideos={current.gatedVideos ?? NO_VIDEOS}
            update={update}
          />
        ) : null}

        <ProductChipsField<any>
          label="Related products (upsells)"
          helperText="Shown by the Related products block; blank falls back to frequently-bought-together"
          options={relatedOptions}
          getOptionLabel={recordLabel}
          isOptionEqualToValue={sameRecord}
          value={pickedRelated}
          onChange={setRelatedProducts}
        />

        <ProductSeoFields
          title={current.seo?.title}
          description={current.seo?.description}
          hasImage={Boolean(current.seo?.imageUrl)}
          update={update}
          pick={pick}
        />
        {/*
          The search listing zone (AGL-2910), hosted here through the shell's
          renderer: a plugin's dialog cannot mount the console's slot itself.
          A widget proposes a title and a description from what this product
          says; they are staged in the fields above like typing, and Save
          product is still the only write.
        */}
        {WidgetSlot ? (
          <HostedZone
            renderer={WidgetSlot}
            slot="seoFields"
            hostId={hostId}
            orgId={undefined}
            orgSlug=""
            subject={seoSubject}
            fields={PRODUCT_SEO_LISTING_FIELDS}
            values={seoValues}
            hasImage={Boolean(current.seo?.imageUrl)}
            proposeValues={proposeSeoValues}
          />
        ) : null}

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
