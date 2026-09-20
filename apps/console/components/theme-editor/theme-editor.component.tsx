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

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  consoleOptions,
  getGoogleFontsUrl,
  sanitizeHostTheme,
  useHostSiteKey,
} from '@aglyn/shared-ui-theme'
import { deepEqual } from '@aglyn/shared-util-vendor/deep-equal'
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
  BORDER_RADIUS_FIELD,
  COMPONENT_OVERRIDES_FIELD,
  copyThemeSchemeColors,
  DARK_SCHEME_FIELD,
  DEFAULT_TOOLBAR_SM,
  DEFAULT_TOOLBAR_XS,
  FONT_FAMILY_FIELD,
  GOOGLE_FONT_OPTIONS,
  INHERITED_BORDER_RADIUS,
  INHERITED_FONT_FAMILY,
  INHERITED_SPACING,
  inheritedThemeColor,
  orderSensitiveKey,
  readDarkScheme,
  readFontFamily,
  readThemeColor,
  readToolbarHeight,
  resetComponentOverrides,
  SPACING_FIELD,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  type ThemeColorGroup,
  type ThemeColorToken,
  TOOLBAR_HEIGHT_FIELDS,
  TOOLBAR_SM_MIN_WIDTH,
  writeBorderRadius,
  writeDarkScheme,
  writeFontFamily,
  writeSpacing,
  writeThemeColor,
  writeToolbarHeight,
} from './theme-editor.constants'
import ThemePreview from './theme-preview.component'

const JsonEditor = dynamic<JsonEditorProps>(
  () => import('@aglyn/shared-ui-json-editor').then((mod) => mod.JsonEditor),
  { ssr: false },
)

/**
 * A theme handed to the editor from outside it — a proposal someone chose to
 * put in the editor — keyed so the editor adopts each one once, and a parent
 * re-rendering with the same proposal does not throw away the edits made on
 * top of it.
 */
export interface ThemeEditorProposedDraft {
  key: string
  theme: HostTheme
}

export interface ThemeEditorProps {
  /** Saved theme from the host document. */
  theme: HostTheme | undefined
  saving?: boolean
  onSave: (theme: HostTheme) => Promise<void> | void
  /**
   * A theme to show in place of the current draft, unsaved: Save writes it
   * through `onSave` like any edit, and Discard goes back to the saved theme.
   */
  proposedDraft?: ThemeEditorProposedDraft | null
  /** Called once the proposed draft has been saved, discarded or reset. */
  onProposedDraftSettled?: () => void
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

/**
 * Host theme editor: palette, typography, shape/spacing controls with a live
 * preview per color scheme. All edits stay in local draft state until Save.
 *
 * Every control, its bounds and its write come from the shared field catalog
 * (`THEME_EDITOR_CONTROLS`, AGL-2938), which is also what anything else that
 * proposes a theme change offers — so the two cannot offer different
 * controls or write the same one differently.
 */
export function ThemeEditor(props: ThemeEditorProps) {
  const { theme, saving, onSave, proposedDraft, onProposedDraftSettled } = props
  const [draft, setDraft] = useState<HostTheme>(() => theme ?? {})
  const [scheme, setScheme] = useState<HostThemeScheme>('light')
  // The site being edited, from the host route this editor is mounted on.
  // Every "Default" and the preview beside them resolve the base from it,
  // which is the base the published page builds on (AGL-3068).
  const siteKey = useHostSiteKey()

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
  /**
   * A proposed draft is adopted the same way, once per key. Once it settles
   * the key is forgotten, so putting the same proposal back in the editor
   * after discarding it adopts it again.
   */
  const proposalKey = proposedDraft?.key ?? null
  const [adoptedKey, setAdoptedKey] = useState<string | null>(null)
  if (proposedDraft && proposalKey !== adoptedKey) {
    setAdoptedKey(proposalKey)
    setDraft(proposedDraft.theme)
  } else if (!proposedDraft && adoptedKey !== null) {
    setAdoptedKey(null)
  }
  // Sanitize both sides and compare order-insensitively (AGL-56): the saved
  // doc round-trips through Firestore with different key order than the local
  // draft, and the draft is only sanitized at save time — a string compare
  // left the save buttons enabled forever after the first save.
  //
  // …except where key order IS the meaning. See `orderSensitiveKey`.
  const dirty = useMemo(() => {
    const next = sanitizeHostTheme(draft)
    const saved = sanitizeHostTheme(theme ?? {})
    return (
      !deepEqual(next, saved, { strict: true }) ||
      orderSensitiveKey(next) !== orderSensitiveKey(saved)
    )
  }, [draft, theme])
  const previewFontsHref = getGoogleFontsUrl(draft.fonts)

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

  const setDarkScheme = useCallback((value: string) => {
    setDraft((prev) => writeDarkScheme(prev, value === 'off' ? 'off' : 'auto'))
  }, [])

  const setColor = useCallback(
    (token: ThemeColorToken) => (hex: string | undefined) => {
      setDraft((prev) => writeThemeColor(prev, scheme, token, hex))
    },
    [scheme],
  )

  const copyFromOtherScheme = useCallback(() => {
    setDraft((prev) =>
      copyThemeSchemeColors(prev, scheme === 'light' ? 'dark' : 'light', scheme),
    )
  }, [scheme])

  const activeFontFamily = useMemo(() => readFontFamily(draft), [draft])

  const handleFontChange = useCallback((event) => {
    const value = event.target.value as string
    setDraft((prev) => writeFontFamily(prev, value))
  }, [])

  const handleRadiusChange = useCallback((_, value: number | number[]) => {
    setDraft((prev) => writeBorderRadius(prev, value as number))
  }, [])

  const handleSpacingChange = useCallback((event) => {
    const value = Number(event.target.value)
    setDraft((prev) => writeSpacing(prev, value))
  }, [])

  // Nav height has to travel as `mixins.toolbar` (AGL-1242) — MUI builds the
  // Toolbar's `regular` variant from it and applies that variant AFTER
  // `components.MuiToolbar.styleOverrides`, so a slot override never wins.
  // The `sm` query is MUI's own toolbar breakpoint, which is what these
  // values have to outrank.
  const handleToolbarHeightChange = useCallback(
    (breakpoint: 'xs' | 'sm') => (event) => {
      const value = Number(event.target.value)
      setDraft((prev) => writeToolbarHeight(prev, breakpoint, value))
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
    setDraft((prev) => resetComponentOverrides(prev))
  }, [])

  const handleDiscard = useCallback(() => {
    setDraft(theme ?? {})
    onProposedDraftSettled?.()
  }, [theme, onProposedDraftSettled])

  const handleReset = useCallback(() => {
    setDraft({})
    onProposedDraftSettled?.()
  }, [onProposedDraftSettled])

  const handleSave = useCallback(() => {
    onProposedDraftSettled?.()
    return onSave(sanitizeHostTheme(draft))
  }, [draft, onSave, onProposedDraftSettled])

  const renderColorFields = (group: ThemeColorGroup) =>
    THEME_COLOR_FIELDS.filter((field) => field.group === group).map(
      ({ token, label }) => (
        <ColorField
          key={token}
          label={label}
          value={readThemeColor(draft, scheme, token)}
          // What the slot resolves to when it is left unset — the palette
          // THIS site renders over (AGL-1180, AGL-3068) — so every "Default"
          // names its color and a single change is attributable.
          inheritedValue={inheritedThemeColor(scheme, token, siteKey)}
          onChange={setColor(token)}
        />
      ),
    )

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
            <TextField
              select
              size="small"
              label={DARK_SCHEME_FIELD.label}
              value={readDarkScheme(draft)}
              onChange={(event) => setDarkScheme(event.target.value)}
              helperText={
                draft.darkScheme === 'off'
                  ? 'Every visitor sees light, and the theme mode switcher is hidden on published pages.'
                  : 'Follows each visitor; anything unset under Dark comes from the default dark palette.'
              }
              sx={{ mb: 2 }}
            >
              {DARK_SCHEME_FIELD.options.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
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
                  {renderColorFields('palette')}
                  <Typography variant="subtitle2">
                    {'Background & text'}
                  </Typography>
                  {renderColorFields('surface')}
                  {/* Pale accent washes (AGL-1244). Own heading rather than a
                      tail on "Background & text": these are fills for tiles
                      and panels, and each one is named after the accent whose
                      icon sits on it. */}
                  <Typography variant="subtitle2">{'Tints'}</Typography>
                  {renderColorFields('tint')}
                  {renderColorFields('divider')}
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
              label={FONT_FAMILY_FIELD.label}
              value={activeFontFamily}
              onChange={handleFontChange}
            >
              {/* The inherited stack is a long CSS font list; its first family
                  names what "Theme default" actually gives you. */}
              <MenuItem value={SYSTEM_FONT_VALUE}>
                {INHERITED_FONT_FAMILY
                  ? `Theme default (${INHERITED_FONT_FAMILY})`
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
                  {`${BORDER_RADIUS_FIELD.label}: ${draft.shape?.borderRadius ?? INHERITED_BORDER_RADIUS}px`}
                </Typography>
                <Slider
                  aria-label={BORDER_RADIUS_FIELD.label}
                  size="small"
                  min={BORDER_RADIUS_FIELD.min}
                  max={BORDER_RADIUS_FIELD.max}
                  step={BORDER_RADIUS_FIELD.step}
                  value={draft.shape?.borderRadius ?? INHERITED_BORDER_RADIUS}
                  onChange={handleRadiusChange}
                />
              </Stack>
              <TextField
                type="number"
                size="small"
                label={SPACING_FIELD.label}
                value={draft.spacing ?? INHERITED_SPACING}
                onChange={handleSpacingChange}
                slotProps={{
                  htmlInput: {
                    min: SPACING_FIELD.min,
                    max: SPACING_FIELD.max,
                    step: SPACING_FIELD.step,
                  },
                }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  label={TOOLBAR_HEIGHT_FIELDS.xs.label}
                  value={readToolbarHeight(draft, 'xs') ?? DEFAULT_TOOLBAR_XS}
                  onChange={handleToolbarHeightChange('xs')}
                  slotProps={{
                    htmlInput: {
                      min: TOOLBAR_HEIGHT_FIELDS.xs.min,
                      max: TOOLBAR_HEIGHT_FIELDS.xs.max,
                      step: TOOLBAR_HEIGHT_FIELDS.xs.step,
                    },
                  }}
                />
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  label={TOOLBAR_HEIGHT_FIELDS.sm.label}
                  helperText={`Applies from ${TOOLBAR_SM_MIN_WIDTH}px up`}
                  value={readToolbarHeight(draft, 'sm') ?? DEFAULT_TOOLBAR_SM}
                  onChange={handleToolbarHeightChange('sm')}
                  slotProps={{
                    htmlInput: {
                      min: TOOLBAR_HEIGHT_FIELDS.sm.min,
                      max: TOOLBAR_HEIGHT_FIELDS.sm.max,
                      step: TOOLBAR_HEIGHT_FIELDS.sm.step,
                    },
                  }}
                />
              </Stack>
            </Stack>
          </CardDisplay>

          <CardDisplay
            contentGutterY
            contentGutterX
            header={COMPONENT_OVERRIDES_FIELD.label}
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
          <ThemePreview theme={draft} scheme={scheme} host={siteKey} />
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
