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

import type { ConsoleThemeEditorFontsZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { DownloadCostBadge } from '@aglyn/shared-ui-jsx/components/download-cost-badge.component'
import { useHostSiteKey } from '@aglyn/shared-ui-theme'
import { siteBaseTypography } from '@aglyn/shared-ui-theme/site-base-fonts'
import {
  readThemeFonts,
  type ThemeFontChoice,
  type ThemeFontSelection,
  writeThemeFonts,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import type { GoogleFontFamily } from '../catalog/google-fonts-catalog'
import { useFontCost } from './font-cost'
import { categoryLabel, choiceStylesLabel, type FontRole, genericFamily } from './font-choice'
import { ALL_FONTS_COST_TOOLTIP } from './font-detail.component'
import { FontBrowserDialog } from './font-browser-dialog.component'
import { previewStack, useFontPreview } from './font-preview'
import { type SiteSample, useSiteSample } from './site-sample'

/**
 * The theme editor's font control (AGL-3656), in the `themeEditorFonts`
 * zone: the site's body font and heading font, each drawn in the site's own
 * words with what it costs, and a browser of the whole Google Fonts catalog
 * to change either. Every choice is an edit to the editor's draft, which the
 * editor's Save keeps.
 *
 * The catalog loads the first time the browser opens, never with the page.
 */
export function FontPicker(props: ConsoleThemeEditorFontsZoneProps) {
  const { hostId, draft, updateDraft } = props
  const selection = useMemo(() => readThemeFonts(draft), [draft])
  const sample = useSiteSample(hostId)
  const cost = useFontCost(hostId, draft)
  const [browsing, setBrowsing] = useState<FontRole | null>(null)
  const [catalog, setCatalog] = useState<GoogleFontFamily[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const loadCatalog = useCallback(() => {
    setCatalogError(null)
    import('../catalog/google-fonts-catalog')
      .then((module) => module.loadGoogleFontsCatalog())
      .then(setCatalog)
      .catch(() => setCatalogError('The font list could not be loaded. Check your connection and try again.'))
  }, [])

  const browse = (role: FontRole) => {
    setBrowsing(role)
    if (!catalog) loadCatalog()
  }
  const apply = useCallback(
    (next: ThemeFontSelection) => updateDraft((previous) => writeThemeFonts(previous, next)),
    [updateDraft],
  )

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" component="h3">
          {'Fonts'}
        </Typography>
        <DownloadCostBadge
          loading={cost.loading}
          error={cost.error}
          bytes={cost.cost?.bytes}
          files={cost.cost?.files}
          approximate={cost.cost ? !cost.cost.complete : false}
          tooltip={ALL_FONTS_COST_TOOLTIP}
        />
      </Stack>
      <FontRoleCard
        role="body"
        choice={selection.body}
        bodyChoice={selection.body}
        sample={sample}
        onChange={() => browse('body')}
      />
      <FontRoleCard
        role="heading"
        choice={selection.heading}
        bodyChoice={selection.body}
        sample={sample}
        onChange={() => browse('heading')}
        onClear={selection.heading ? () => apply({ ...selection, heading: null }) : undefined}
      />
      <FontBrowserDialog
        open={browsing !== null}
        role={browsing ?? 'body'}
        hostId={hostId}
        draft={draft}
        catalog={catalog}
        catalogError={catalogError}
        onRetryCatalog={loadCatalog}
        sample={sample}
        onApply={apply}
        onClose={() => setBrowsing(null)}
      />
    </Stack>
  )
}
FontPicker.displayName = 'FontPicker'

const ROLE_LABEL: Record<FontRole, string> = { body: 'Body text', heading: 'Headings' }

function FontRoleCard(props: {
  role: FontRole
  choice: ThemeFontChoice | null
  bodyChoice: ThemeFontChoice | null
  sample: SiteSample
  onChange: () => void
  onClear?: () => void
}) {
  const { role, choice, bodyChoice, sample, onChange, onClear } = props
  const siteKey = useHostSiteKey() ?? undefined
  // What the role draws in: its own font, else the body's, else the base.
  const drawn = choice ?? (role === 'heading' ? bodyChoice : null)
  const text = role === 'heading' ? sample.heading : sample.paragraph
  const weight = role === 'heading' ? Math.max(...(drawn?.weights ?? [700])) : Math.min(...(drawn?.weights ?? [400]))
  const preview = useFontPreview(drawn && drawn.source === 'google' ? drawn.family : null, { weight, text })
  const fallback = drawn ? genericFamily(drawn.category) : 'sans-serif'
  const stack = !drawn
    ? String(siteBaseTypography(siteKey)['fontFamily'])
    : drawn.source === 'custom'
      ? `"${drawn.family}", ${fallback}`
      : previewStack(preview, fallback)

  const title = choice ? choice.family : role === 'body' ? 'Theme default' : 'Same as body text'
  const subheader = choice
    ? `${categoryLabel(choice.category)} · ${choiceStylesLabel(choice)}`
    : role === 'body'
      ? 'The visitor’s system font'
      : bodyChoice
        ? `${bodyChoice.family}, in each heading’s own weight`
        : 'The visitor’s system font'

  return (
    <Card variant="outlined">
      <CardHeader
        title={
          <>
            <Typography variant="overline" color="text.secondary" component="span" sx={{ display: 'block' }}>
              {ROLE_LABEL[role]}
            </Typography>
            {title}
          </>
        }
        subheader={subheader}
        slotProps={{ title: { variant: 'subtitle1', component: 'h4' }, subheader: { variant: 'caption' } }}
        action={
          <Stack direction="row" spacing={0.5}>
            {onClear ? (
              <Button size="small" onClick={onClear}>
                {'Use body font'}
              </Button>
            ) : null}
            <Button size="small" onClick={onChange} aria-label={`Change the ${ROLE_LABEL[role].toLowerCase()} font`}>
              {'Change'}
            </Button>
          </Stack>
        }
        sx={{
          pb: 0,
          flexWrap: 'wrap',
          rowGap: 1,
          '& .MuiCardHeader-action': { alignSelf: 'center', m: 0 },
        }}
      />
      <CardContent sx={{ pt: 1, '&:last-child': { pb: 2 } }}>
        <Typography
          variant={role === 'heading' ? 'h5' : 'body1'}
          component="p"
          sx={{ fontFamily: stack, fontWeight: weight, overflowWrap: 'anywhere' }}
        >
          {text}
        </Typography>
      </CardContent>
    </Card>
  )
}

export default FontPicker
