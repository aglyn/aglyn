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
import {
  consoleOptions,
  consoleThemeDark,
  consoleThemeLight,
  getGoogleFontsUrl,
  sanitizeHostTheme,
} from '@aglyn/shared-ui-theme'
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
import { stableStringify } from '@aglyn/aglyn/app-utils/marketplace-provenance'
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

/**
 * True when a value survives a JSON round-trip unchanged.
 *
 * `console.theme.ts` styles several components with a function of the theme
 * (`MuiToolbar`, `MuiAvatar`, `MuiLink`…). `JSON.stringify` drops functions
 * SILENTLY rather than throwing, so seeding the editor without this check
 * would show `{}` where a real style lives and let a save replace it with
 * nothing.
 */
function isJsonSafe(value: unknown): boolean {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return true
  if (kind !== 'object') return false
  if (Array.isArray(value)) return value.every(isJsonSafe)
  return Object.values(value as Record<string, unknown>).every(isJsonSafe)
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
 * MUI's own toolbar breakpoint. `mixins.toolbar` has to carry this exact
 * query, because the rule it competes with is MUI's `@media (min-width:600px)
 * { min-height: 64px }` (AGL-1242).
 */
const TOOLBAR_SM_MIN_WIDTH = 600
const TOOLBAR_SM_QUERY = `@media (min-width:${TOOLBAR_SM_MIN_WIDTH}px)`
/** MUI's stock Toolbar heights, shown when the host has set none. */
const DEFAULT_TOOLBAR_XS = 56
const DEFAULT_TOOLBAR_SM = 64
/**
 * `createMixins` spreads `...mixins` AFTER its default, so anything we write
 * REPLACES the stock toolbar wholesale — including its short-landscape rule.
 * Carrying it forward keeps that behaviour instead of dropping it silently.
 */
const TOOLBAR_LANDSCAPE_QUERY = '@media (min-width:0px)'
const TOOLBAR_LANDSCAPE_RULE = {
  '@media (orientation: landscape)': { minHeight: 48 },
}

/** Reads a px `minHeight` out of `mixins.toolbar` for one breakpoint. */
function readToolbarHeight(theme: HostTheme, breakpoint: 'xs' | 'sm') {
  const toolbar = theme.mixins?.toolbar
  if (!toolbar) return undefined
  const raw =
    breakpoint === 'xs'
      ? toolbar.minHeight
      : (toolbar[TOOLBAR_SM_QUERY] as { minHeight?: unknown } | undefined)
          ?.minHeight
  const value = parseFloat(String(raw ?? ''))
  return Number.isFinite(value) ? value : undefined
}

/**
 * Host theme editor: palette, typography, shape/spacing controls with a live
 * preview per color scheme. All edits stay in local draft state until Save.
 */
export function ThemeEditor(props: ThemeEditorProps) {
  const { theme, saving, onSave } = props
  const [draft, setDraft] = useState<HostTheme>(() => theme ?? {})
  const [scheme, setScheme] = useState<HostThemeScheme>('light')

  /**
   * Re-seed the draft when the saved theme changes underneath us (AGL-1021).
   *
   * The draft used to be seeded once, on mount, which was correct while this
   * editor was the only writer. It is not any more: resetting one overridden
   * field from the "What you have changed" card rewrites the theme this editor
   * is showing, and a draft that ignored it kept rendering the old value — and
   * would have written it straight back on the next Save, silently undoing the
   * reset.
   *
   * Compared by CONTENT, not identity: the parent re-memoizes the resolved
   * theme on every Firestore snapshot, so an identity check would re-seed (and
   * discard in-progress edits) constantly. `stableStringify` and not
   * `JSON.stringify` because the saved doc round-trips through Firestore with a
   * different key order than the local draft — the same thing that left the
   * save buttons enabled forever in AGL-56.
   */
  const themeKey = useMemo(() => stableStringify(theme ?? {}), [theme])
  const [seededKey, setSeededKey] = useState(themeKey)
  if (seededKey !== themeKey) {
    // Adjusting state during render — React's documented alternative to an
    // effect for "reset state when a prop changes". It re-renders immediately
    // without painting the stale draft.
    setSeededKey(themeKey)
    setDraft(theme ?? {})
  }
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

  // What each slot resolves to when it is left unset — the brand palette the
  // site actually renders (AGL-1180). Surfaced next to every "Default" so the
  // swatches are distinguishable and a single change is attributable.
  // Read the BUILT theme, not the options: text, divider and the light/dark
  // shades are derived by MUI, so the raw options would leave those slots
  // showing a bare "Default" with nothing to identify them by.
  const basePalette = (
    scheme === 'dark' ? consoleThemeDark : consoleThemeLight
  ).palette as unknown as Record<string, any>
  const inheritedColor = useCallback(
    (key: string): string | undefined => basePalette?.[key]?.main,
    [basePalette],
  )
  const inheritedSurfaceColor = useCallback(
    (path: readonly [string, string]): string | undefined =>
      basePalette?.[path[0]]?.[path[1]],
    [basePalette],
  )
  const inheritedDivider = typeof basePalette?.['divider'] === 'string'
    ? (basePalette['divider'] as string)
    : undefined
  // Shape/spacing/typography defaults come from the brand theme too — these
  // used to be the literals `?? 4` and `?? 8`, which happen to match today
  // and would silently stop matching the moment console.theme.ts changed.
  const baseShapeRadius =
    typeof consoleThemeLight.shape?.borderRadius === 'number'
      ? consoleThemeLight.shape.borderRadius
      : 4
  const baseSpacing =
    typeof consoleOptions.spacing === 'number' ? consoleOptions.spacing : 8
  // The inherited stack is a long CSS font list; name its first family so
  // the fallback option says what you actually get instead of the
  // meaningless "System default".
  const baseFontFamily = String(
    (consoleOptions.typography as { fontFamily?: string } | undefined)
      ?.fontFamily ?? '',
  )
    .split(',')[0]
    .replace(/["']/g, '')
    .trim()

  /**
   * The brand's own component overrides, offered as the starting point in
   * the raw-JSON editor so you edit from what the site actually renders
   * rather than from `{}`. Passed through the same sanitizer the save path
   * uses, so it only ever shows entries that are on the whitelist — and
   * only the ones that survive JSON, since the theme styles some
   * components with functions.
   */
  const inheritedComponents = useMemo<Record<string, unknown>>(() => {
    const whitelisted =
      sanitizeHostTheme({
        components: consoleOptions.components as HostTheme['components'],
      }).components ?? {}
    const jsonSafe: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(whitelisted)) {
      if (isJsonSafe(entry)) jsonSafe[key] = entry
    }
    return jsonSafe
  }, [])

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

  // Nav height has to travel as `mixins.toolbar` (AGL-1242) — MUI builds the
  // Toolbar's `regular` variant from it and applies that variant AFTER
  // `components.MuiToolbar.styleOverrides`, so a slot override never wins.
  // The `sm` query is MUI's own toolbar breakpoint, which is what these
  // values have to outrank.
  const handleToolbarHeightChange = useCallback(
    (breakpoint: 'xs' | 'sm') => (event) => {
      const value = Number(event.target.value)
      setDraft((prev) => {
        const toolbar = { ...(prev.mixins?.toolbar ?? {}) }
        const valid = Number.isFinite(value) && value > 0
        if (breakpoint === 'xs') {
          if (valid) toolbar.minHeight = `${value}px`
          else delete toolbar.minHeight
        } else if (valid) {
          toolbar[TOOLBAR_SM_QUERY] = { minHeight: `${value}px` }
        } else {
          delete toolbar[TOOLBAR_SM_QUERY]
        }
        const next = { ...prev }
        const heights = Object.keys(toolbar).filter(
          (key) => key !== TOOLBAR_LANDSCAPE_QUERY,
        )
        if (heights.length) {
          next.mixins = {
            toolbar: {
              ...toolbar,
              [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
            },
          }
        } else {
          delete next.mixins
        }
        return next
      })
    },
    [],
  )

  const [overridesOpen, setOverridesOpen] = useState(false)
  const handleOverridesSave = useCallback(
    (_, value) => {
      setDraft((prev) => {
        // Store only what differs from the theme's own overrides (AGL-1180).
        // The editor OPENS on those defaults, so saving untouched would
        // otherwise freeze a copy into the host document and stop it
        // tracking console.theme.ts.
        //
        // Dropping an entry is safe because what remains is DEEP-merged over
        // the theme at render time: an entry that names one leaf keeps the
        // rest of that component, including the style functions JSON cannot
        // represent. Emptying the editor to `{}` therefore does not strip
        // the component styling from the site — it just means this site adds
        // nothing of its own.
        const edited = (value ?? {}) as Record<string, unknown>
        const changed: Record<string, unknown> = {}
        for (const [key, entry] of Object.entries(edited)) {
          const inherited = inheritedComponents[key]
          if (inherited && deepEqual(entry, inherited, { strict: true })) {
            continue
          }
          changed[key] = entry
        }
        return sanitizeHostTheme({
          ...prev,
          components: changed as HostTheme['components'],
        })
      })
      setOverridesOpen(false)
    },
    [inheritedComponents],
  )

  const handleOverridesReset = useCallback(() => {
    setDraft((prev) => {
      const next = { ...prev }
      delete next.components
      return next
    })
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
                      inheritedValue={inheritedColor(key)}
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
                      inheritedValue={inheritedSurfaceColor(path)}
                      onChange={setSurfaceColor(path)}
                    />
                  ))}
                  <ColorField
                    label="Divider"
                    value={schemeColors?.divider}
                    inheritedValue={inheritedDivider}
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
              <MenuItem value={SYSTEM_FONT_VALUE}>
                {baseFontFamily
                  ? `Theme default (${baseFontFamily})`
                  : 'Theme default'}
              </MenuItem>
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
                  {`Border radius: ${draft.shape?.borderRadius ?? baseShapeRadius}px`}
                </Typography>
                <Slider
                  aria-label="border radius"
                  size="small"
                  min={0}
                  max={24}
                  value={draft.shape?.borderRadius ?? baseShapeRadius}
                  onChange={handleRadiusChange}
                />
              </Stack>
              <TextField
                type="number"
                size="small"
                label="Spacing unit (px)"
                value={draft.spacing ?? baseSpacing}
                onChange={handleSpacingChange}
                slotProps={{ htmlInput: { min: 2, max: 16 } }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  label="Nav height, mobile (px)"
                  value={readToolbarHeight(draft, 'xs') ?? DEFAULT_TOOLBAR_XS}
                  onChange={handleToolbarHeightChange('xs')}
                  slotProps={{ htmlInput: { min: 40, max: 160 } }}
                />
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  label="Nav height, desktop (px)"
                  helperText={`Applies from ${TOOLBAR_SM_MIN_WIDTH}px up`}
                  value={readToolbarHeight(draft, 'sm') ?? DEFAULT_TOOLBAR_SM}
                  onChange={handleToolbarHeightChange('sm')}
                  slotProps={{ htmlInput: { min: 40, max: 160 } }}
                />
              </Stack>
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
                {draft.components
                  ? `Advanced: ${
                      Object.keys(draft.components).length
                    } component override(s) on this site, deep-merged over the theme's own — name just the property you want to change and the rest of that component is inherited. Emptying the editor to {} drops this site's overrides; the theme's defaults still apply. Unknown components are stripped on apply.`
                  : `Advanced: no overrides on this site — it renders the theme's own ${
                      Object.keys(inheritedComponents).length
                    } component defaults, which the editor opens on. Edits are deep-merged, so you only need to name the property you're changing; only what differs is saved.`}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setOverridesOpen(true)}>
                  {'Edit overrides'}
                </Button>
                {/* Clearing the host's overrides IS resetting to the theme
                    defaults — with nothing stored, the site renders the
                    brand's own component styles. Saving `{}` from the editor
                    does the same thing; this is the one-click version. */}
                <Button
                  size="small"
                  color="error"
                  disabled={!draft.components}
                  onClick={handleOverridesReset}
                >
                  {'Reset to theme defaults'}
                </Button>
              </Stack>
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
          defaultValue={
            (draft.components ?? inheritedComponents) as any
          }
        />
      ) : null}
    </Grid>
  )
}
ThemeEditor.displayName = 'ThemeEditor'

export default ThemeEditor
