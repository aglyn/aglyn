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

import { DownloadCostBadge } from '@aglyn/shared-ui-jsx/components/download-cost-badge.component'
import type { ThemeFontChoice } from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import type { GoogleFontFamily } from '../catalog/google-fonts-catalog'
import { familyCost, type FontCostState } from './font-cost'
import {
  categoryLabel,
  type FontRole,
  genericFamily,
  weightLabel,
} from './font-choice'
import type { FontPairing } from './font-pairings'
import { previewStack, useFontPreview } from './font-preview'
import type { SiteSample } from './site-sample'

/** What the cost badges say they count. */
export const FONT_COST_TOOLTIP =
  'What a visitor downloads for this font: the Latin files your text styles and italics use, served from your site’s own address. Measured the way your published pages load them.'

export const ALL_FONTS_COST_TOOLTIP =
  'What a visitor downloads for all your fonts together: the Latin files your text styles and italics use, served from your site’s own address.'

export interface FontDetailProps {
  role: FontRole
  /** The family, from the catalog; absent for an uploaded font. */
  family: GoogleFontFamily | null
  /** The choice as it stands: the family with the weights picked so far. */
  choice: ThemeFontChoice
  onChange: (choice: ThemeFontChoice) => void
  onUse: (choice: ThemeFontChoice) => void
  /** Weights an uploaded font has, when `family` is absent. */
  offeredWeights?: number[]
  offeredItalics?: number[]
  /** What the theme would cost with this choice in it. */
  cost: FontCostState
  pairings: FontPairing[]
  onUsePairing: (pairing: FontPairing) => void
  sample: SiteSample
  /** A stack that draws the font without loading it: an upload the editor loads. */
  stack?: string
  /** Above the header, on a phone: the way back to the list. */
  back?: ReactNode
  /**
   * How the preview's other line is drawn: the body text under a heading
   * font, or the headings over a body font when the theme has its own.
   */
  companionStack?: string
}

const ROLE_ACTION: Record<FontRole, string> = {
  body: 'Use for body text',
  heading: 'Use for headings',
}

/**
 * One family, chosen from the list: the site's words drawn in it, the styles
 * to load, what it costs a visitor, and the fonts that pair with it.
 */
export function FontDetail(props: FontDetailProps) {
  const {
    role,
    family,
    choice,
    onChange,
    onUse,
    cost,
    pairings,
    onUsePairing,
    sample,
    stack,
    back,
    companionStack,
  } = props
  const weights = family?.weights ?? props.offeredWeights ?? choice.weights
  const italics = family?.italics ?? props.offeredItalics ?? []
  const fallback = genericFamily(choice.category)
  const headingWeight = Math.max(...choice.weights)
  const bodyWeight = Math.min(...choice.weights)
  const headingText = role === 'heading' ? sample.heading : sample.title
  const headingPreview = useFontPreview(stack || !family ? null : family.family, {
    weight: headingWeight,
    text: headingText,
  })
  const bodyPreview = useFontPreview(stack || !family ? null : family.family, {
    weight: bodyWeight,
    text: sample.paragraph,
  })
  const share = familyCost(cost.cost, choice.family)

  const toggleWeight = (weight: number) => {
    const selected = choice.weights.includes(weight)
    // A font always loads at least one weight.
    if (selected && choice.weights.length === 1) return
    const next = selected
      ? choice.weights.filter((entry) => entry !== weight)
      : [...choice.weights, weight].sort((a, b) => a - b)
    onChange({ ...choice, weights: next })
  }
  const italicOn = Boolean(choice.italics?.length)
  const toggleItalic = () => {
    if (italicOn) {
      const next = { ...choice }
      delete next.italics
      onChange(next)
      return
    }
    const wanted = choice.weights.filter((weight) => italics.includes(weight))
    onChange({ ...choice, italics: wanted.length ? wanted : [italics[0]] })
  }

  const subheader = [
    categoryLabel(choice.category),
    `${weights.length + italics.length} ${weights.length + italics.length === 1 ? 'style' : 'styles'}`,
    family?.axes.some((axis) => axis.tag === 'wght') ? 'Variable' : null,
    family ? null : 'Your font',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Stack spacing={2}>
      {back}
      <Card variant="outlined">
        <CardHeader
          title={choice.family}
          subheader={subheader}
          slotProps={{ title: { variant: 'h6', component: 'h3' } }}
          action={
            <Button variant="contained" onClick={() => onUse(choice)}>
              {ROLE_ACTION[role]}
            </Button>
          }
          sx={{ flexWrap: 'wrap', rowGap: 1, '& .MuiCardHeader-action': { alignSelf: 'center', m: 0 } }}
        />
        <CardContent>
          <Stack spacing={3}>
            <Box>
              <Typography
                variant="h3"
                component="p"
                sx={{
                  fontFamily:
                    role === 'body' && companionStack ? companionStack : stack ?? previewStack(headingPreview, fallback),
                  fontWeight: role === 'body' && companionStack ? undefined : headingWeight,
                  overflowWrap: 'anywhere',
                }}
              >
                {headingText}
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  mt: 1.5,
                  fontFamily:
                    role === 'heading' && companionStack ? companionStack : stack ?? previewStack(bodyPreview, fallback),
                  fontWeight: role === 'heading' && companionStack ? undefined : bodyWeight,
                }}
              >
                {sample.paragraph}
              </Typography>
            </Box>

            <Stack spacing={1}>
              <Typography variant="subtitle2" component="h4">
                {'Styles to load'}
              </Typography>
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }} role="group" aria-label="Weights">
                {weights.map((weight) => {
                  const selected = choice.weights.includes(weight)
                  return (
                    <Chip
                      key={weight}
                      size="small"
                      label={weightLabel(weight)}
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      aria-pressed={selected}
                      onClick={() => toggleWeight(weight)}
                    />
                  )
                })}
                {italics.length && role === 'body' ? (
                  // The page loads body text's italic whatever the theme
                  // lists, so emphasis is a true italic: shown, not offered.
                  <Tooltip title="Body text always loads its italic, so emphasis in your text is a true italic.">
                    <Chip size="small" label="Italic" color="primary" sx={{ fontStyle: 'italic' }} />
                  </Tooltip>
                ) : italics.length ? (
                  <Chip
                    size="small"
                    label="Italic"
                    color={italicOn ? 'primary' : 'default'}
                    variant={italicOn ? 'filled' : 'outlined'}
                    aria-pressed={italicOn}
                    onClick={toggleItalic}
                    sx={{ fontStyle: 'italic' }}
                  />
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {
                  'Your headings and text styles load the weights they use as well, matched to the nearest one this font has.'
                }
              </Typography>
            </Stack>

            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="subtitle2" component="h4" sx={{ mr: 0.5 }}>
                {'Download size'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {'This font'}
              </Typography>
              <DownloadCostBadge
                loading={cost.loading}
                error={cost.error}
                bytes={share ? share.bytes : cost.cost ? 0 : null}
                files={share?.files.length ?? 0}
                approximate={share ? !share.complete : false}
                tooltip={FONT_COST_TOOLTIP}
              />
              {cost.cost && cost.cost.families.length > 1 ? (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  {'All your fonts'}
                </Typography>
              ) : null}
              {cost.cost && cost.cost.families.length > 1 ? (
                <DownloadCostBadge
                  bytes={cost.cost.bytes}
                  files={cost.cost.files}
                  approximate={!cost.cost.complete}
                  tooltip={ALL_FONTS_COST_TOOLTIP}
                />
              ) : null}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {pairings.length ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2" component="h4">
            {role === 'body' ? 'Headings that pair well' : 'Body text that pairs well'}
          </Typography>
          <Grid container spacing={1}>
            {pairings.map((pairing) => (
              <Grid key={pairing.family.family} size={{ xs: 12, sm: 6 }}>
                <PairingCard pairing={pairing} sample={sample} role={role} onUse={() => onUsePairing(pairing)} />
              </Grid>
            ))}
          </Grid>
        </Stack>
      ) : null}
    </Stack>
  )
}
FontDetail.displayName = 'FontDetail'

function PairingCard(props: { pairing: FontPairing; sample: SiteSample; role: FontRole; onUse: () => void }) {
  const { pairing, sample, role, onUse } = props
  // The suggestion plays the other role: headings for a body font, text for a heading font.
  const weight =
    role === 'body'
      ? Math.max(...pairing.family.weights.filter((entry) => entry <= 700), pairing.family.weights[0] ?? 400)
      : 400
  const preview = useFontPreview(pairing.family.family, { weight, text: sample.title })
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader
        title={pairing.family.family}
        subheader={pairing.reason}
        slotProps={{ title: { variant: 'subtitle2', component: 'h5' }, subheader: { variant: 'caption' } }}
        action={
          <Button size="small" onClick={onUse}>
            {'Use pair'}
          </Button>
        }
        sx={{ pb: 0, '& .MuiCardHeader-action': { alignSelf: 'center', m: 0 } }}
      />
      <CardContent sx={{ pt: 1 }}>
        <Typography
          variant="h6"
          component="p"
          noWrap
          sx={{ fontFamily: previewStack(preview, genericFamily(pairing.family.category)), fontWeight: weight }}
        >
          {sample.title}
        </Typography>
      </CardContent>
    </Card>
  )
}

export default FontDetail
