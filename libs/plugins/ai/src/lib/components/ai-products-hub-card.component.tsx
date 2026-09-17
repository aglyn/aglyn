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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsoleProductsHubZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_PRODUCTS_BULK_MAX,
  AI_PRODUCTS_IMPORT_WRITE_COPY,
  aiProductsBulkBrief,
  aiProductsBulkCount,
  aiProductsJobInputs,
  aiProductsProposalOfKind,
} from '../model/ai-products'
import { AiBulkCopyReview, AiCatalogReview, AiCategoriesReview } from './ai-products-proposals.component'
import { useAiProductsJobs } from './use-ai-products-jobs'

/**
 * Commerce by AI on the products hub (AGL-2916), through the `productsHub`
 * zone. Three things a person asks for, each a `products` job, and each
 * proposal reviewed in a table before anything is written:
 *
 * - **Write copy for products** — up to 50 saved products, picked from the
 *   hub's rows; a job works through them a product at a time, and each row is
 *   applied on its own or all at once.
 * - **Propose products** — a store's first products from a brief, created as
 *   drafts with their prices empty and no photo, both marked for the person to
 *   set.
 * - **Propose categories and discounts** — from a brief, created as the
 *   catalog and discounts cards create them, every discount switched off.
 *
 * An import whose `productImport` option asked for it starts a copy job for
 * the products the import created, as they land. Every write is the hub's
 * (`ConsoleProductsHubZoneProps`); this card writes nothing itself.
 */

const BRIEF_MAX_CHARS = 4_000

type BriefKind = 'catalog' | 'categories'

/** What each brief dialog says. */
export const AI_PRODUCTS_BRIEF_COPY: Readonly<
  Record<BriefKind, { title: string; label: string; placeholder: string; next: string; submit: string }>
> = {
  catalog: {
    title: 'Propose products',
    label: 'What does the store sell?',
    placeholder: 'A candle studio in Asheville: hand-poured soy candles in 8 oz and 16 oz jars, and wax melts',
    next:
      'You review up to twelve proposed products before any is created. Each is created as a draft with its ' +
      'price left empty and no photo, and nothing is on your storefront until you price it and activate it.',
    submit: 'Propose products',
  },
  categories: {
    title: 'Propose categories and discounts',
    label: 'What should shoppers be able to browse, and what offers suit the store?',
    placeholder: 'A trail running shop: shoes, apparel and hydration packs, with a welcome offer for new runners',
    next:
      'You review the proposed categories and discounts before any is created. Discounts are created switched ' +
      'off, and a shopper sees none until you switch it on.',
    submit: 'Propose',
  },
}

const nameKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase()

/** Which card a `products` job belongs to: from what it proposed, or from what this card started. */
function targetOf(job: AiJobSummary, started: Readonly<Record<string, string>>): string | null {
  if (started[job.id]) return started[job.id]
  if (aiProductsBulkCount(job) !== null) return 'bulk'
  if (aiProductsProposalOfKind(job, 'catalog')) return 'catalog'
  if (aiProductsProposalOfKind(job, 'categories')) return 'categories'
  return null
}

export function AiProductsHubCard(props: ConsoleProductsHubZoneProps) {
  const { hostId, products, lastImport, applyProductCopy, createProductDrafts, createCategories, createDiscountDrafts } =
    props
  const { orgId, verdict, jobs, notice, start } = useAiProductsJobs({
    hostId,
    orgId: props.orgId,
    // A bulk job is known by its brief while it runs; a catalog or categories
    // job started elsewhere is shown once it has proposed.
    follows: (job) => aiProductsBulkCount(job) !== null,
  })
  const [started, setStarted] = useState<Record<string, string>>({})
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [brief, setBrief] = useState<{ kind: BriefKind; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const handledImports = useRef(new Set<string>())

  const startBulk = useCallback(
    async (productIds: readonly string[]) => {
      const ids = productIds.slice(0, AI_PRODUCTS_BULK_MAX)
      if (!ids.length) return false
      const job = await start(aiProductsBulkBrief(ids.length), aiProductsJobInputs({ target: 'bulk', productIds: [...ids] }))
      if (job) setStarted((current) => ({ ...current, [job.id]: 'bulk' }))
      return Boolean(job)
    },
    [start],
  )

  // An import that asked for its copy starts the job once, as the import lands.
  useEffect(() => {
    if (verdict !== 'ready' || !lastImport || handledImports.current.has(lastImport.key)) return
    handledImports.current.add(lastImport.key)
    if (lastImport.options[AI_PRODUCTS_IMPORT_WRITE_COPY] && lastImport.productIds.length) {
      void startBulk(lastImport.productIds)
    }
  }, [verdict, lastImport, startBulk])

  const heldNames = useMemo(() => new Set(products.map((product) => nameKey(product.name))), [products])
  const pickerRows = useMemo(
    () =>
      products.map((product) => ({
        $id: product.id,
        name: product.name,
        status: product.status,
        photo: product.hasPhoto ? 'Yes' : 'No photo',
      })),
    [products],
  )
  const pickerColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'name', headerName: 'Product', flex: 1, minWidth: 180 },
      { field: 'status', headerName: 'Status', width: 110 },
      { field: 'photo', headerName: 'Photo', width: 110 },
    ],
    [],
  )

  if (verdict !== 'ready') return null

  const latest = (target: string) => jobs.find((job) => targetOf(job, started) === target) ?? null
  const bulkJob = latest('bulk')
  const catalogJob = latest('catalog')
  const categoriesJob = latest('categories')
  const tooMany = picked.length > AI_PRODUCTS_BULK_MAX
  const help = pluginDocsHelp('aiProducts', {
    excerpt:
      'Write product copy, propose a first catalog, or propose categories and discounts from a brief. You review every proposal before anything is saved.',
  })
  const copy = brief ? AI_PRODUCTS_BRIEF_COPY[brief.kind] : null

  const submitBrief = async () => {
    if (!brief?.text.trim()) return
    setBusy(true)
    try {
      const job = await start(brief.text.trim(), aiProductsJobInputs({ target: brief.kind }))
      if (job) {
        setStarted((current) => ({ ...current, [job.id]: brief.kind }))
        setBrief(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitPicked = async () => {
    setBusy(true)
    try {
      if (await startBulk(picked)) {
        setPicking(false)
        setPicked([])
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Products assistant">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Build your catalog with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button size="small" variant="outlined" disabled={!orgId || !products.length} onClick={() => setPicking(true)}>
            {'Write copy for products'}
          </Button>
          <Button size="small" variant="outlined" disabled={!orgId} onClick={() => setBrief({ kind: 'catalog', text: '' })}>
            {'Propose products'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={!orgId}
            onClick={() => setBrief({ kind: 'categories', text: '' })}
          >
            {'Propose categories and discounts'}
          </Button>
        </Stack>
        {notice ? <Alert severity="warning">{notice}</Alert> : null}
        {bulkJob ? (
          <AiBulkCopyReview key={bulkJob.id} job={bulkJob} applyProductCopy={applyProductCopy} />
        ) : null}
        {catalogJob ? (
          <AiCatalogReview
            key={catalogJob.id}
            job={catalogJob}
            heldNames={heldNames}
            createProductDrafts={createProductDrafts}
          />
        ) : null}
        {categoriesJob ? (
          <AiCategoriesReview
            key={categoriesJob.id}
            job={categoriesJob}
            createCategories={createCategories}
            createDiscountDrafts={createDiscountDrafts}
          />
        ) : null}
      </Stack>

      <Dialog open={picking} onClose={busy ? undefined : () => setPicking(false)} fullWidth maxWidth="md">
        <DialogTitle>{'Write copy for products'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {`Pick up to ${AI_PRODUCTS_BULK_MAX} products. Each gets a proposed description, search listing and ` +
                'tags from its name, text, options and first photo, and you review every one before it is saved. ' +
                'Prices are never written.'}
            </Typography>
            <ListTable
              rows={pickerRows}
              columns={pickerColumns}
              quickFilter={false}
              selectable={{ selected: picked, onChange: setPicked }}
            />
            {tooMany ? (
              <Alert severity="info">{`Pick at most ${AI_PRODUCTS_BULK_MAX} products at a time.`}</Alert>
            ) : null}
            {notice ? <Alert severity="warning">{notice}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPicking(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy || !picked.length || tooMany} onClick={() => void submitPicked()}>
            {picked.length ? `Write copy for ${picked.length}` : 'Write copy'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(brief)} onClose={busy ? undefined : () => setBrief(null)} fullWidth maxWidth="sm">
        <DialogTitle>{copy?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={copy?.label}
              placeholder={copy?.placeholder}
              multiline
              minRows={4}
              value={brief?.text ?? ''}
              onChange={(event) =>
                setBrief((current) => (current ? { ...current, text: event.target.value.slice(0, BRIEF_MAX_CHARS) } : current))
              }
              helperText={`${(brief?.text.length ?? 0).toLocaleString('en-US')} / ${BRIEF_MAX_CHARS.toLocaleString('en-US')}`}
              disabled={busy}
              autoFocus
            />
            <Typography variant="body2" color="text.secondary">
              {copy?.next}
            </Typography>
            {brief?.kind === 'catalog' ? (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" color="warning" variant="outlined" label="Prices stay empty" />
                <Chip size="small" color="warning" variant="outlined" label="Photos are yours to add" />
              </Stack>
            ) : null}
            {notice ? <Alert severity="warning">{notice}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrief(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy || !orgId || !brief?.text.trim()} onClick={() => void submitBrief()}>
            {copy?.submit}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
AiProductsHubCard.displayName = 'AiProductsHubCard'

export default AiProductsHubCard
