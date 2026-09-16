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

import {
  CONTRAST_AA,
  CONTRAST_AA_LARGE,
  contrastRatio,
  type HostThemeSource,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import { accessibleShade } from '@aglyn/shared-ui-theme/util/accessible-shade'
import { inheritedThemeColor } from '@aglyn/shared-ui-theme/util/theme-editor-defaults'
import {
  readDarkScheme,
  readFontFamily,
  readThemeColor,
  readToolbarHeight,
  resetComponentOverrides,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_CONTROLS,
  THEME_EDITOR_MEDIA_QUERIES,
  THEME_EDITOR_SCHEMES,
  writeBorderRadius,
  writeComponentOverride,
  writeDarkScheme,
  writeFontFamily,
  writeSpacing,
  writeThemeColor,
  writeToolbarHeight,
  type ThemeColorToken,
  type ThemeComponentOverrideLeaf,
  type ThemeEditorControlId,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import { prefersDarkInk } from '@aglyn/shared-util-tools/contrast'

/**
 * A theme proposal (AGL-2938): what a theme job hands a person to apply.
 *
 * Not a theme. A proposal is a set of theme editor controls set to values,
 * applied to whatever the site's theme is when the person applies it, through
 * the same writes the editor performs. A proposal that names three colors
 * changes three colors, and every control it does not name is untouched by
 * construction rather than by the model's restraint — which is what makes
 * "make it feel warmer" a targeted diff instead of a regenerated theme.
 *
 * Pure and free of anything server-side: the job step builds a proposal, and
 * the Theme section's widget previews and applies one, from this module.
 */

export const AI_THEME_PROPOSAL_VERSION = 1

/**
 * `modify` changes what the brief is about and nothing else; `create` is a
 * whole design over every control the editor has.
 */
export type AiThemeProposalMode = 'modify' | 'create'

export const AI_THEME_PROPOSAL_MODES: readonly AiThemeProposalMode[] = ['modify', 'create']

/** The parts of a theme a brief can be about. */
export type AiThemeChangeGroup =
  | 'color'
  | 'darkScheme'
  | 'typography'
  | 'shape'
  | 'spacing'
  | 'navigation'
  | 'components'

export const AI_THEME_CHANGE_GROUPS: readonly AiThemeChangeGroup[] = [
  'color',
  'darkScheme',
  'typography',
  'shape',
  'spacing',
  'navigation',
  'components',
]

/** The controls a proposal sets one value on; component overrides are leaves of their own. */
export type AiThemeValueControl = Exclude<ThemeEditorControlId, 'components'>

/** Every value control, as the catalog lists them. */
export const AI_THEME_VALUE_CONTROLS: readonly AiThemeValueControl[] = THEME_EDITOR_CONTROLS.filter(
  (control) => control.id !== 'components',
).map((control) => control.id as AiThemeValueControl)

/** One editor control set to a value, or back to its default with `null`. */
export interface AiThemeControlChange {
  control: AiThemeValueControl
  /** The scheme a color is set for; `null` for every other control. */
  scheme: HostThemeScheme | null
  value: string | number | null
  /** What the site had set when the proposal was made; `null` when it inherited. */
  before: string | number | null
}

/** A value the proposal carries that the model did not write, and why. */
export interface AiThemeCorrection {
  control: `color.${ThemeColorToken}`
  scheme: HostThemeScheme
  /** The value before the correction; `null` when the slot inherited. */
  from: string | null
  to: string
  /**
   * `contrast` — the pair fell below its bar and this is the nearest shade
   * of the foreground that clears it. `dark-value` — the proposal changed an
   * accent for light and gave no dark value, and this keeps the same hue
   * readable on the dark background.
   */
  reason: 'contrast' | 'dark-value'
  /** The colors a contrast correction was measured against. */
  against?: string[]
  /** The worst ratio before the correction. */
  ratio?: number
  /** The bar the pair has to clear. */
  required?: number
}

export interface AiThemeProposal {
  version: typeof AI_THEME_PROPOSAL_VERSION
  mode: AiThemeProposalMode
  /** One sentence naming what the proposal changes, in the brief's language. */
  summary: string
  /**
   * Where the site's theme came from when the proposal was made, which is
   * how the editor's Save stores it: an installed theme's edits become its
   * override patch, a default theme stores only the changed values, and a
   * site's own theme changes in place.
   */
  source: HostThemeSource
  changes: AiThemeControlChange[]
  components: ThemeComponentOverrideLeaf[]
  /** The site's own component overrides are dropped before `components` apply. */
  resetComponents: boolean
  corrections: AiThemeCorrection[]
  /** What the model proposed that the proposal leaves out, in words. */
  dropped: string[]
  /** Anything else a person should read before applying, in words. */
  notes: string[]
}

/* ------------------------------------------------------------------------ *
 * Reading and applying
 * ------------------------------------------------------------------------ */

/** The color token a control writes, or `null` for a control that is not a color. */
export function aiThemeColorToken(control: string): ThemeColorToken | null {
  return control.startsWith('color.')
    ? (control.slice('color.'.length) as ThemeColorToken)
    : null
}

/** What a control holds on a theme, as a proposal's `before` names it. */
export function readAiThemeControl(
  theme: HostTheme | undefined,
  control: AiThemeValueControl,
  scheme: HostThemeScheme | null,
): string | number | null {
  const token = aiThemeColorToken(control)
  if (token) return readThemeColor(theme, scheme ?? 'light', token) ?? null
  switch (control) {
    case 'darkScheme':
      return readDarkScheme(theme) === 'off' ? 'off' : null
    case 'fontFamily': {
      const family = readFontFamily(theme)
      return family === SYSTEM_FONT_VALUE ? null : family
    }
    case 'borderRadius':
      return typeof theme?.shape?.borderRadius === 'number' ? theme.shape.borderRadius : null
    case 'spacing':
      return typeof theme?.spacing === 'number' ? theme.spacing : null
    case 'navHeight.xs':
      return (theme && readToolbarHeight(theme, 'xs')) ?? null
    case 'navHeight.sm':
      return (theme && readToolbarHeight(theme, 'sm')) ?? null
    default:
      return null
  }
}

function applyControlChange(
  theme: HostTheme,
  change: Pick<AiThemeControlChange, 'control' | 'scheme' | 'value'>,
): HostTheme {
  const { control, scheme, value } = change
  const token = aiThemeColorToken(control)
  if (token) {
    return writeThemeColor(
      theme,
      scheme ?? 'light',
      token,
      typeof value === 'string' ? value : undefined,
    )
  }
  const number = typeof value === 'number' ? value : undefined
  switch (control) {
    case 'darkScheme':
      return writeDarkScheme(theme, value === 'off' ? 'off' : 'auto')
    case 'fontFamily':
      return writeFontFamily(theme, typeof value === 'string' ? value : SYSTEM_FONT_VALUE)
    case 'borderRadius':
      return writeBorderRadius(theme, number)
    case 'spacing':
      return writeSpacing(theme, number)
    case 'navHeight.xs':
      return writeToolbarHeight(theme, 'xs', number)
    case 'navHeight.sm':
      return writeToolbarHeight(theme, 'sm', number)
    default:
      return theme
  }
}

/**
 * The theme a set of changes produces on top of `theme`: each change written
 * the way the editor writes it, then the component overrides. Returns a new
 * object; `theme` is not mutated.
 */
export function applyAiThemeChanges(
  theme: HostTheme | undefined,
  proposal: {
    changes: ReadonlyArray<Pick<AiThemeControlChange, 'control' | 'scheme' | 'value'>>
    components: readonly ThemeComponentOverrideLeaf[]
    resetComponents: boolean
  },
): HostTheme {
  let next: HostTheme = { ...(theme ?? {}) }
  for (const change of proposal.changes) next = applyControlChange(next, change)
  if (proposal.resetComponents) next = resetComponentOverrides(next)
  for (const leaf of proposal.components) next = writeComponentOverride(next, leaf)
  return next
}

/* ------------------------------------------------------------------------ *
 * Scope: which parts of the theme a brief is about
 * ------------------------------------------------------------------------ */

/** The part of the theme a value control belongs to. */
export function aiThemeControlGroup(control: AiThemeValueControl): AiThemeChangeGroup {
  if (aiThemeColorToken(control)) return 'color'
  switch (control) {
    case 'darkScheme':
      return 'darkScheme'
    case 'fontFamily':
      return 'typography'
    case 'borderRadius':
      return 'shape'
    case 'spacing':
      return 'spacing'
    default:
      return 'navigation'
  }
}

/**
 * The part of the theme a component override belongs to: the type ramp's
 * overrides are typography, the app bar's and the toolbar's are navigation,
 * and the rest are components.
 */
export function aiThemeComponentGroup(
  component: ThemeComponentOverrideLeaf['component'],
): AiThemeChangeGroup {
  if (component === 'MuiTypography') return 'typography'
  if (component === 'MuiAppBar' || component === 'MuiToolbar') return 'navigation'
  return 'components'
}

/**
 * The words that tie a brief to a part of the theme, matched case-insensitively
 * on whole words. A brief can name several parts.
 */
const BRIEF_VOCABULARY: Record<AiThemeChangeGroup, RegExp> = {
  color:
    /(#[0-9a-f]{3,8}\b)|\b(colou?rs?|palettes?|hues?|warm(er|th|ly)?|cool(er)?|cold(er)?|contrast\w*|bright(er|ness)?|dark(er|en)?|light(er|en)?|saturat\w*|desaturat\w*|muted|vibrant|pastels?|tones?|tints?|shades?|accents?|primary|secondary|tertiary|backgrounds?|surfaces?|brand\w*|earthy|neon|moody|red|orange|yellow|green|blue|teal|purple|violet|pink|magenta|brown|beige|cream|gold|navy|black|white|gr[ae]y|hex)\b/i,
  darkScheme: /\b(dark (mode|scheme|theme)|light (mode|scheme)|always light|night mode)\b/i,
  typography:
    /\b(fonts?|typefaces?|typography|serif|sans|monospace|headings?|headlines?|titles?|type ?scale|text size|font size|lettering|weights?|bold(er)?|editorial)\b/i,
  shape: /\b(radius|radii|round(ed|er|ness)?|corners?|sharp(er)?|square(d|r)?|pills?|curv\w*)\b/i,
  spacing:
    /\b(spac\w*|padding|margins?|roomy|airy|tight(er)?|compact|dense|breathing room|white ?space|gaps?)\b/i,
  navigation: /\b(nav\w*|header height|toolbar|app ?bar|menu bar|top bar)\b/i,
  components:
    /\b(buttons?|cards?|chips?|inputs?|text ?fields?|links?|tabs?|switch(es)?|sliders?|avatars?|badges?|tooltips?|dividers?|menus?|components?|uppercase|capitali[sz]\w*|shadows?|elevation|outlined|underlin\w*)\b/i,
}

/**
 * The parts of the theme a job may change. A `create` job is a whole design.
 * A `modify` job may change only what its brief is about, so "make it feel
 * warmer" reaches the colors and nothing else; a brief that names no part at
 * all — in another language, or in words this does not know — is taken to
 * be about the whole design rather than refused.
 */
export function aiThemeBriefScope(
  brief: string,
  mode: AiThemeProposalMode,
): ReadonlySet<AiThemeChangeGroup> {
  if (mode === 'create') return new Set(AI_THEME_CHANGE_GROUPS)
  const named = AI_THEME_CHANGE_GROUPS.filter((group) => BRIEF_VOCABULARY[group].test(brief))
  return new Set(named.length ? named : AI_THEME_CHANGE_GROUPS)
}

const GROUP_WORDS: Record<AiThemeChangeGroup, string> = {
  color: 'colors',
  darkScheme: 'the dark scheme',
  typography: 'typography',
  shape: 'corners',
  spacing: 'spacing',
  navigation: 'navigation',
  components: 'component styles',
}

/* ------------------------------------------------------------------------ *
 * Colors as the site renders them, and dark values
 * ------------------------------------------------------------------------ */

const colorKey = (scheme: HostThemeScheme, token: ThemeColorToken) => `${scheme}:${token}`

/** A color as the site renders it in one scheme: its own value, else the brand's. */
export function effectiveThemeColor(
  theme: HostTheme | undefined,
  scheme: HostThemeScheme,
  token: ThemeColorToken,
): string | undefined {
  return readThemeColor(theme, scheme, token) ?? inheritedThemeColor(scheme, token)
}

/** The accents: the colors whose dark value can follow their light one. */
const ACCENT_TOKENS: ReadonlySet<ThemeColorToken> = new Set(
  THEME_COLOR_FIELDS.filter((field) => field.group === 'palette').map((field) => field.token),
)

/**
 * The colors a set of changes gives a light value and no dark one, while the
 * site's dark scheme is on. Each is a visitor in dark mode seeing half a
 * change.
 */
export function aiThemeMissingDarkValues(
  changes: ReadonlyArray<Pick<AiThemeControlChange, 'control' | 'scheme'>>,
  themeAfter: HostTheme,
): ThemeColorToken[] {
  if (readDarkScheme(themeAfter) === 'off') return []
  const set = new Set(
    changes
      .filter((change) => aiThemeColorToken(change.control))
      .map((change) =>
        colorKey(change.scheme ?? 'light', aiThemeColorToken(change.control) as ThemeColorToken),
      ),
  )
  return THEME_COLOR_FIELDS.map(({ token }) => token).filter(
    (token) => set.has(colorKey('light', token)) && !set.has(colorKey('dark', token)),
  )
}

/**
 * The dark value an accent keeps when a proposal gave none: the same hue,
 * lightened only as far as it takes to read on the dark background as a fill
 * or an indicator. Surfaces, text and tints have no such value — a pale light
 * surface lightened is still a light surface — so they go on inheriting the
 * platform's dark palette, which is what a site with no dark design renders.
 */
export function deriveAiThemeDarkAccent(light: string, themeAfter: HostTheme): string | null {
  const background = effectiveThemeColor(themeAfter, 'dark', 'background.default')
  if (!background) return null
  try {
    return accessibleShade(light, [background], 'lighten', { minContrast: CONTRAST_AA_LARGE })
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------------ */

/** A foreground that has to read on each of its backgrounds. */
export interface AiThemeContrastPair {
  foreground: ThemeColorToken
  backgrounds: readonly ThemeColorToken[]
  required: number
}

/**
 * The pairs a proposal is held to. Body text on the page and on paper, and
 * secondary text on the page, are the pairs the theme publish check
 * (`validateThemeForPublish`) measures, at its bars; the primary color on
 * the page is held to the bar a fill or an indicator owes.
 */
export const AI_THEME_CONTRAST_PAIRS: readonly AiThemeContrastPair[] = [
  {
    foreground: 'text.primary',
    backgrounds: ['background.default', 'background.paper'],
    required: CONTRAST_AA,
  },
  {
    foreground: 'text.secondary',
    backgrounds: ['background.default'],
    required: CONTRAST_AA,
  },
  {
    foreground: 'primary',
    backgrounds: ['background.default'],
    required: CONTRAST_AA_LARGE,
  },
]

const round2 = (ratio: number) => Math.round(ratio * 100) / 100

/**
 * Whether dark ink reads better than light ink on a background. A hex takes
 * the shared helper; anything else a theme can hold (`rgba()`) is measured
 * against black and white directly, which is the same comparison.
 */
function darkInkReads(background: string): boolean {
  const verdict = prefersDarkInk(background)
  if (verdict !== null) return verdict
  return (contrastRatio('#000000', background) ?? 0) >= (contrastRatio('#ffffff', background) ?? 0)
}

export interface AiThemeContrastResult {
  theme: HostTheme
  corrections: AiThemeCorrection[]
  notes: string[]
}

/**
 * Every pair a set of changes takes below its bar, corrected to the nearest
 * shade of its foreground that clears it, and named.
 *
 * Only pairs the changes touched are corrected. A pair that already fell
 * short with neither of its colors changed is named in `notes` and left
 * alone, because correcting it would change a color the brief did not ask
 * about. A dark scheme the site has switched off is not measured: no visitor
 * sees it.
 */
export function correctAiThemeContrast(
  themeAfter: HostTheme,
  touchedChanges: ReadonlyArray<Pick<AiThemeControlChange, 'control' | 'scheme'>>,
): AiThemeContrastResult {
  const touched = new Set(
    touchedChanges
      .filter((change) => aiThemeColorToken(change.control))
      .map((change) =>
        colorKey(change.scheme ?? 'light', aiThemeColorToken(change.control) as ThemeColorToken),
      ),
  )
  const schemes = THEME_EDITOR_SCHEMES.filter(
    (scheme) => scheme === 'light' || readDarkScheme(themeAfter) !== 'off',
  )
  let theme = themeAfter
  const corrections: AiThemeCorrection[] = []
  const notes: string[] = []
  for (const scheme of schemes) {
    for (const pair of AI_THEME_CONTRAST_PAIRS) {
      const foreground = effectiveThemeColor(theme, scheme, pair.foreground)
      const backgrounds = pair.backgrounds
        .map((token) => effectiveThemeColor(theme, scheme, token))
        .filter((value): value is string => typeof value === 'string')
      if (!foreground || backgrounds.length !== pair.backgrounds.length) continue
      const ratios = backgrounds.map((background) => contrastRatio(foreground, background))
      if (ratios.some((ratio) => ratio === null)) continue
      const worst = Math.min(...(ratios as number[]))
      if (worst >= pair.required) continue
      const involved = [pair.foreground, ...pair.backgrounds].some((token) =>
        touched.has(colorKey(scheme, token)),
      )
      if (!involved) {
        notes.push(
          `${pair.foreground} on ${pair.backgrounds.join(' and ')} in ${scheme} was already ` +
            `${round2(worst)}:1 before this proposal, below ${pair.required}:1.`,
        )
        continue
      }
      let corrected: string
      try {
        corrected = accessibleShade(
          foreground,
          backgrounds,
          darkInkReads(backgrounds[0]) ? 'darken' : 'lighten',
          { minContrast: pair.required },
        )
      } catch {
        continue
      }
      const clears = backgrounds.every(
        (background) => (contrastRatio(corrected, background) ?? 0) >= pair.required,
      )
      if (!clears) {
        notes.push(
          `${pair.foreground} cannot reach ${pair.required}:1 on the ${scheme} background by ` +
            'changing its shade alone; the background needs to change too.',
        )
        continue
      }
      corrections.push({
        control: `color.${pair.foreground}`,
        scheme,
        from: readThemeColor(theme, scheme, pair.foreground) ?? null,
        to: corrected,
        reason: 'contrast',
        against: backgrounds,
        ratio: round2(worst),
        required: pair.required,
      })
      theme = writeThemeColor(theme, scheme, pair.foreground, corrected)
    }
  }
  return { theme, corrections, notes }
}

/** Folds a correction into a change list: the change it corrects, or a new one. */
function withCorrection(
  changes: AiThemeControlChange[],
  correction: AiThemeCorrection,
  base: HostTheme | undefined,
): AiThemeControlChange[] {
  const index = changes.findIndex(
    (change) => change.control === correction.control && change.scheme === correction.scheme,
  )
  if (index >= 0) {
    return changes.map((change, at) => (at === index ? { ...change, value: correction.to } : change))
  }
  return [
    ...changes,
    {
      control: correction.control,
      scheme: correction.scheme,
      value: correction.to,
      before: readAiThemeControl(base, correction.control, correction.scheme),
    },
  ]
}

/* ------------------------------------------------------------------------ *
 * Building a proposal
 * ------------------------------------------------------------------------ */

export interface BuildAiThemeProposalInput {
  /** The site's theme as the editor shows it, overrides resolved. */
  base: HostTheme | undefined
  source: HostThemeSource
  mode: AiThemeProposalMode
  brief: string
  summary: string
  changes: ReadonlyArray<Pick<AiThemeControlChange, 'control' | 'scheme' | 'value'>>
  components: readonly ThemeComponentOverrideLeaf[]
  resetComponents: boolean
  /** What reading the model's answer already left out, in words. */
  dropped?: readonly string[]
  notes?: readonly string[]
}

/**
 * A proposal from what the model proposed, held to the editor and to the
 * doctrine: changes that change nothing are gone, a modify brief reaches
 * only the parts of the theme it names, accents keep a dark value, and every
 * pair the proposal touches clears its contrast bar.
 */
export function buildAiThemeProposal(input: BuildAiThemeProposalInput): AiThemeProposal {
  const dropped = [...(input.dropped ?? [])]
  const notes = [...(input.notes ?? [])]
  const scope = aiThemeBriefScope(input.brief, input.mode)
  const outOfScope = (group: AiThemeChangeGroup, what: string) => {
    dropped.push(`${what}: the brief did not ask about ${GROUP_WORDS[group]}`)
  }

  let changes: AiThemeControlChange[] = []
  for (const change of input.changes) {
    const before = readAiThemeControl(input.base, change.control, change.scheme)
    if (before === change.value) continue
    const group = aiThemeControlGroup(change.control)
    if (!scope.has(group)) {
      outOfScope(group, change.scheme ? `${change.control} (${change.scheme})` : change.control)
      continue
    }
    changes.push({ ...change, before })
  }
  const components = input.components.filter((leaf) => {
    const group = aiThemeComponentGroup(leaf.component)
    if (scope.has(group)) return true
    outOfScope(group, `${leaf.component}.${leaf.property}`)
    return false
  })
  let resetComponents = input.resetComponents
  if (resetComponents && !scope.has('components')) {
    outOfScope('components', 'Resetting the component overrides')
    resetComponents = false
  }

  const corrections: AiThemeCorrection[] = []
  let after = applyAiThemeChanges(input.base, { changes, components, resetComponents })
  for (const token of aiThemeMissingDarkValues(changes, after)) {
    const light = changes.find(
      (change) => change.scheme === 'light' && aiThemeColorToken(change.control) === token,
    )
    if (!ACCENT_TOKENS.has(token) || typeof light?.value !== 'string') {
      notes.push(`${token} keeps its current dark value; only its light value changes.`)
      continue
    }
    const dark = deriveAiThemeDarkAccent(light.value, after)
    if (!dark) continue
    const correction: AiThemeCorrection = {
      control: `color.${token}`,
      scheme: 'dark',
      from: readThemeColor(input.base, 'dark', token) ?? null,
      to: dark,
      reason: 'dark-value',
    }
    corrections.push(correction)
    changes = withCorrection(changes, correction, input.base)
    after = writeThemeColor(after, 'dark', token, dark)
  }

  const contrast = correctAiThemeContrast(after, changes)
  for (const correction of contrast.corrections) {
    corrections.push(correction)
    changes = withCorrection(changes, correction, input.base)
  }
  notes.push(...contrast.notes)

  return {
    version: AI_THEME_PROPOSAL_VERSION,
    mode: input.mode,
    summary: input.summary,
    source: input.source,
    changes,
    components,
    resetComponents,
    corrections,
    dropped,
    notes,
  }
}

/**
 * What applying a proposal to the site's CURRENT theme produces, held to the
 * contrast bars again: the theme may have changed since the proposal was
 * made, and a proposal that cleared its bars against the old background can
 * fall short against the new one. The corrections this makes are named
 * beside the proposal's own.
 */
export function aiThemeProposalAfter(
  theme: HostTheme | undefined,
  proposal: Pick<AiThemeProposal, 'changes' | 'components' | 'resetComponents'>,
): AiThemeContrastResult {
  const applied = applyAiThemeChanges(theme, proposal)
  return correctAiThemeContrast(applied, proposal.changes)
}

/** The changes whose `before` no longer matches the theme a proposal is applied to. */
export function aiThemeStaleChanges(
  theme: HostTheme | undefined,
  proposal: Pick<AiThemeProposal, 'changes'>,
): AiThemeControlChange[] {
  return proposal.changes.filter(
    (change) => readAiThemeControl(theme, change.control, change.scheme) !== change.before,
  )
}

/* ------------------------------------------------------------------------ *
 * Reading a stored proposal back
 * ------------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const scalar = (value: unknown): string | number | null =>
  typeof value === 'string' || typeof value === 'number' ? value : null

const VALUE_CONTROLS: ReadonlySet<string> = new Set(AI_THEME_VALUE_CONTROLS)

/**
 * A proposal as a job output stores it, or `null` for anything that is not
 * one. The job writes these through the Admin SDK and nothing else can, but
 * a reader that applies what it reads to a theme checks the shape first.
 */
export function readAiThemeProposal(value: unknown): AiThemeProposal | null {
  if (!isRecord(value) || value['version'] !== AI_THEME_PROPOSAL_VERSION) return null
  const mode = value['mode'] === 'create' ? 'create' : 'modify'
  const source =
    value['source'] === 'installed' || value['source'] === 'custom' ? value['source'] : 'default'
  const changes = (Array.isArray(value['changes']) ? value['changes'] : [])
    .filter(isRecord)
    .filter((change) => VALUE_CONTROLS.has(String(change['control'])))
    .map(
      (change): AiThemeControlChange => ({
        control: change['control'] as AiThemeValueControl,
        scheme: change['scheme'] === 'light' || change['scheme'] === 'dark' ? change['scheme'] : null,
        value: scalar(change['value']),
        before: scalar(change['before']),
      }),
    )
  const components = (Array.isArray(value['components']) ? value['components'] : [])
    .filter(isRecord)
    .filter(
      (leaf) =>
        (THEME_EDITOR_CONTROLS.find((control) => control.id === 'components')?.options ?? []).includes(
          String(leaf['component']),
        ) &&
        (leaf['target'] === 'styleOverrides' || leaf['target'] === 'defaultProps') &&
        typeof leaf['property'] === 'string' &&
        ['string', 'number', 'boolean'].includes(typeof leaf['value']) &&
        (leaf['media'] === null || String(leaf['media']) in THEME_EDITOR_MEDIA_QUERIES),
    )
    .map(
      (leaf): ThemeComponentOverrideLeaf => ({
        component: leaf['component'] as ThemeComponentOverrideLeaf['component'],
        target: leaf['target'] as ThemeComponentOverrideLeaf['target'],
        slot: typeof leaf['slot'] === 'string' ? leaf['slot'] : null,
        property: leaf['property'] as string,
        media: (leaf['media'] as ThemeComponentOverrideLeaf['media']) ?? null,
        value: leaf['value'] as string | number | boolean,
      }),
    )
  const corrections = (Array.isArray(value['corrections']) ? value['corrections'] : [])
    .filter(isRecord)
    .filter(
      (correction) =>
        aiThemeColorToken(String(correction['control'])) !== null &&
        (correction['scheme'] === 'light' || correction['scheme'] === 'dark') &&
        typeof correction['to'] === 'string',
    )
    .map(
      (correction): AiThemeCorrection => ({
        control: correction['control'] as AiThemeCorrection['control'],
        scheme: correction['scheme'] as HostThemeScheme,
        from: typeof correction['from'] === 'string' ? correction['from'] : null,
        to: correction['to'] as string,
        reason: correction['reason'] === 'dark-value' ? 'dark-value' : 'contrast',
        ...(Array.isArray(correction['against']) ? { against: strings(correction['against']) } : {}),
        ...(typeof correction['ratio'] === 'number' ? { ratio: correction['ratio'] } : {}),
        ...(typeof correction['required'] === 'number' ? { required: correction['required'] } : {}),
      }),
    )
  return {
    version: AI_THEME_PROPOSAL_VERSION,
    mode,
    summary: typeof value['summary'] === 'string' ? value['summary'] : '',
    source,
    changes,
    components,
    resetComponents: value['resetComponents'] === true,
    corrections,
    dropped: strings(value['dropped']),
    notes: strings(value['notes']),
  }
}
