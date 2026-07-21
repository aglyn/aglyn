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

import type {
  HostTheme,
  HostThemeScheme,
  HostThemeSchemeColors,
} from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { getGoogleFontsUrl, sanitizeHostTheme } from '@aglyn/shared-ui-theme'
import { deepEqual } from '@aglyn/shared-util-vendor'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import {
  Button,
  Grid,
  MenuItem,
  Slider,
  Stack,
  Tab,
  TextField,
  Typography,
} from '@mui/material'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { useCallback, useMemo, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import ColorField from './color-field.component'
import {
  fontFamilyStack,
  getSchemeColor,
  GOOGLE_FONT_OPTIONS,
  PALETTE_COLOR_FIELDS,
  SURFACE_COLOR_FIELDS,
  type SurfaceColorPath,
} from './theme-editor.constants'
import ThemePreview from './theme-preview.component'

const JsonEditor = dynamic<JsonEditorProps>(
  () => import('@aglyn/shared-ui-json-editor').then((mod) => mod.JsonEditor),
  { ssr: false },
)

const SYSTEM_FONT_VALUE = '__system__'

export interface ThemeEditorProps {
  /** Saved theme from the host document. */
  theme: HostTheme | undefined
  saving?: boolean
  onSave: (theme: HostTheme) => Promise<void> | void
}

function setSchemeValue(
  draft: HostTheme,
  scheme: HostThemeScheme,
  update: (colors: HostThemeSchemeColors) => HostThemeSchemeColors,
): HostTheme {
  const colors = draft.colorSchemes?.[scheme] ?? {}
  return {
    ...draft,
    colorSchemes: { ...draft.colorSchemes, [scheme]: update(colors) },
  }
}

/**
 * Host theme editor: palette, typography, shape/spacing controls with a live
 * preview per color scheme. All edits stay in local draft state until Save.
 */
export function ThemeEditor(props: ThemeEditorProps) {
  const { theme, saving, onSave } = props
  const [draft, setDraft] = useState<HostTheme>(() => theme ?? {})
  const [scheme, setScheme] = useState<HostThemeScheme>('light')
  // Sanitize both sides and compare order-insensitively (AGL-56): the saved
  // doc round-trips through Firestore with different key order than the local
  // draft, and the draft is only sanitized at save time — a string compare
  // left the save buttons enabled forever after the first save.
  const dirty = useMemo(
    () =>
      !deepEqual(sanitizeHostTheme(draft), sanitizeHostTheme(theme ?? {}), {
        strict: true,
      }),
    [draft, theme],
  )
  const schemeColors = draft.colorSchemes?.[scheme]
  const previewFontsHref = getGoogleFontsUrl(draft.fonts)

  const handleSchemeTab = useCallback((_, value: HostThemeScheme) => {
    setScheme(value)
  }, [])

  const setMainColor = useCallback(
    (key: (typeof PALETTE_COLOR_FIELDS)[number]['key']) =>
      (hex: string | undefined) => {
        setDraft((prev) =>
          setSchemeValue(prev, scheme, (colors) => {
            const next = { ...colors }
            if (hex) next[key] = { ...next[key], main: hex }
            else delete next[key]
            return next
          }),
        )
      },
    [scheme],
  )

  const setSurfaceColor = useCallback(
    (path: SurfaceColorPath) => (hex: string | undefined) => {
      setDraft((prev) =>
        setSchemeValue(prev, scheme, (colors) => {
          const [group, key] = path
          const groupValue = {
            ...(colors[group] as Record<string, string> | undefined),
          }
          if (hex) groupValue[key] = hex
          else delete groupValue[key]
          const next = { ...colors, [group]: groupValue }
          if (!Object.keys(groupValue).length) delete next[group]
          return next
        }),
      )
    },
    [scheme],
  )

  const setDividerColor = useCallback(
    (hex: string | undefined) => {
      setDraft((prev) =>
        setSchemeValue(prev, scheme, (colors) => {
          const next = { ...colors }
          if (hex) next.divider = hex
          else delete next.divider
          return next
        }),
      )
    },
    [scheme],
  )

  const copyFromOtherScheme = useCallback(() => {
    setDraft((prev) => {
      const other: HostThemeScheme = scheme === 'light' ? 'dark' : 'light'
      const source = prev.colorSchemes?.[other]
      if (!source) return prev
      return {
        ...prev,
        colorSchemes: {
          ...prev.colorSchemes,
          [scheme]: JSON.parse(JSON.stringify(source)),
        },
      }
    })
  }, [scheme])

  const activeFontFamily = useMemo(() => {
    const family = draft.fonts?.[0]?.family
    return family ?? SYSTEM_FONT_VALUE
  }, [draft.fonts])

  const handleFontChange = useCallback((event) => {
    const value = event.target.value as string
    setDraft((prev) => {
      if (value === SYSTEM_FONT_VALUE) {
        const next = { ...prev }
        delete next.fonts
        const typography = { ...next.typography }
        delete typography.fontFamily
        if (Object.keys(typography).length) next.typography = typography
        else delete next.typography
        return next
      }
      const option = GOOGLE_FONT_OPTIONS.find((o) => o.family === value)
      if (!option) return prev
      return {
        ...prev,
        fonts: [
          {
            family: option.family,
            weights: option.weights,
            source: 'google',
          },
        ],
        typography: {
          ...prev.typography,
          fontFamily: fontFamilyStack(option.family, option.category),
        },
      }
    })
  }, [])

  const handleRadiusChange = useCallback((_, value: number | number[]) => {
    setDraft((prev) => ({
      ...prev,
      shape: { ...prev.shape, borderRadius: value as number },
    }))
  }, [])

  const handleSpacingChange = useCallback((event) => {
    const value = Number(event.target.value)
    setDraft((prev) => {
      const next = { ...prev }
      if (Number.isFinite(value) && value > 0) next.spacing = value
      else delete next.spacing
      return next
    })
  }, [])

  const [overridesOpen, setOverridesOpen] = useState(false)
  const handleOverridesSave = useCallback((_, value) => {
    setDraft((prev) => {
      const sanitized = sanitizeHostTheme({
        ...prev,
        components: value as HostTheme['components'],
      })
      return sanitized
    })
    setOverridesOpen(false)
  }, [])

  const handleDiscard = useCallback(() => {
    setDraft(theme ?? {})
  }, [theme])

  const handleReset = useCallback(() => {
    setDraft({})
  }, [])

  const handleSave = useCallback(() => {
    return onSave(sanitizeHostTheme(draft))
  }, [draft, onSave])

  return (
    <Grid container spacing={3}>
      {previewFontsHref ? (
        <Head>
          <link
            key="theme-editor-fonts"
            rel="stylesheet"
            href={previewFontsHref}
          />
        </Head>
      ) : null}
      <Grid size={{ xs: 12, md: 6 }}>
        <Stack spacing={3}>
          <CardDisplay
            contentGutterY
            contentGutterX
            header="Color scheme"
            help={docsHelp('editYourTheme', {
              anchor: '#set-colors-and-fonts',
              excerpt:
                'Pick the palette for light and dark schemes — primary, secondary, surfaces, and text; the preview updates live.',
            })}
          >
            <TabContext value={scheme}>
              <TabList onChange={handleSchemeTab}>
                <Tab label="Light" value="light" />
                <Tab label="Dark" value="dark" />
              </TabList>
              <TabPanel value={scheme} sx={{ px: 0 }}>
                <Stack spacing={1.5}>
                  <Button
                    size="small"
                    onClick={copyFromOtherScheme}
                    sx={{ alignSelf: 'flex-end' }}
                  >
                    {`Copy from ${scheme === 'light' ? 'dark' : 'light'}`}
                  </Button>
                  <Typography variant="subtitle2">{'Palette'}</Typography>
                  {PALETTE_COLOR_FIELDS.map(({ key, label }) => (
                    <ColorField
                      key={key}
                      label={label}
                      value={schemeColors?.[key]?.main}
                      onChange={setMainColor(key)}
                    />
                  ))}
                  <Typography variant="subtitle2">
                    {'Background & text'}
                  </Typography>
                  {SURFACE_COLOR_FIELDS.map(({ path, label }) => (
                    <ColorField
                      key={path.join('.')}
                      label={label}
                      value={getSchemeColor(schemeColors, path)}
                      onChange={setSurfaceColor(path)}
                    />
                  ))}
                  <ColorField
                    label="Divider"
                    value={schemeColors?.divider}
                    onChange={setDividerColor}
                  />
                </Stack>
              </TabPanel>
            </TabContext>
          </CardDisplay>

          <CardDisplay
            contentGutterY
            contentGutterX
            header="Typography"
            help={docsHelp('editYourTheme', {
              anchor: '#set-colors-and-fonts',
              excerpt:
                'Choose the heading and body font families and base sizing your whole site inherits.',
            })}
          >
            <TextField
              select
              fullWidth
              size="small"
              label="Font family"
              value={activeFontFamily}
              onChange={handleFontChange}
            >
              <MenuItem value={SYSTEM_FONT_VALUE}>{'System default'}</MenuItem>
              {GOOGLE_FONT_OPTIONS.map((option) => (
                <MenuItem key={option.family} value={option.family}>
                  {`${option.family} (${option.category})`}
                </MenuItem>
              ))}
            </TextField>
          </CardDisplay>

          <CardDisplay
            contentGutterY
            contentGutterX
            header="Shape & spacing"
            help={docsHelp('editYourTheme', {
              excerpt:
                'Corner radii and spacing scale applied across components — buttons, cards, and inputs follow it.',
            })}
          >
            <Stack spacing={2}>
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  {`Border radius: ${draft.shape?.borderRadius ?? 4}px`}
                </Typography>
                <Slider
                  aria-label="border radius"
                  size="small"
                  min={0}
                  max={24}
                  value={draft.shape?.borderRadius ?? 4}
                  onChange={handleRadiusChange}
                />
              </Stack>
              <TextField
                type="number"
                size="small"
                label="Spacing unit (px)"
                value={draft.spacing ?? 8}
                onChange={handleSpacingChange}
                slotProps={{ htmlInput: { min: 2, max: 16 } }}
              />
            </Stack>
          </CardDisplay>

          <CardDisplay
            contentGutterY
            contentGutterX
            header="Component overrides"
            help={docsHelp('themeBuilder', {
              excerpt:
                'Fine-tune how specific components render beyond the base palette and typography.',
            })}
          >
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {`Advanced: JSON overrides for whitelisted components (${
                  Object.keys(draft.components ?? {}).length
                } set). Unknown components are stripped on apply.`}
              </Typography>
              <Button
                size="small"
                onClick={() => setOverridesOpen(true)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {'Edit overrides'}
              </Button>
            </Stack>
          </CardDisplay>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button disabled={!dirty || saving} onClick={handleDiscard}>
              {'Discard changes'}
            </Button>
            <Button color="error" disabled={saving} onClick={handleReset}>
              {'Reset to defaults'}
            </Button>
          </Stack>
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <CardDisplay
          contentGutterY
          contentGutterX
          header={`Preview (${scheme})`}
          help={docsHelp('editYourTheme', {
            anchor: '#it-follows-you-into-the-besigner',
            title: 'Theme preview',
            excerpt:
              'A live sample of your theme in the selected scheme — what you see here is what the Besigner and your site render.',
          })}
        >
          <ThemePreview theme={draft} scheme={scheme} />
        </CardDisplay>
      </Grid>
      {overridesOpen ? (
        <JsonEditor
          open={overridesOpen}
          onClose={() => setOverridesOpen(false)}
          onSave={handleOverridesSave}
          defaultValue={(draft.components ?? {}) as any}
        />
      ) : null}
    </Grid>
  )
}
ThemeEditor.displayName = 'ThemeEditor'

export default ThemeEditor
