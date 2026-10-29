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

import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import type { SiteStarterFacets } from '@aglyn/aglyn/app-utils/site-starter'
import type { ConsoleHostStarterPickerZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { SiteStarterSummary } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { mdiWeb } from '@aglyn/shared-data-mdi'
import {
  OptionCardGrid,
  type OptionCard,
  type OptionCardChip,
  type OptionCardImage,
} from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
import { Alert, Box, Button, LinearProgress, Skeleton, Stack } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStarterSearch } from '../hooks/use-starter-search'
import { starterCardFacts, type StarterCardFact } from '../model/starter-query'

/**
 * A starter's preview as the card draws it: the size the platform's own
 * style previews are rendered at (square), so a row of cards stays level and
 * a publisher's picture is cropped to the same shape from its top.
 */
const PREVIEW_SIZE = { width: 800, height: 800 } as const

/** How many placeholder cards stand in for the first answer. */
const PLACEHOLDER_CARDS = 3

/** Statuses that mean this workspace may not have starters offered here: the dialog's own choice instead. */
const REFUSED = new Set([401, 403, 503])

/** How each fact's chip is colored, from the theme: the price as the marketplace's own cards color it. */
function chipOf(fact: StarterCardFact, row: SiteStarterSummary): OptionCardChip {
  switch (fact.key) {
    case 'price':
      return row.priceUsd > 0
        ? { label: fact.label, color: 'primary', variant: 'filled' }
        : { label: fact.label, color: 'success', variant: 'outlined' }
    case 'official':
      return { label: fact.label, color: 'primary', variant: 'outlined' }
    case 'ai':
      return { label: fact.label, color: 'secondary', variant: 'outlined' }
    default:
      return { label: fact.label }
  }
}

/** The picture a card draws, resolved the way the listing's own pages resolve it. */
function previewOf(row: SiteStarterSummary): OptionCardImage | null {
  const src = resolveMediaSrc(row.previewImageUrl)
  if (!src) return null
  return { src, alt: `A preview of ${row.displayName || 'this starter'}`, ...PREVIEW_SIZE }
}

/** One starter as a card in the shared option grid. */
function cardOf(row: SiteStarterSummary): OptionCard {
  const image = previewOf(row)
  return {
    id: row.listingId,
    title: row.displayName || 'Untitled starter',
    ...(row.authorName ? { description: `By ${row.authorName}` } : {}),
    ...(image ? { image } : { icon: mdiWeb.path }),
    chips: starterCardFacts(row).map((fact) => chipOf(fact, row)),
  }
}

const narrowed = (filter: Partial<SiteStarterFacets>): boolean =>
  (['kind', 'base', 'fonts'] as const).some((key) => typeof filter[key] === 'string' && filter[key] !== '')

/** What an answer with no starters says, in the words of what was asked. */
function emptyMessage(props: ConsoleHostStarterPickerZoneProps): string {
  if (props.search.trim()) return 'No starters match — try fewer words'
  if (narrowed(props.filter ?? {})) return 'No starters match these choices — try another'
  return props.mode === 'ai' ? 'No AI starters yet' : 'No starters yet'
}

/**
 * The marketplace's starters in "Choose your starter" (AGL-4049): the
 * `hostStarterPicker` zone, drawn before the site exists.
 *
 * Lists what the dialog asks for — its mode, its search words and its
 * filters — as cards of the shared option grid: a picture, the name, who made
 * it, and its price, kind, page count and the "AI" and "Aglyn" marks as
 * chips. NOTHING is selected when it opens; a person picks, and the pick goes
 * to the dialog through `onPick`. It creates nothing: the dialog creates the
 * site from the starter it was handed.
 *
 * `ready` tells the dialog whether a picker is on screen. The first answer
 * decides: starters, or a search that found none (its empty state is a
 * picker with nothing in it yet), answer `true`; a workspace refused the
 * starters (no permission, the release flag off, no source) or a catalog with
 * nothing in it answers `false`, and the dialog offers its own choice
 * instead. Once shown, a later refusal hands back the same way; a later
 * failure is said here with a way to ask again.
 */
export function StarterPickerShelf(props: ConsoleHostStarterPickerZoneProps) {
  const { orgId, mode, search, filter, onPick, ready } = props
  const found = useStarterSearch({ orgId, mode, word: search, filter })
  const [picked, setPicked] = useState<string | null>(null)
  const [shown, setShown] = useState(false)

  const refused = found.error !== null && REFUSED.has(found.error.status)
  // `null` until the first answer, which is the only one that may decide
  // there is nothing to show; after that only a refusal takes it back.
  const verdict: boolean | null = !found.settled
    ? null
    : refused
      ? false
      : shown
        ? true
        : found.error
          ? false
          : found.rows.length > 0 || search.trim() !== '' || narrowed(filter ?? {})

  useEffect(() => {
    if (verdict === true) setShown(true)
    if (verdict === false) setShown(false)
  }, [verdict])

  // Each distinct verdict once, whatever identity the dialog's callback has.
  const readyRef = useRef(ready)
  readyRef.current = ready
  const reported = useRef<boolean | null>(null)
  useEffect(() => {
    if (verdict === null || reported.current === verdict) return
    reported.current = verdict
    readyRef.current(verdict)
  }, [verdict])

  const options = useMemo(() => found.rows.map(cardOf), [found.rows])

  if (verdict === false) return null
  if (verdict === null) {
    return (
      <Box
        aria-busy
        aria-label="Loading starters"
        sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}
      >
        {Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
          <Skeleton key={index} variant="rounded" sx={{ height: 'auto', aspectRatio: '1 / 1', borderRadius: 2 }} />
        ))}
      </Box>
    )
  }

  return (
    <Stack spacing={2} data-starter-shelf={mode}>
      {found.loading ? <LinearProgress aria-label="Searching starters" /> : null}
      {found.error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={found.refresh}>
              {'Try again'}
            </Button>
          }
        >
          {found.error.message}
        </Alert>
      ) : options.length === 0 ? (
        // TODO(AGL-4049 phase 3 lane 3): link the site starters docs page
        // here once it is written.
        <Alert severity="info">{emptyMessage(props)}</Alert>
      ) : (
        <OptionCardGrid
          label={mode === 'ai' ? 'AI starters' : 'Starters'}
          options={options}
          value={picked}
          columns={{ xs: 1, sm: 2, md: 3 }}
          onChange={(listingId) => {
            const row = found.rows.find((candidate) => candidate.listingId === listingId)
            if (!row) return
            setPicked(listingId)
            onPick(row)
          }}
        />
      )}
    </Stack>
  )
}

export default StarterPickerShelf
