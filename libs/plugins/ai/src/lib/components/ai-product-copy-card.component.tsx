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
import { seoListingFieldCount, seoListingFieldTooLong } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type {
  ConsoleProductCopyValues,
  ConsoleProductEditorZoneProps,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { Alert, Box, Button, Chip, CircularProgress, Link, Stack, Typography } from '@mui/material'
import { useCallback, useState, type ReactNode } from 'react'
import {
  aiProductCopyProposals,
  aiProductsJobInputs,
  type AiProductCopyProposal,
} from '../model/ai-products'
import { isAiJobMoving, useAiProductsJobs } from './use-ai-products-jobs'

/**
 * "Write with AI" in the commerce product editor (AGL-2916), through the
 * `productEditor` zone. A `products` job writes the product's description,
 * search listing, tags, categories and clearer option names from what the
 * editor holds: its name, text, tags and options, and its first photo for a
 * model that reads pictures. The proposal is shown in full, with any fact the
 * copy could not know marked for the person to fill in, and "Put in the
 * fields" stages it in the editor as unsaved changes. Save product is the
 * write; this card never writes a product.
 */

/** The brief a product copy job carries, which the jobs list shows. */
export const aiProductCopyBrief = (name: string) => `Write the storefront copy for ${name.trim()}`

/** The values a proposal stages, in the editor's terms. */
export function aiProductCopyValues(proposal: AiProductCopyProposal): ConsoleProductCopyValues {
  const values = proposal.values
  if (!values) return {}
  return {
    description: values.description,
    tags: values.tags,
    categoryIds: values.categoryIds,
    seoTitle: values.seoTitle,
    seoDescription: values.seoDescription,
    ...(values.optionNames.length ? { optionNames: values.optionNames } : {}),
  }
}

function Field(props: { label: string; children: ReactNode; count?: ReactNode }) {
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {props.label}
        </Typography>
        {props.count}
      </Stack>
      {props.children}
    </Stack>
  )
}

/** The proposed copy, field by field. */
export function AiProductCopyProposalView(props: { proposal: AiProductCopyProposal }) {
  const { proposal } = props
  const values = proposal.values
  if (!values) return null
  const renamed = values.optionNames
    .map((name, index) => ({ before: proposal.optionNamesBefore[index] ?? '', after: name }))
    .filter((pair) => pair.before !== pair.after)
  return (
    <Stack spacing={1}>
      <Field label="Description">
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {values.description}
        </Typography>
      </Field>
      {values.tags.length ? (
        <Field label="Tags">
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {values.tags.map((tag) => (
              <Chip key={tag} size="small" variant="outlined" label={tag} />
            ))}
          </Stack>
        </Field>
      ) : null}
      {proposal.categories.length ? (
        <Field label="Categories">
          <Typography variant="body2">{proposal.categories.map((category) => category.name).join(', ')}</Typography>
        </Field>
      ) : null}
      {renamed.length ? (
        <Field label="Option names">
          <Typography variant="body2">
            {renamed.map((pair) => `${pair.before || 'Unnamed'} → ${pair.after}`).join(', ')}
          </Typography>
        </Field>
      ) : null}
      <Field
        label="Search title"
        count={
          <Chip
            size="small"
            variant="outlined"
            color={seoListingFieldTooLong('title', values.seoTitle) ? 'error' : 'default'}
            label={seoListingFieldCount('title', values.seoTitle)}
          />
        }
      >
        <Typography variant="body2">{values.seoTitle}</Typography>
      </Field>
      <Field
        label="Search description"
        count={
          <Chip
            size="small"
            variant="outlined"
            color={seoListingFieldTooLong('description', values.seoDescription) ? 'error' : 'default'}
            label={seoListingFieldCount('description', values.seoDescription)}
          />
        }
      >
        <Typography variant="body2">{values.seoDescription}</Typography>
      </Field>
      {proposal.gaps.length ? (
        <Alert severity="warning">
          {`Fill in what the copy could not know before you save: ${proposal.gaps.map((gap) => `[${gap}]`).join(', ')}.`}
        </Alert>
      ) : null}
      {proposal.notes.map((note) => (
        <Typography key={note} variant="caption" color="text.secondary">
          {note}
        </Typography>
      ))}
    </Stack>
  )
}

export function AiProductCopyCard(props: ConsoleProductEditorZoneProps) {
  const { hostId, product, proposeValues } = props
  const { orgId, verdict, jobs, notice, start } = useAiProductsJobs({
    hostId,
    orgId: props.orgId,
    follows: (job) => job.brief === aiProductCopyBrief(product.name),
  })
  const [startedId, setStartedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState<string | null>(null)

  const write = useCallback(async () => {
    setBusy(true)
    setStaged(null)
    try {
      const job = await start(
        aiProductCopyBrief(product.name),
        aiProductsJobInputs({
          target: 'product',
          product: {
            id: product.id,
            name: product.name,
            type: product.type,
            text: product.description,
            tags: product.tags,
            categoryIds: product.categoryIds,
            options: product.options,
            imageUrl: product.mediaUrls[0] ?? null,
            seoTitle: product.seoTitle,
            seoDescription: product.seoDescription,
          },
        }),
      )
      if (job) setStartedId(job.id)
    } finally {
      setBusy(false)
    }
  }, [start, product])

  if (verdict !== 'ready') return null

  // The job this card started, or the latest one that wrote this saved product's copy.
  const job = startedId
    ? (jobs.find((entry) => entry.id === startedId) ?? null)
    : product.id
      ? (jobs.find((entry) => aiProductCopyProposals(entry).some((proposal) => proposal.product.id === product.id)) ??
        null)
      : null
  const proposal = job
    ? (aiProductCopyProposals(job).find((entry) => entry.product.id === product.id) ?? aiProductCopyProposals(job)[0] ?? null)
    : null
  const running = isAiJobMoving(job)
  const unnamed = !product.name.trim()
  const help = pluginDocsHelp('aiProducts', {
    excerpt:
      'Write a product’s description, search listing and tags from what it says and shows. It is put in the fields as unsaved changes; nothing is saved until you save.',
  })

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Product copy assistant">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Write with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {'Writes the description, search listing and tags, suggests categories and clearer option names, ' +
            'from the product’s name, text, tags and options and its first photo. Prices are never written.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" disabled={busy || running || unnamed || !orgId} onClick={() => void write()}>
            {proposal ? 'Write again' : 'Write copy'}
          </Button>
          {busy || running ? <CircularProgress size={16} aria-label="Writing the copy" /> : null}
          {unnamed ? (
            <Typography variant="caption" color="text.secondary">
              {'Name the product first.'}
            </Typography>
          ) : null}
        </Stack>
        {notice ? <Alert severity="warning">{notice}</Alert> : null}
        {job?.error && !proposal?.values ? (
          <Alert severity={job.status === 'failed' ? 'error' : 'warning'}>{job.error}</Alert>
        ) : null}
        {proposal?.skipped ? <Alert severity="info">{proposal.skipped}</Alert> : null}
        {proposal?.values && job ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Proposed copy'}</Typography>
            <AiProductCopyProposalView proposal={proposal} />
            <Button
              size="small"
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              disabled={staged === job.id}
              onClick={() => {
                proposeValues(aiProductCopyValues(proposal), job.id)
                setStaged(job.id)
              }}
            >
              {'Put in the fields'}
            </Button>
          </Stack>
        ) : null}
        {staged ? (
          <Alert severity="success">{'In the fields as unsaved changes. Review them, then press Save product.'}</Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
AiProductCopyCard.displayName = 'AiProductCopyCard'

export default AiProductCopyCard
