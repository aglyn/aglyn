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

import { mdiArrowLeft, mdiImageOutline, mdiMagnify } from '@mdi/js'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  InputAdornment,
  LinearProgress,
  Link,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type Theme,
} from '@mui/material'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import EmptyStateComponent from './empty-state.component'
import { MdiIcon } from './mdi-icon'

/**
 * SEARCH A STOCK PHOTO LIBRARY AND CHOOSE ONE (AGL-4066): the media picker's
 * Stock photos tab, and the details of the photo chosen.
 *
 * Presentation only. What a search asks and where a photo goes are the
 * caller's: it hands in a {@link StockPhotoSearchClient} (the console binds
 * its route and the member's credentials) and receives the photo clicked,
 * which it places the way it places a library file. Every result shows its
 * photographer and the library it comes from, since a library's terms ask
 * that its results say where they are from.
 *
 * Thumbnails arrive as image bytes from the caller's server and are shown
 * through object URLs this component owns, so no address at the library is
 * ever loaded by the browser; it fetches them a few at a time, only for the
 * results on screen.
 */

/** The shapes the search offers. */
export type StockPhotoSearchOrientation = 'any' | 'horizontal' | 'vertical'

/** One result, as much of it as this shows. */
export interface StockPhotoSearchHit {
  /** What the caller names the photo by when it asks for its preview. */
  ref: unknown
  /** Unique among the results. */
  sourceKey: string
  width: number
  height: number
  photographer: string
  tags: string[]
  alt?: string
}

/** The details panel's further facts about a result. */
export interface StockPhotoDetailsHit extends StockPhotoSearchHit {
  photographerUrl?: string
  pageUrl: string
  /** "Photo by … on …". */
  credit: string
  license: string
  licenseUrl: string
}

type Refusal = { status: 'busy' | 'unconfigured' | 'refused' | 'gone'; message: string }

/** What the caller's client answers. */
export interface StockPhotoSearchClient<Hit extends StockPhotoSearchHit> {
  status(): Promise<{ status: 'ready'; library: { label: string } } | Refusal>
  search(
    query: string,
    orientation: StockPhotoSearchOrientation,
  ): Promise<{ status: 'ok'; library: { label: string }; hits: Hit[] } | Refusal>
  preview(ref: Hit['ref']): Promise<Blob | null>
}

export interface StockPhotoSearchPanelProps<Hit extends StockPhotoSearchHit> {
  client: StockPhotoSearchClient<Hit>
  /** Where a used photo is saved, as a sentence ends: "this site's library". */
  libraryName: string
  /** The longest search the library takes. */
  maxQueryLength: number
  /** The result currently chosen. */
  selectedKey?: string | null
  /** A result was clicked; `previewUrl` is its thumbnail, when it has loaded. */
  onSelect: (hit: Hit, context: { previewUrl: string | null; libraryLabel: string }) => void
}

/** Results shown at first, and added by each Show more. */
export const STOCK_PHOTO_SEARCH_PAGE = 20
/** Previews fetched at once. */
const PREVIEWS_AT_ONCE = 4
/** Skeleton tiles while a search runs. */
const SKELETON_TILES = 12

const ORIENTATION_LABELS: ReadonlyArray<[StockPhotoSearchOrientation, string]> = [
  ['any', 'Any'],
  ['horizontal', 'Landscape'],
  ['vertical', 'Portrait'],
]

/** The grid every state of the results lays out in. */
const gridSx = (theme: Theme) => ({
  display: 'grid',
  gap: theme.spacing(2),
  gridTemplateColumns: `repeat(auto-fill, minmax(${theme.spacing(20)}, 1fr))`,
})

/** A result's tile: the thumbnail, the photographer and the library. */
function StockPhotoTile(props: {
  hit: StockPhotoSearchHit
  previewUrl: string | null | undefined
  libraryLabel: string
  selected: boolean
  onClick: () => void
}) {
  const { hit, previewUrl, libraryLabel, selected, onClick } = props
  const described = hit.alt || hit.tags.slice(0, 3).join(', ')
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Photo by ${hit.photographer} on ${libraryLabel}${described ? `: ${described}` : ''}`}
      data-testid="stock-photo-tile"
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        borderRadius: 1,
        overflow: 'hidden',
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? `0 0 0 1px ${theme.palette.primary.main}` : 'none',
        bgcolor: 'background.paper',
        transition: theme.transitions.create(['border-color', 'box-shadow']),
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.primary' },
        '&.Mui-focusVisible': { outline: `${theme.spacing(0.25)} solid ${theme.palette.primary.main}`, outlineOffset: theme.spacing(0.25) },
      })}
    >
      <Box sx={{ aspectRatio: '4 / 3', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
        {previewUrl ? (
          <Box component="img" src={previewUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : previewUrl === null ? (
          <MdiIcon path={mdiImageOutline} fontSize="large" />
        ) : (
          <Skeleton variant="rectangular" sx={{ width: '100%', height: '100%' }} />
        )}
      </Box>
      <Box sx={{ px: 1, py: 0.75, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {hit.photographer}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {libraryLabel}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

type SearchState<Hit> =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'results'; query: string; hits: Hit[] }
  | { kind: 'refused'; refusal: Refusal; query: string }

/**
 * The Stock photos tab: a search box, the shape, and the results. Asks the
 * client for its status once, on mount, so a deployment with no library, or
 * a member who cannot add files here, is told so before typing anything.
 */
export function StockPhotoSearchPanel<Hit extends StockPhotoSearchHit>(props: StockPhotoSearchPanelProps<Hit>) {
  const { client, libraryName, maxQueryLength, selectedKey, onSelect } = props
  const [status, setStatus] = useState<{ status: 'loading' } | Awaited<ReturnType<StockPhotoSearchClient<Hit>['status']>>>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [orientation, setOrientation] = useState<StockPhotoSearchOrientation>('any')
  const [search, setSearch] = useState<SearchState<Hit>>({ kind: 'idle' })
  const [shown, setShown] = useState(STOCK_PHOTO_SEARCH_PAGE)
  const [previews, setPreviews] = useState<Record<string, string | null>>({})
  const owned = useRef<Map<string, string | null>>(new Map())
  const asked = useRef<Set<string>>(new Set())
  const latest = useRef(0)

  useEffect(() => {
    let live = true
    setStatus({ status: 'loading' })
    client.status().then((answer) => {
      if (live) setStatus(answer)
    })
    return () => {
      live = false
    }
  }, [client])

  // The object URLs are this component's: let them go with it.
  useEffect(() => {
    const urls = owned.current
    return () => {
      for (const url of urls.values()) if (url) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const libraryLabel = status.status === 'ready' ? status.library.label : ''

  const run = useCallback(
    async (words: string, shape: StockPhotoSearchOrientation) => {
      const trimmed = words.replace(/\s+/g, ' ').trim()
      if (!trimmed) return
      const ticket = ++latest.current
      setSearch({ kind: 'searching', query: trimmed })
      setShown(STOCK_PHOTO_SEARCH_PAGE)
      const answer = await client.search(trimmed, shape)
      if (ticket !== latest.current) return
      setSearch(answer.status === 'ok' ? { kind: 'results', query: trimmed, hits: answer.hits } : { kind: 'refused', refusal: answer, query: trimmed })
    },
    [client],
  )

  const visible = search.kind === 'results' ? search.hits.slice(0, shown) : []

  // Previews for the results on screen, a few at a time, each asked once.
  useEffect(() => {
    let live = true
    const queue = visible.filter((hit) => !asked.current.has(hit.sourceKey))
    const next = async (): Promise<void> => {
      const hit = queue.shift()
      if (!hit || !live) return
      asked.current.add(hit.sourceKey)
      const blob = await client.preview(hit.ref)
      if (!live) {
        // Superseded: the next run asks for it again, for the results then on screen.
        asked.current.delete(hit.sourceKey)
        return
      }
      const url = blob ? URL.createObjectURL(blob) : null
      owned.current.set(hit.sourceKey, url)
      setPreviews((held) => ({ ...held, [hit.sourceKey]: url }))
      return next()
    }
    void Promise.all(Array.from({ length: PREVIEWS_AT_ONCE }, next))
    return () => {
      live = false
    }
    // `visible` is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, search, shown])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(query, orientation)
  }

  if (status.status === 'loading') {
    return <LinearProgress aria-label="Loading stock photos" />
  }
  if (status.status !== 'ready') {
    return (
      <Alert severity={status.status === 'refused' ? 'warning' : 'info'} data-testid="stock-photos-unavailable">
        {status.message}
      </Alert>
    )
  }

  return (
    <Stack spacing={2} data-testid="stock-photo-search">
      <Box component="form" role="search" onSubmit={submit} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, maxQueryLength))}
          placeholder={`Search ${libraryLabel} photos`}
          slotProps={{
            htmlInput: { maxLength: maxQueryLength, 'aria-label': `Search ${libraryLabel} photos` },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MdiIcon path={mdiMagnify} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1, minWidth: (theme) => theme.spacing(25) }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={orientation}
          aria-label="Photo shape"
          onChange={(_event, value: StockPhotoSearchOrientation | null) => {
            if (!value) return
            setOrientation(value)
            if (search.kind !== 'idle') void run(search.query, value)
          }}
        >
          {ORIENTATION_LABELS.map(([value, label]) => (
            <ToggleButton key={value} value={value}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button type="submit" variant="contained" disabled={!query.trim() || search.kind === 'searching'}>
          {'Search'}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {`Photos come from ${libraryLabel}. The one you use is saved to ${libraryName} with the photographer's credit.`}
      </Typography>
      {search.kind === 'idle' ? (
        <EmptyStateComponent
          label="Find a photo for your page"
          description="Describe what the photo should show, such as a coffee shop counter or a mountain lake, then choose Search."
        />
      ) : search.kind === 'searching' ? (
        <Box sx={gridSx} aria-busy="true" aria-label="Searching">
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <Skeleton key={index} variant="rectangular" sx={{ aspectRatio: '4 / 3', height: 'auto', borderRadius: 1 }} />
          ))}
        </Box>
      ) : search.kind === 'refused' ? (
        <Alert
          severity={search.refusal.status === 'refused' ? 'warning' : 'info'}
          action={
            search.refusal.status === 'busy' ? (
              <Button color="inherit" size="small" onClick={() => void run(search.query, orientation)}>
                {'Try again'}
              </Button>
            ) : undefined
          }
        >
          {search.refusal.message}
        </Alert>
      ) : search.hits.length === 0 ? (
        <EmptyStateComponent label={`No photos found for “${search.query}”`} description="Try fewer words, or describe it differently." />
      ) : (
        <>
          <Box sx={gridSx}>
            {visible.map((hit) => (
              <StockPhotoTile
                key={hit.sourceKey}
                hit={hit}
                previewUrl={previews[hit.sourceKey]}
                libraryLabel={libraryLabel}
                selected={hit.sourceKey === selectedKey}
                onClick={() => onSelect(hit, { previewUrl: previews[hit.sourceKey] ?? null, libraryLabel })}
              />
            ))}
          </Box>
          {search.hits.length > shown ? (
            <Button onClick={() => setShown((count) => count + STOCK_PHOTO_SEARCH_PAGE)} sx={{ alignSelf: 'center' }}>
              {'Show more photos'}
            </Button>
          ) : null}
        </>
      )}
    </Stack>
  )
}

export interface StockPhotoDetailsProps {
  hit: StockPhotoDetailsHit
  previewUrl: string | null
  /** The library's name: "Pixabay". */
  libraryLabel: string
  /** Where using the photo saves it, as a sentence ends: "this site's library". */
  libraryName: string
  /** Why using it failed, said above the facts. */
  error?: string | null
  /** Small screens, where the details replace the results: back to them. */
  onBack?: () => void
}

/** A caption over one fact. */
const Label = ({ children }: { children: string }) => (
  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
    {children}
  </Typography>
)

/** An outside page, opened in a new tab. */
const OutLink = ({ href, children }: { href: string; children: string }) => (
  <Link href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </Link>
)

/**
 * The stock photo clicked, before it is used: a larger look, who took it,
 * the license and where it will be saved. Nothing is copied until the
 * caller's confirm button is pressed.
 */
export function StockPhotoDetails(props: StockPhotoDetailsProps) {
  const { hit, previewUrl, libraryLabel, libraryName, error, onBack } = props
  return (
    <Stack spacing={2} data-testid="stock-photo-details">
      {onBack ? (
        <Button size="small" startIcon={<MdiIcon path={mdiArrowLeft} />} onClick={onBack} sx={{ alignSelf: 'flex-start' }}>
          {'Back to photos'}
        </Button>
      ) : null}
      <Box
        sx={{
          aspectRatio: `${hit.width} / ${hit.height}`,
          maxHeight: (theme) => theme.spacing(30),
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.disabled',
        }}
      >
        {previewUrl ? (
          <Box component="img" src={previewUrl} alt={hit.alt || `Photo by ${hit.photographer}`} sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <MdiIcon path={mdiImageOutline} fontSize="large" />
        )}
      </Box>
      <Typography variant="subtitle1" component="h3">
        {hit.photographerUrl ? (
          <>
            {'Photo by '}
            <OutLink href={hit.photographerUrl}>{hit.photographer}</OutLink>
          </>
        ) : (
          `Photo by ${hit.photographer}`
        )}
      </Typography>
      {error ? <Alert severity="warning">{error}</Alert> : null}
      <Box>
        <Label>{'Credit saved with the photo'}</Label>
        <Typography variant="body2">{hit.credit}</Typography>
      </Box>
      <Box>
        <Label>{'License'}</Label>
        <Typography variant="body2">
          {hit.licenseUrl ? <OutLink href={hit.licenseUrl}>{hit.license}</OutLink> : hit.license}
        </Typography>
      </Box>
      <Box>
        <Label>{'Size'}</Label>
        <Typography variant="body2">{`${hit.width} × ${hit.height} pixels`}</Typography>
      </Box>
      <Typography variant="body2">
        <OutLink href={hit.pageUrl}>{`See it on ${libraryLabel}`}</OutLink>
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`When you use it, a copy is saved to ${libraryName} and placed from there. If the library already has this photo, that copy is used.`}
      </Typography>
    </Stack>
  )
}
