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

import { mdiArrowLeft, mdiClose } from '@aglyn/shared-data-mdi'
import type { HostTheme, HostThemeFont } from '@aglyn/shared-data-types'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { DownloadCostBadge } from '@aglyn/shared-ui-jsx/components/download-cost-badge.component'
import { SearchableVirtualList } from '@aglyn/shared-ui-jsx/components/searchable-virtual-list.component'
import { useHostSiteKey } from '@aglyn/shared-ui-theme'
import { siteBaseTypography } from '@aglyn/shared-ui-theme/site-base-fonts'
import {
  readThemeFonts,
  type ThemeFontChoice,
  type ThemeFontSelection,
  writeThemeFonts,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GoogleFontFamily } from '../catalog/google-fonts-catalog'
import { useFontCost } from './font-cost'
import {
  categoryLabel,
  defaultFontChoice,
  FONT_CATEGORY_LABELS,
  type FontRole,
  genericFamily,
  searchFontFamilies,
} from './font-choice'
import { FontDetail } from './font-detail.component'
import { FontFamilyCard } from './font-family-card.component'
import { type FontPairing, suggestFontPairings } from './font-pairings'
import { previewStack, useFontPreview } from './font-preview'
import type { SiteSample } from './site-sample'


type Target =
  | { kind: 'google'; family: GoogleFontFamily }
  | { kind: 'custom'; font: HostThemeFont }
  | { kind: 'default' }

const ROLE_TITLE: Record<FontRole, string> = {
  body: 'Choose the font for body text',
  heading: 'Choose the font for headings',
}

const DEFAULT_LABEL: Record<FontRole, { label: string; detail: string }> = {
  body: { label: 'Theme default', detail: 'The visitor’s system font · nothing to download' },
  heading: { label: 'Same as body text', detail: 'Headings use the body font' },
}

export interface FontBrowserDialogProps {
  open: boolean
  role: FontRole
  hostId: string | null
  draft: HostTheme
  /** The Google Fonts catalog, once loaded. */
  catalog: GoogleFontFamily[] | null
  catalogError: string | null
  onRetryCatalog: () => void
  sample: SiteSample
  onApply: (selection: ThemeFontSelection) => void
  onClose: () => void
}

function stylesLabel(count: number): string {
  return `${count} ${count === 1 ? 'style' : 'styles'}`
}

function customChoice(font: HostThemeFont): ThemeFontChoice {
  const weights = [...new Set((font.faces ?? []).filter((face) => face.style === 'normal').map((face) => face.weight))]
  const italics = [...new Set((font.faces ?? []).filter((face) => face.style === 'italic').map((face) => face.weight))]
  return {
    family: font.family.trim(),
    category: font.category ?? 'sans-serif',
    weights: (weights.length ? weights : font.weights?.length ? font.weights : [400]).sort((a, b) => a - b),
    ...(italics.length ? { italics: italics.sort((a, b) => a - b) } : {}),
    source: 'custom',
  }
}

/**
 * The whole Google Fonts catalog for one role, body text or headings
 * (AGL-3656): searched, narrowed by category, drawn in the site's own words,
 * and beside it the family picked — its styles, what it costs a visitor and
 * what pairs with it. Full screen on a phone, where the list and the family
 * take turns.
 */
export function FontBrowserDialog(props: FontBrowserDialogProps) {
  const { open, role, hostId, draft, catalog, catalogError, onRetryCatalog, sample, onApply, onClose } = props
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const selection = useMemo(() => readThemeFonts(draft), [draft])
  // What the site draws with when its theme names no font: the base's stack.
  const siteKey = useHostSiteKey() ?? undefined
  const defaultStack = String(siteBaseTypography(siteKey)['fontFamily'])
  const current = selection[role]
  const customFonts = useMemo(
    () => (draft.fonts ?? []).filter((font) => font.source === 'custom' && font.family?.trim()),
    [draft.fonts],
  )

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [candidate, setCandidate] = useState<ThemeFontChoice | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  // Opening starts on what the role has now.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setCategory('')
    setShowDetail(false)
    if (!current) {
      setTarget({ kind: 'default' })
      setCandidate(null)
    } else if (current.source === 'custom') {
      const font = customFonts.find((entry) => entry.family.trim().toLowerCase() === current.family.toLowerCase())
      setTarget(font ? { kind: 'custom', font } : { kind: 'default' })
      setCandidate(current)
    } else {
      setTarget(null)
      setCandidate(current)
    }
    // Only on opening: the draft changes under an open dialog as nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role])

  // The current Google font's catalog entry, once the catalog is in.
  useEffect(() => {
    if (!open || target || !catalog || !current || current.source !== 'google') return
    const family = catalog.find((entry) => entry.family.toLowerCase() === current.family.toLowerCase())
    setTarget(family ? { kind: 'google', family } : { kind: 'default' })
  }, [open, target, catalog, current])

  const results = useMemo(
    () => (catalog ? searchFontFamilies(catalog, query, category) : []),
    [catalog, query, category],
  )
  const matchingCustom = useMemo(() => {
    const words = query.trim().toLowerCase()
    if (category) return []
    return customFonts.filter((font) => !words || font.family.toLowerCase().includes(words))
  }, [customFonts, query, category])

  const candidateTheme = useMemo(
    () => (candidate ? writeThemeFonts(draft, { ...selection, [role]: candidate }) : null),
    [candidate, draft, role, selection],
  )
  const cost = useFontCost(hostId, candidateTheme)

  // The preview's other line: body text under a heading font, in the body
  // font; headings over a body font, in the theme's heading font if it has one.
  const companion = role === 'heading' ? selection.body : selection.heading
  const companionPreview = useFontPreview(
    companion && companion.source === 'google' ? companion.family : null,
    {
      text: role === 'heading' ? sample.paragraph : sample.title,
      weight: role === 'heading' ? Math.min(...companion?.weights ?? [400]) : Math.max(...companion?.weights ?? [700]),
      enabled: open,
    },
  )
  const companionStack = companion
    ? companion.source === 'custom'
      ? `"${companion.family}", ${genericFamily(companion.category)}`
      : previewStack(companionPreview, genericFamily(companion.category))
    : role === 'heading'
      ? defaultStack
      : undefined

  const pairings = useMemo<FontPairing[]>(
    () =>
      target?.kind === 'google' && catalog
        ? suggestFontPairings(target.family, role === 'body' ? 'heading' : 'body', catalog)
        : [],
    [target, catalog, role],
  )

  const pickGoogle = useCallback(
    (family: GoogleFontFamily) => {
      setTarget({ kind: 'google', family })
      setCandidate(
        current && current.family.toLowerCase() === family.family.toLowerCase()
          ? current
          : defaultFontChoice(family, role),
      )
      setShowDetail(true)
    },
    [current, role],
  )
  const pickCustom = (font: HostThemeFont) => {
    setTarget({ kind: 'custom', font })
    setCandidate(customChoice(font))
    setShowDetail(true)
  }
  const pickDefault = () => {
    setTarget({ kind: 'default' })
    setCandidate(null)
    setShowDetail(true)
  }

  const apply = (choice: ThemeFontChoice | null) => {
    onApply({ ...selection, [role]: choice })
    onClose()
  }
  const usePairing = (pairing: FontPairing) => {
    if (!candidate) return
    const other = defaultFontChoice(pairing.family, role === 'body' ? 'heading' : 'body')
    onApply(role === 'body' ? { body: candidate, heading: other } : { body: other, heading: candidate })
    onClose()
  }

  const isSelected = (family: string | null) =>
    family === null ? target?.kind === 'default' : candidate?.family.toLowerCase() === family.toLowerCase()

  const header = (
    <Stack spacing={1} sx={{ pb: 1 }}>
      {!query && !category ? (
        <FontFamilyCard
          family={null}
          label={DEFAULT_LABEL[role].label}
          detail={DEFAULT_LABEL[role].detail}
          sample={sample.title}
          fallback="sans-serif"
          stack={role === 'heading' && selection.body ? `"${selection.body.family}", ${genericFamily(selection.body.category)}` : defaultStack}
          selected={isSelected(null)}
          onSelect={pickDefault}
        />
      ) : null}
      {matchingCustom.length ? (
        <>
          <Typography variant="overline" color="text.secondary" component="h3">
            {'Your fonts'}
          </Typography>
          {matchingCustom.map((font) => (
            <FontFamilyCard
              key={font.family}
              family={null}
              label={font.family}
              detail={`${categoryLabel(font.category ?? 'sans-serif')} · uploaded`}
              sample={sample.title}
              fallback={genericFamily(font.category ?? 'sans-serif')}
              stack={`"${font.family}", ${genericFamily(font.category ?? 'sans-serif')}`}
              selected={isSelected(font.family)}
              onSelect={() => pickCustom(font)}
            />
          ))}
        </>
      ) : null}
      {results.length && (matchingCustom.length || (!query && !category)) ? (
        <Typography variant="overline" color="text.secondary" component="h3">
          {'Google Fonts'}
        </Typography>
      ) : null}
    </Stack>
  )

  const list = (
    <SearchableVirtualList
      items={results}
      itemKey={(entry) => entry.family}
      renderItem={(entry) => (
        <FontFamilyCard
          family={entry.family}
          label={entry.family}
          detail={`${categoryLabel(entry.category)} · ${stylesLabel(entry.weights.length + entry.italics.length)}`}
          sample={sample.title}
          fallback={genericFamily(entry.category)}
          selected={isSelected(entry.family)}
          onSelect={() => pickGoogle(entry)}
        />
      )}
      header={header}
      search={{ value: query, onChange: setQuery, label: 'Search fonts', placeholder: 'Inter, Lora, Playfair…' }}
      filters={{
        label: 'Category',
        options: FONT_CATEGORY_LABELS,
        value: category,
        onChange: setCategory,
      }}
      summary={
        catalog && results.length
          ? `${results.length.toLocaleString('en-US')} ${results.length === 1 ? 'family' : 'families'}${query || category ? (results.length === 1 ? ' matches' : ' match') : ''}, most popular first`
          : undefined
      }
      loading={!catalog && !catalogError}
      error={catalogError ? { message: catalogError, onRetry: onRetryCatalog } : null}
      empty={{
        label: 'No fonts match',
        description: 'Try another name, or another category.',
        action: (
          <Button
            onClick={() => {
              setQuery('')
              setCategory('')
            }}
          >
            {'Show all fonts'}
          </Button>
        ),
      }}
    />
  )

  const back = phone ? (
    <Button startIcon={<MdiIcon path={mdiArrowLeft.path} />} onClick={() => setShowDetail(false)} sx={{ alignSelf: 'flex-start' }}>
      {'All fonts'}
    </Button>
  ) : null

  let detail = null
  if (target?.kind === 'default' || (!target && !current)) {
    detail = (
      <Stack spacing={2}>
        {back}
        <Card variant="outlined">
          <CardHeader
            title={DEFAULT_LABEL[role].label}
            subheader={role === 'body' ? 'No font to download' : 'One font for the whole site'}
            slotProps={{ title: { variant: 'h6', component: 'h3' } }}
            action={
              <Button variant="contained" onClick={() => apply(null)}>
                {role === 'body' ? 'Use theme default' : 'Use body font'}
              </Button>
            }
            sx={{ flexWrap: 'wrap', rowGap: 1, '& .MuiCardHeader-action': { alignSelf: 'center', m: 0 } }}
          />
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {role === 'body'
                  ? 'Text is drawn in the font each visitor’s device already has — San Francisco on Apple devices, Segoe UI on Windows, Roboto on Android. It costs nothing to download and appears at once.'
                  : 'Headings are drawn in the body text’s font, in their own weights. Pick a font here to give them one of their own.'}
              </Typography>
              {role === 'body' ? (
                <Box>
                  <DownloadCostBadge bytes={0} files={0} tooltip="System fonts are already on the visitor’s device." />
                </Box>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    )
  } else if (candidate && target) {
    detail = (
      <FontDetail
        role={role}
        family={target.kind === 'google' ? target.family : null}
        choice={candidate}
        onChange={setCandidate}
        onUse={apply}
        offeredWeights={target.kind === 'custom' ? customChoice(target.font).weights : undefined}
        offeredItalics={target.kind === 'custom' ? customChoice(target.font).italics : undefined}
        cost={cost}
        pairings={pairings}
        onUsePairing={usePairing}
        sample={sample}
        stack={target.kind === 'custom' ? `"${target.font.family}", ${genericFamily(candidate.category)}` : undefined}
        back={back}
        companionStack={companionStack}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      fullWidth
      maxWidth="lg"
      aria-labelledby="font-browser-title"
      slotProps={{ paper: { sx: phone ? undefined : { height: '85vh' } } }}
    >
      <DialogTitle id="font-browser-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box component="span" sx={{ flex: '1 1 auto', minWidth: 0 }}>
          {ROLE_TITLE[role]}
        </Box>
        <IconButton aria-label="Close" onClick={onClose}>
          <MdiIcon path={mdiClose.path} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', minHeight: 0, p: { xs: 2, md: 3 } }}>
        {phone ? (
          showDetail && detail ? (
            <Box sx={{ flex: '1 1 auto', minWidth: 0, overflowY: 'auto' }}>{detail}</Box>
          ) : (
            <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</Box>
          )
        ) : (
          <Stack direction="row" spacing={3} sx={{ flex: '1 1 auto', minHeight: 0, width: '100%' }}>
            <Box sx={{ flex: '0 0 40%', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{list}</Box>
            <Box sx={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0, pr: 0.5 }}>{detail}</Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  )
}
FontBrowserDialog.displayName = 'FontBrowserDialog'

export default FontBrowserDialog
