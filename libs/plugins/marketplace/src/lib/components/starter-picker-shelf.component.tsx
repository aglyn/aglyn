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
import {
  Alert,
  Box,
  Button,
  Link,
  LinearProgress,
  Skeleton,
  Stack,
  type SxProps,
  type Theme,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStarterAnswers } from '../hooks/use-starter-answers'
import { useStarterPurchase } from '../hooks/use-starter-purchase'
import { useStarterSearch } from '../hooks/use-starter-search'
import { starterCardFacts, starterPriceLabel, type StarterCardFact } from '../model/starter-query'

/**
 * What a picked starter's price or licence says, held at the foot of the
 * visible cards while the shelf is in view, so "Buy and continue" is beside
 * whichever card was clicked rather than below all of them.
 */
const PICK_NOTE_SX: SxProps<Theme> = {
  position: 'sticky',
  bottom: (theme) => theme.spacing(2),
  zIndex: 1,
  boxShadow: 3,
}

/** The guide to site starters, linked from what the shelf says when it has nothing to show. */
const STARTERS_HELP = pluginDocsHelp('siteStarters')

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

/** A row with what the dialog or a purchase knows about owning it laid over the search's answer. */
const ownedOf = (row: SiteStarterSummary, override: boolean | undefined): boolean =>
  override ?? row.owned === true

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
 * it, and its price, kind, page count and the "AI" and platform marks as
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
 *
 * A picked starter with a price the workspace has not paid says so under
 * the cards, with "Buy and continue": the marketplace's payment, which brings
 * the person back to Create site on the same pick. One it owns says that
 * instead. The dialog's own `selected` wins over the shelf's pick: it is how
 * a pick restored after paying is shown chosen, and how one the create
 * refused is cleared.
 *
 * An AI starter the workspace may use — free, owned, or just bought — has
 * the answers it carries read once it is picked (AGL-4049 phase 4), and
 * handed to the dialog with it (`onPick(pick, { answers })`), which goes on
 * to the AI start's questions with them. A priced one not yet bought is
 * never read: its answers are what it sells, and the door would ask payment
 * for them. A door that still asks is told back to the dialog as unowned.
 */
export function StarterPickerShelf(props: ConsoleHostStarterPickerZoneProps) {
  const { orgId, mode, search, filter, onPick, ready, selected } = props
  // The pick the dialog opened on, restored after paying for it: asked for
  // by every search from then on, so it is listed (first) wherever the
  // search would have put it, and never moves under the person's cursor.
  const [restored] = useState(() => selected?.listingId ?? null)
  const found = useStarterSearch({ orgId, mode, word: search, filter, include: restored })
  const [picked, setPicked] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  // Starters a purchase attempt found this workspace already owns.
  const [ownedHere, setOwnedHere] = useState<ReadonlySet<string>>(() => new Set())
  // AI starters whose answers the door still asked payment for (AGL-4049).
  const [unpaidHere, setUnpaidHere] = useState<ReadonlySet<string>>(() => new Set())
  const purchase = useStarterPurchase(orgId)
  const starterAnswers = useStarterAnswers(orgId)
  const value = selected !== undefined ? (selected?.listingId ?? null) : picked
  const pickedRow = value ? (found.rows.find((row) => row.listingId === value) ?? null) : null
  const ownedOverride = (row: SiteStarterSummary): boolean | undefined =>
    ownedHere.has(row.listingId)
      ? true
      : unpaidHere.has(row.listingId)
        ? false
        : selected?.listingId === row.listingId
          ? selected.owned
          : undefined

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

  // A pick the dialog restored is handed back once the shelf has read it,
  // so the dialog holds the starter as the search describes it.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const handedBack = useRef(false)
  useEffect(() => {
    if (!restored || handedBack.current || !pickedRow || pickedRow.listingId !== restored) return
    handedBack.current = true
    const override = ownedOverride(pickedRow)
    onPickRef.current(override === undefined ? pickedRow : { ...pickedRow, owned: override })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, pickedRow])

  // The picked AI starter's answers (AGL-4049), read once it is one the
  // workspace may use; keyed on the listing and whether it is owned, so a
  // purchase that makes it usable reads it, and nothing reads it twice.
  const pickedOwned = pickedRow ? ownedOf(pickedRow, ownedOverride(pickedRow)) : false
  const answersKey =
    pickedRow && pickedRow.facets.mode === 'ai' && (pickedRow.priceUsd <= 0 || pickedOwned)
      ? `${pickedRow.listingId}:${pickedOwned}`
      : null
  const [reading, setReading] = useState<{ key: string; failed: string | null } | null>(null)
  const [readAttempt, setReadAttempt] = useState(0)
  const askedAnswers = useRef<string | null>(null)
  useEffect(() => {
    if (!answersKey || !pickedRow || askedAnswers.current === answersKey) return
    askedAnswers.current = answersKey
    const row = pickedRow
    const override = ownedOverride(row)
    const handed = override === undefined ? row : { ...row, owned: override }
    setReading({ key: answersKey, failed: null })
    void starterAnswers.read(row.listingId).then((outcome) => {
      if (askedAnswers.current !== answersKey) return
      if (outcome.status === 'failed') return setReading({ key: answersKey, failed: outcome.message })
      setReading(null)
      if (outcome.status === 'ready') return onPickRef.current(handed, { answers: outcome.answers })
      setUnpaidHere((current) => new Set(current).add(row.listingId))
      onPickRef.current({ ...row, owned: false })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answersKey, readAttempt])
  const readingPicked = reading !== null && reading.key === answersKey ? reading : null
  const readAgain = () => {
    askedAnswers.current = null
    setReadAttempt((count) => count + 1)
  }

  const options = useMemo(() => found.rows.map(cardOf), [found.rows])

  const buy = async (row: SiteStarterSummary) => {
    const outcome = await purchase.buy(row.listingId)
    if (outcome !== 'owned') return
    setOwnedHere((current) => new Set(current).add(row.listingId))
    setUnpaidHere((current) => {
      const next = new Set(current)
      next.delete(row.listingId)
      return next
    })
    onPick({ ...row, owned: true })
  }

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
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              component={Link}
              href={STARTERS_HELP.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {'How starters work'}
            </Button>
          }
        >
          {emptyMessage(props)}
        </Alert>
      ) : (
        <OptionCardGrid
          label={mode === 'ai' ? 'AI starters' : 'Starters'}
          options={options}
          value={value}
          columns={{ xs: 1, sm: 2, md: 3 }}
          onChange={(listingId) => {
            const row = found.rows.find((candidate) => candidate.listingId === listingId)
            if (!row) return
            setPicked(listingId)
            const override = ownedOverride(row)
            onPick(override === undefined ? row : { ...row, owned: override })
          }}
        />
      )}
      {pickedRow && pickedRow.priceUsd > 0 ? (
        ownedOf(pickedRow, ownedOverride(pickedRow)) ? (
          <Alert severity="success" data-starter-owned={pickedRow.listingId} sx={PICK_NOTE_SX}>
            {'You own this starter. Create your site from it whenever you are ready.'}
          </Alert>
        ) : (
          <Alert
            severity="info"
            data-starter-buy={pickedRow.listingId}
            sx={PICK_NOTE_SX}
            action={
              <Button
                color="inherit"
                size="small"
                disabled={purchase.busy || !orgId}
                onClick={() => void buy(pickedRow)}
              >
                {purchase.busy ? 'Opening…' : 'Buy and continue'}
              </Button>
            }
          >
            {`${pickedRow.displayName || 'This starter'} costs ${starterPriceLabel(pickedRow.priceUsd)}. ` +
              'Buy it first; once paid, you come back here to create your site from it.'}
          </Alert>
        )
      ) : null}
      {purchase.error ? <Alert severity="error">{purchase.error}</Alert> : null}
      {readingPicked?.failed ? (
        <Alert
          severity="error"
          data-starter-answers-failed={pickedRow?.listingId}
          action={
            <Button color="inherit" size="small" onClick={readAgain}>
              {'Try again'}
            </Button>
          }
        >
          {readingPicked.failed}
        </Alert>
      ) : readingPicked ? (
        <LinearProgress aria-label="Reading this starter’s answers" />
      ) : null}
    </Stack>
  )
}

export default StarterPickerShelf
