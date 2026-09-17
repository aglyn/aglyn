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

import type { ConsoleProductsHubZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { Alert, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useMemo, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  aiProductCopyProposals,
  aiProductsBulkCount,
  aiProductsProposalOfKind,
  type AiProductCopyProposal,
  type AiProposedDiscount,
} from '../model/ai-products'
import { aiProductCopyValues } from './ai-product-copy-card.component'
import { isAiJobMoving } from './use-ai-products-jobs'

/**
 * The review tables of the products hub's AI card (AGL-2916): what a
 * `products` job proposed, row by row, before anything is written. Every
 * write is one the hub makes when a person asks for it — Apply, Apply to all,
 * Create drafts, Create selected — and the hub passes over what the site
 * already has, so a proposal applied twice creates nothing twice.
 */

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

/** A discount's offer, in the words the discounts card uses. */
export function aiDiscountOffer(discount: AiProposedDiscount): string {
  if (discount.kind === 'percent') return `${discount.valuePct ?? 0}% off`
  if (discount.kind === 'fixed') return `$${((discount.valueCents ?? 0) / 100).toFixed(2)} off`
  return 'Free shipping'
}

function JobState(props: { job: AiJobSummary; doing: string }) {
  const { job } = props
  if (isAiJobMoving(job)) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={16} aria-label={props.doing} />
        <Typography variant="body2" color="text.secondary">
          {props.doing}
        </Typography>
      </Stack>
    )
  }
  return job.error ? <Alert severity={job.status === 'failed' ? 'error' : 'warning'}>{job.error}</Alert> : null
}

/* ------------------------------------------------------------------------ *
 * Copy for many products
 * ------------------------------------------------------------------------ */

type RowState = 'applying' | 'applied' | { error: string }

export function AiBulkCopyReview(props: {
  job: AiJobSummary
  applyProductCopy: ConsoleProductsHubZoneProps['applyProductCopy']
}) {
  const { job, applyProductCopy } = props
  const proposals = aiProductCopyProposals(job)
  const asked = aiProductsBulkCount(job) ?? proposals.length
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [applyingAll, setApplyingAll] = useState(false)

  const ready = (proposal: AiProductCopyProposal) =>
    Boolean(proposal.values && proposal.product.id) && rows[proposal.product.id as string] !== 'applied'

  const apply = useCallback(
    async (proposal: AiProductCopyProposal) => {
      const id = proposal.product.id
      if (!id || !proposal.values) return
      setRows((current) => ({ ...current, [id]: 'applying' }))
      try {
        await applyProductCopy(id, aiProductCopyValues(proposal))
        setRows((current) => ({ ...current, [id]: 'applied' }))
      } catch (error) {
        setRows((current) => ({ ...current, [id]: { error: messageOf(error, 'The copy could not be saved.') } }))
      }
    },
    [applyProductCopy],
  )

  /** Applies each proposal in turn, so one refusal names its product and the rest still land. */
  const applyAll = useCallback(
    async (targets: readonly AiProductCopyProposal[]) => {
      setApplyingAll(true)
      try {
        for (const proposal of targets) await apply(proposal)
      } finally {
        setApplyingAll(false)
      }
    },
    [apply],
  )

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'name', headerName: 'Product', flex: 1, minWidth: 160 },
      { field: 'description', headerName: 'Proposed description', flex: 2, minWidth: 220 },
      { field: 'seoTitle', headerName: 'Search title', flex: 1, minWidth: 160 },
      {
        field: 'actions',
        headerName: '',
        width: 170,
        sortable: false,
        renderCell: ({ row }: { row: { proposal: AiProductCopyProposal } }) => {
          const { proposal } = row
          if (proposal.skipped) return <Chip size="small" variant="outlined" label="Skipped" title={proposal.skipped} />
          const state = proposal.product.id ? rows[proposal.product.id] : undefined
          if (state === 'applied') return <Chip size="small" color="success" variant="outlined" label="Applied" />
          if (typeof state === 'object') return <Chip size="small" color="error" variant="outlined" label="Not saved" title={state.error} />
          return (
            <Button size="small" disabled={state === 'applying' || applyingAll} onClick={() => void apply(proposal)}>
              {'Apply'}
            </Button>
          )
        },
      },
    ],
    [rows, applyingAll, apply],
  )

  const tableRows = proposals.map((proposal) => ({
    $id: proposal.product.id ?? proposal.product.name,
    name: proposal.product.name,
    description: proposal.values ? clip(proposal.values.description, 140) : (proposal.skipped ?? ''),
    seoTitle: proposal.values?.seoTitle ?? '',
    proposal,
  }))
  const readyCount = proposals.filter(ready).length
  const errors = Object.values(rows).filter((state): state is { error: string } => typeof state === 'object')
  const gaps = proposals.filter((proposal) => proposal.gaps.length).length

  return (
    <Stack spacing={1} aria-label="Proposed product copy">
      <Typography variant="subtitle2">{`Product copy · ${proposals.length} of ${asked}`}</Typography>
      <JobState job={job} doing={`Writing copy: ${proposals.length} of ${asked}`} />
      {tableRows.length ? <ListTable rows={tableRows} columns={columns} hideFooter quickFilter={false} /> : null}
      {gaps ? (
        <Alert severity="warning">
          {`${gaps} ${gaps === 1 ? 'description marks' : 'descriptions mark'} facts in [brackets] to fill in before you publish.`}
        </Alert>
      ) : null}
      {errors.length ? <Alert severity="error">{errors[0].error}</Alert> : null}
      <Button
        size="small"
        variant="contained"
        sx={{ alignSelf: 'flex-start' }}
        disabled={!readyCount || applyingAll}
        onClick={() => void applyAll(proposals.filter(ready))}
      >
        {readyCount ? `Apply to all ${readyCount}` : 'Apply to all'}
      </Button>
    </Stack>
  )
}

/* ------------------------------------------------------------------------ *
 * A store's first products
 * ------------------------------------------------------------------------ */

export function AiCatalogReview(props: {
  job: AiJobSummary
  heldNames: ReadonlySet<string>
  createProductDrafts: ConsoleProductsHubZoneProps['createProductDrafts']
}) {
  const { job, heldNames, createProductDrafts } = props
  const proposal = aiProductsProposalOfKind(job, 'catalog')
  const products = useMemo(() => proposal?.products ?? [], [proposal])
  const held = (name: string) => heldNames.has(name.replace(/\s+/g, ' ').trim().toLowerCase())
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  const rows = products.map((product, index) => ({
    $id: `p${index}`,
    name: product.name,
    type: product.type,
    options: product.options.map((option) => `${option.name}: ${option.values.join(', ')}`).join(' · ') || '—',
    photo: product.photo,
    inCatalog: held(product.name),
    product,
  }))
  const chosen = selected ?? rows.filter((row) => !row.inCatalog).map((row) => row.$id)

  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'name', headerName: 'Product', flex: 1, minWidth: 180 },
      { field: 'options', headerName: 'Options', flex: 1, minWidth: 160 },
      {
        field: 'price',
        headerName: 'Price',
        width: 130,
        sortable: false,
        // Never proposed: prices are the merchant's to set.
        renderCell: () => <Chip size="small" color="warning" variant="outlined" label="Set a price" />,
      },
      {
        field: 'photo',
        headerName: 'Photo',
        flex: 1,
        minWidth: 200,
        sortable: false,
        renderCell: ({ row }: { row: { photo: string; inCatalog: boolean } }) => (
          <Stack spacing={0.25} sx={{ py: 0.5 }}>
            <Chip size="small" color="warning" variant="outlined" label="Needs a photo" sx={{ alignSelf: 'flex-start' }} />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'normal' }}>
              {row.photo}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'inCatalog',
        headerName: '',
        width: 150,
        sortable: false,
        renderCell: ({ row }: { row: { inCatalog: boolean } }) =>
          row.inCatalog ? <Chip size="small" variant="outlined" label="In your catalog" /> : null,
      },
    ],
    [],
  )

  const create = useCallback(async () => {
    const picks = rows.filter((row) => chosen.includes(row.$id)).map((row) => row.product)
    if (!picks.length) return
    setBusy(true)
    setResult(null)
    try {
      const created = await createProductDrafts(
        picks.map((product) => ({
          name: product.name,
          type: product.type,
          description: product.description,
          tags: product.tags,
          options: product.options,
          seoTitle: product.seoTitle,
          seoDescription: product.seoDescription,
        })),
      )
      const passed = picks.length - created.length
      setResult({
        severity: 'success',
        text:
          `Created ${created.length} draft ${created.length === 1 ? 'product' : 'products'}. ` +
          'Each needs a price and a photo before you activate it.' +
          (passed ? ` ${passed} already in your catalog ${passed === 1 ? 'was' : 'were'} left as they are.` : ''),
      })
      setSelected([])
    } catch (error) {
      setResult({ severity: 'error', text: messageOf(error, 'The draft products could not be created.') })
    } finally {
      setBusy(false)
    }
  }, [rows, chosen, createProductDrafts])

  return (
    <Stack spacing={1} aria-label="Proposed products">
      <Typography variant="subtitle2">{'Proposed products'}</Typography>
      <JobState job={job} doing="Proposing products from your brief" />
      {rows.length ? (
        <>
          <Typography variant="body2" color="text.secondary">
            {'Each is created as a draft with its price left empty and no photo. Set both in the product editor, ' +
              'then activate it.'}
          </Typography>
          <ListTable
            rows={rows}
            columns={columns}
            hideFooter
            quickFilter={false}
            getRowHeight={() => 'auto'}
            selectable={{ selected: chosen, onChange: setSelected }}
          />
          <Button
            size="small"
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            disabled={busy || !chosen.length}
            onClick={() => void create()}
          >
            {`Create ${chosen.length} ${chosen.length === 1 ? 'draft' : 'drafts'}`}
          </Button>
        </>
      ) : null}
      {result ? <Alert severity={result.severity}>{result.text}</Alert> : null}
    </Stack>
  )
}

/* ------------------------------------------------------------------------ *
 * Categories and discounts
 * ------------------------------------------------------------------------ */

export function AiCategoriesReview(props: {
  job: AiJobSummary
  createCategories: ConsoleProductsHubZoneProps['createCategories']
  createDiscountDrafts: ConsoleProductsHubZoneProps['createDiscountDrafts']
}) {
  const { job, createCategories, createDiscountDrafts } = props
  const proposal = aiProductsProposalOfKind(job, 'categories')
  const categoryRows = (proposal?.categories ?? []).map((category, index) => ({
    $id: `c${index}`,
    name: category.name,
    why: category.why,
  }))
  const discountRows = (proposal?.discounts ?? []).map((discount, index) => ({
    $id: `d${index}`,
    name: discount.name,
    code: discount.code ?? 'Applies on its own',
    offer: aiDiscountOffer(discount),
    minimum: discount.minSubtotalCents ? `$${(discount.minSubtotalCents / 100).toFixed(2)}` : 'Any order',
    why: discount.why,
    discount,
  }))
  const [categories, setCategories] = useState<string[] | null>(null)
  const [discounts, setDiscounts] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const chosenCategories = categories ?? categoryRows.map((row) => row.$id)
  const chosenDiscounts = discounts ?? discountRows.map((row) => row.$id)

  const categoryColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'name', headerName: 'Category', flex: 1, minWidth: 160 },
      { field: 'why', headerName: 'Why', flex: 2, minWidth: 220 },
    ],
    [],
  )
  const discountColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'name', headerName: 'Discount', flex: 1, minWidth: 150 },
      { field: 'code', headerName: 'Code', width: 150 },
      { field: 'offer', headerName: 'Offer', width: 120 },
      { field: 'minimum', headerName: 'Minimum order', width: 130 },
      { field: 'why', headerName: 'Why', flex: 2, minWidth: 200 },
    ],
    [],
  )

  const create = useCallback(async () => {
    setBusy(true)
    setResult(null)
    try {
      const madeCategories = await createCategories(
        categoryRows.filter((row) => chosenCategories.includes(row.$id)).map((row) => row.name),
      )
      const madeDiscounts = await createDiscountDrafts(
        discountRows
          .filter((row) => chosenDiscounts.includes(row.$id))
          .map(({ discount }) => ({
            name: discount.name,
            code: discount.code,
            kind: discount.kind,
            valuePct: discount.valuePct,
            valueCents: discount.valueCents,
            minSubtotalCents: discount.minSubtotalCents,
          })),
      )
      setResult({
        severity: 'success',
        text:
          `Created ${madeCategories} ${madeCategories === 1 ? 'category' : 'categories'} and ` +
          `${madeDiscounts} ${madeDiscounts === 1 ? 'discount' : 'discounts'}. ` +
          'Discounts start switched off: switch each on under Promotions when you are ready. ' +
          'Anything your store already had was left as it is.',
      })
      setCategories([])
      setDiscounts([])
    } catch (error) {
      setResult({ severity: 'error', text: messageOf(error, 'The categories and discounts could not be created.') })
    } finally {
      setBusy(false)
    }
  }, [categoryRows, discountRows, chosenCategories, chosenDiscounts, createCategories, createDiscountDrafts])

  const any = chosenCategories.length + chosenDiscounts.length
  return (
    <Stack spacing={1} aria-label="Proposed categories and discounts">
      <Typography variant="subtitle2">{'Proposed categories and discounts'}</Typography>
      <JobState job={job} doing="Proposing categories and discounts from your brief" />
      {categoryRows.length ? (
        <ListTable
          rows={categoryRows}
          columns={categoryColumns}
          hideFooter
          quickFilter={false}
          selectable={{ selected: chosenCategories, onChange: setCategories }}
        />
      ) : null}
      {discountRows.length ? (
        <ListTable
          rows={discountRows}
          columns={discountColumns}
          hideFooter
          quickFilter={false}
          selectable={{ selected: chosenDiscounts, onChange: setDiscounts }}
        />
      ) : null}
      {categoryRows.length || discountRows.length ? (
        <Button
          size="small"
          variant="contained"
          sx={{ alignSelf: 'flex-start' }}
          disabled={busy || !any}
          onClick={() => void create()}
        >
          {'Create selected'}
        </Button>
      ) : null}
      {result ? <Alert severity={result.severity}>{result.text}</Alert> : null}
    </Stack>
  )
}
