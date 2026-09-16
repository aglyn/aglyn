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

import type { HostThemeScheme } from '@aglyn/shared-data-types'
import {
  COMPONENT_OVERRIDES_FIELD,
  SYSTEM_FONT_VALUE,
  THEME_EDITOR_CONTROLS,
  THEME_EDITOR_MEDIA_QUERIES,
  themeEditorControl,
  type ThemeColorToken,
  type ThemeComponentOverrideLeaf,
  type ThemeEditorControl,
  type ThemeEditorControlId,
  type ThemeEditorMedia,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import type { AiThemeControlChange, AiThemeValueControl } from '../model/ai-theme-proposal'
import type { AiTool } from '../providers/contract'
import { AI_SX_ALLOWED_KEYS, HOSTILE_TEXT, SX_VALUE } from '../runtime/ai-node-tree'

/**
 * The theme tool (AGL-2938): the one structured-output tool a theme job asks
 * the model to call, DERIVED from the theme editor's field catalog.
 *
 * Every property of the schema carries editor controls, and every editor
 * control is carried by a property — `ai-theme-tool.spec.ts` holds both
 * directions — so the model is offered exactly what a person editing the
 * theme is offered: the same color tokens, the same fonts, the same bounds
 * and the same component whitelist. A control added to the editor fails that
 * spec until it is offered here too.
 *
 * The schema is strict, which on the providers that enforce it means every
 * object forbids extra keys, every key is required, and "no change" is said
 * with `null`. Numeric bounds are not keywords a strict schema accepts, so
 * they are stated in the descriptions and enforced by
 * {@link parseAiThemeToolInput}, from the same catalog entries.
 */

export const AI_THEME_TOOL_NAME = 'propose_theme_changes'

/** The value that returns a color or a number to its default. */
export const AI_THEME_TOOL_DEFAULT = 'default'

/** The catalog's color controls, which the `colors` property carries. */
export const AI_THEME_COLOR_CONTROLS: readonly ThemeEditorControl[] = THEME_EDITOR_CONTROLS.filter(
  (control) => control.kind === 'color',
)

/** How many component override leaves one call may carry. */
export const AI_THEME_TOOL_MAX_COMPONENT_LEAVES = 40

/** The longest summary a proposal keeps. */
export const AI_THEME_SUMMARY_MAX_CHARS = 300

/**
 * Which schema property carries which editor controls. `colors` carries
 * every color control in both schemes; the rest carry one control each, and
 * the two component properties both carry the JSON overrides control.
 */
export const AI_THEME_TOOL_PROPERTIES: ReadonlyArray<{
  property: string
  controls: readonly ThemeEditorControlId[]
}> = [
  { property: 'colors', controls: AI_THEME_COLOR_CONTROLS.map((control) => control.id) },
  { property: 'darkScheme', controls: ['darkScheme'] },
  { property: 'fontFamily', controls: ['fontFamily'] },
  { property: 'borderRadius', controls: ['borderRadius'] },
  { property: 'spacing', controls: ['spacing'] },
  { property: 'navHeightMobile', controls: ['navHeight.xs'] },
  { property: 'navHeightDesktop', controls: ['navHeight.sm'] },
  { property: 'componentOverrides', controls: ['components'] },
  { property: 'resetComponentOverrides', controls: ['components'] },
]

/** Properties that carry no editor control: what the call says about itself. */
export const AI_THEME_TOOL_META_PROPERTIES = ['summary'] as const

/**
 * Parity between the editor's catalog and the tool, in both directions: the
 * controls the tool does not offer, and the control ids it offers that the
 * catalog does not have. Both are empty, or the tool and the editor offer
 * different things.
 */
export function aiThemeToolParity(
  controls: ReadonlyArray<Pick<ThemeEditorControl, 'id'>> = THEME_EDITOR_CONTROLS,
): { unoffered: string[]; unknown: string[] } {
  const offered = new Set<string>(AI_THEME_TOOL_PROPERTIES.flatMap((entry) => entry.controls))
  const catalog = new Set<string>(controls.map((control) => control.id))
  return {
    unoffered: [...catalog].filter((id) => !offered.has(id)),
    unknown: [...offered].filter((id) => !catalog.has(id)),
  }
}

/**
 * The style properties a component override may set: the node validator's
 * allowlist less the `sx` shorthands (`p`, `bgcolor`, `typography`…), which a
 * style override does not expand.
 */
const SX_SHORTHANDS = new Set([
  'm', 'mt', 'mr', 'mb', 'ml', 'mx', 'my',
  'p', 'pt', 'pr', 'pb', 'pl', 'px', 'py',
  'bgcolor', 'typography',
])
export const AI_THEME_STYLE_PROPERTIES: readonly string[] = [...AI_SX_ALLOWED_KEYS].filter(
  (key) => !SX_SHORTHANDS.has(key),
)

/**
 * The component props a theme may set a default for: the ones that choose
 * among a component's own looks. Nothing that changes what an element IS — an
 * `href`, a `component`, a handler — is a theme's to default.
 */
export const AI_THEME_DEFAULT_PROPS: readonly string[] = [
  'align',
  'centered',
  'color',
  'disableElevation',
  'disableRipple',
  'elevation',
  'fullWidth',
  'gutterBottom',
  'indicatorColor',
  'margin',
  'noWrap',
  'size',
  'square',
  'textColor',
  'underline',
  'variant',
]

/** A literal color written as a hex or a color function. */
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i

/** The CSS named colors, which are literal colors as surely as a hex is. */
const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

/** Whether a CSS value carries a literal color, which belongs to the palette. */
export function carriesLiteralColor(value: string): boolean {
  if (LITERAL_COLOR.test(value)) return true
  return (value.toLowerCase().match(/[a-z]+/g) ?? []).some((word) => NAMED_COLORS.has(word))
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,63}$/
const PROP_TOKEN = /^[A-Za-z][A-Za-z0-9-]{0,39}$/

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
})

const rangeText = (control: ThemeEditorControl) => `from ${control.min} to ${control.max}`

function numberProperty(id: ThemeEditorControlId, what: string): Record<string, unknown> {
  const control = themeEditorControl(id)
  return {
    anyOf: [
      { type: 'integer' },
      { type: 'string', enum: [AI_THEME_TOOL_DEFAULT] },
      { type: 'null' },
    ],
    description:
      `${what}, in px, a whole number ${rangeText(control)}. ` +
      `"${AI_THEME_TOOL_DEFAULT}" returns it to the theme default; null leaves it as it is.`,
  }
}

function colorValue(scheme: HostThemeScheme): Record<string, unknown> {
  return {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    description:
      `The ${scheme} scheme's value: a hex color #rrggbb, "${AI_THEME_TOOL_DEFAULT}" to return ` +
      `it to the theme default, or null to leave the ${scheme} value as it is.`,
  }
}

/**
 * The tool, built from the catalog. Deterministic for a given catalog, so its
 * bytes are the same on every request and it sits inside the cached prefix.
 */
export function aiThemeTool(): AiTool {
  const darkScheme = themeEditorControl('darkScheme')
  const fontFamily = themeEditorControl('fontFamily')
  const properties: Record<string, Record<string, unknown>> = {
    summary: {
      type: 'string',
      description: 'One sentence, in the language of the brief, naming what this proposal changes.',
    },
    colors: {
      type: 'array',
      description:
        'Color changes, one entry per token. Give the light and the dark value together: a ' +
        'color changed for one scheme and left unsaid for the other is half a change.',
      items: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            enum: AI_THEME_COLOR_CONTROLS.map((control) => control.token as ThemeColorToken),
            description:
              'A palette color (primary, secondary, tertiary, surface, error, warning, info, ' +
              'success), a background (background.default is the page, background.paper cards ' +
              'and menus), a text color, a pale accent tint, or the divider.',
          },
          light: colorValue('light'),
          dark: colorValue('dark'),
        },
        required: ['token', 'light', 'dark'],
        additionalProperties: false,
      },
    },
    darkScheme: nullable({
      type: 'string',
      enum: darkScheme.options,
      description:
        '"auto" lets visitors in dark mode see the dark scheme; "off" keeps every visitor on ' +
        'light. null leaves it as it is.',
    }),
    fontFamily: nullable({
      type: 'string',
      enum: fontFamily.options,
      description:
        `The site's font, from the curated list; "${SYSTEM_FONT_VALUE}" is the theme default. ` +
        'null leaves it as it is.',
    }),
    borderRadius: numberProperty('borderRadius', 'The corner radius'),
    spacing: numberProperty('spacing', 'The spacing unit every gap and padding is a multiple of'),
    navHeightMobile: numberProperty('navHeight.xs', 'The navigation bar height on phones'),
    navHeightDesktop: numberProperty(
      'navHeight.sm',
      'The navigation bar height from the tablet breakpoint up',
    ),
    componentOverrides: {
      type: 'array',
      description:
        'Component styles beyond the palette and typography, one leaf each. A style names a ' +
        'slot and a camelCase CSS property; a default names a prop. A style never carries a ' +
        'literal color: color belongs to the palette.',
      items: {
        type: 'object',
        properties: {
          component: { type: 'string', enum: [...COMPONENT_OVERRIDES_FIELD.components] },
          target: { type: 'string', enum: ['styleOverrides', 'defaultProps'] },
          slot: nullable({
            type: 'string',
            description: 'The style slot (root, contained, h1); null for a default prop.',
          }),
          property: {
            type: 'string',
            description: 'A camelCase CSS property for a style, or the prop for a default.',
          },
          media: nullable({
            type: 'string',
            enum: Object.keys(THEME_EDITOR_MEDIA_QUERIES),
            description: 'Scopes a style to phones or to wider screens; null for every width.',
          }),
          value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        },
        required: ['component', 'target', 'slot', 'property', 'media', 'value'],
        additionalProperties: false,
      },
    },
    resetComponentOverrides: {
      type: 'boolean',
      description:
        "true drops the site's own component overrides before any above apply, so the theme's " +
        'defaults show again.',
    },
  }
  return {
    name: AI_THEME_TOOL_NAME,
    description:
      "Propose changes to the site's theme. Name only the controls the brief is about; every " +
      'control left out keeps its current value. Call this once.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  }
}

/** What a tool call proposes, held to the editor's constraints. */
export interface AiThemeToolParse {
  summary: string
  changes: Array<Omit<AiThemeControlChange, 'before'>>
  components: ThemeComponentOverrideLeaf[]
  resetComponents: boolean
  /** What the call wrote that the editor would not accept, in words. */
  dropped: string[]
  /** What was kept only once it was brought inside the editor's bounds. */
  notes: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const quoted = (value: unknown) => `"${String(value).slice(0, 40)}"`

/** `#abc` or `#aabbcc` as the editor's picker writes it: six lowercase digits. */
export function normalizeThemeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!HEX.test(trimmed)) return null
  const digits = trimmed.slice(1).toLowerCase()
  return `#${digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits}`
}

function parseColorValue(raw: unknown, where: string, dropped: string[]): string | null | undefined {
  if (raw === null || raw === undefined) return undefined
  if (raw === AI_THEME_TOOL_DEFAULT) return null
  const hex = typeof raw === 'string' ? normalizeThemeHex(raw) : null
  if (hex) return hex
  dropped.push(`${where}: ${quoted(raw)} is not a hex color`)
  return undefined
}

function parseNumber(
  raw: unknown,
  id: ThemeEditorControlId,
  dropped: string[],
  notes: string[],
): number | null | undefined {
  if (raw === null || raw === undefined) return undefined
  if (raw === AI_THEME_TOOL_DEFAULT) return null
  const control = themeEditorControl(id)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    dropped.push(`${control.label}: ${quoted(raw)} is not a number`)
    return undefined
  }
  const bounded = Math.min(control.max as number, Math.max(control.min as number, Math.round(raw)))
  if (bounded !== raw) {
    notes.push(`${control.label}: ${raw} is outside ${rangeText(control)}, so ${bounded} is proposed.`)
  }
  return bounded
}

function parseComponentLeaf(
  raw: unknown,
  index: number,
  dropped: string[],
): ThemeComponentOverrideLeaf | null {
  const where = `componentOverrides[${index}]`
  if (!isRecord(raw)) {
    dropped.push(`${where}: not an object`)
    return null
  }
  const component = String(raw['component'] ?? '')
  if (!(COMPONENT_OVERRIDES_FIELD.components as readonly string[]).includes(component)) {
    dropped.push(`${where}: ${component || 'the component'} is not one a theme may override`)
    return null
  }
  const target =
    raw['target'] === 'defaultProps' || raw['target'] === 'styleOverrides' ? raw['target'] : null
  if (!target) {
    dropped.push(`${where}: target must be styleOverrides or defaultProps`)
    return null
  }
  const property = String(raw['property'] ?? '')
  const value = raw['value']
  const named = `${component}.${property || '?'}`
  if (target === 'defaultProps') {
    if (!AI_THEME_DEFAULT_PROPS.includes(property)) {
      dropped.push(`${named}: not a prop a theme may set a default for`)
      return null
    }
    const valid =
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && PROP_TOKEN.test(value))
    if (!valid) {
      dropped.push(`${named}: ${quoted(value)} is not a value a prop default may take`)
      return null
    }
    return {
      component: component as ThemeComponentOverrideLeaf['component'],
      target,
      slot: null,
      property,
      media: null,
      value: value as string | number | boolean,
    }
  }
  if (!AI_THEME_STYLE_PROPERTIES.includes(property)) {
    dropped.push(`${named}: not a style a theme may set`)
    return null
  }
  const slot = raw['slot'] === null || raw['slot'] === undefined ? 'root' : String(raw['slot'])
  if (!IDENTIFIER.test(slot)) {
    dropped.push(`${named}: ${quoted(slot)} is not a style slot`)
    return null
  }
  const media =
    raw['media'] === null || raw['media'] === undefined
      ? null
      : String(raw['media']) in THEME_EDITOR_MEDIA_QUERIES
        ? (raw['media'] as ThemeEditorMedia)
        : undefined
  if (media === undefined) {
    dropped.push(`${named}: media must be mobile, desktop or null`)
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      dropped.push(`${named}: not a finite number`)
      return null
    }
    return {
      component: component as ThemeComponentOverrideLeaf['component'],
      target,
      slot,
      property,
      media,
      value,
    }
  }
  if (typeof value !== 'string') {
    dropped.push(`${named}: a style takes a string or a number`)
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || HOSTILE_TEXT.test(trimmed) || !SX_VALUE.test(trimmed)) {
    dropped.push(`${named}: ${quoted(trimmed)} is not a value a style may take`)
    return null
  }
  if (carriesLiteralColor(trimmed)) {
    dropped.push(`${named}: a color belongs to the palette, not to a component style`)
    return null
  }
  return {
    component: component as ThemeComponentOverrideLeaf['component'],
    target,
    slot,
    property,
    media,
    value: trimmed,
  }
}

/**
 * A tool call's input, held to the editor's constraints: tokens and fonts
 * from the catalog, hex colors as the picker writes them, numbers inside the
 * editor's bounds, and component leaves on the whitelist with safe values
 * and no literal color. What does not hold is dropped and named rather than
 * guessed at; a number out of bounds is brought inside them and named.
 */
export function parseAiThemeToolInput(input: Record<string, unknown>): AiThemeToolParse {
  const dropped: string[] = []
  const notes: string[] = []
  const changes: AiThemeToolParse['changes'] = []
  const summary = String(input['summary'] ?? '').trim().slice(0, AI_THEME_SUMMARY_MAX_CHARS)

  const colorControls = new Set<string>(AI_THEME_COLOR_CONTROLS.map((control) => control.id))
  const rawColors = Array.isArray(input['colors']) ? input['colors'] : []
  const seen = new Set<string>()
  for (const [index, entry] of rawColors.slice(0, AI_THEME_COLOR_CONTROLS.length * 2).entries()) {
    if (!isRecord(entry)) {
      dropped.push(`colors[${index}]: not an object`)
      continue
    }
    const control = `color.${String(entry['token'] ?? '')}`
    if (!colorControls.has(control)) {
      dropped.push(`colors[${index}]: ${quoted(entry['token'])} is not a theme color`)
      continue
    }
    if (seen.has(control)) {
      dropped.push(`${control}: named twice; the first value is kept`)
      continue
    }
    seen.add(control)
    for (const scheme of ['light', 'dark'] as const) {
      const value = parseColorValue(entry[scheme], `${control} (${scheme})`, dropped)
      if (value === undefined) continue
      changes.push({ control: control as AiThemeValueControl, scheme, value })
    }
  }

  const darkScheme = input['darkScheme']
  if (darkScheme === 'auto' || darkScheme === 'off') {
    changes.push({ control: 'darkScheme', scheme: null, value: darkScheme === 'off' ? 'off' : null })
  } else if (darkScheme !== null && darkScheme !== undefined) {
    dropped.push(`darkScheme: ${quoted(darkScheme)} is not auto or off`)
  }

  const fontFamily = input['fontFamily']
  if (typeof fontFamily === 'string' && themeEditorControl('fontFamily').options?.includes(fontFamily)) {
    changes.push({
      control: 'fontFamily',
      scheme: null,
      value: fontFamily === SYSTEM_FONT_VALUE ? null : fontFamily,
    })
  } else if (fontFamily !== null && fontFamily !== undefined) {
    dropped.push(`fontFamily: ${quoted(fontFamily)} is not in the font list`)
  }

  const numbers: Array<[string, AiThemeValueControl]> = [
    ['borderRadius', 'borderRadius'],
    ['spacing', 'spacing'],
    ['navHeightMobile', 'navHeight.xs'],
    ['navHeightDesktop', 'navHeight.sm'],
  ]
  for (const [property, control] of numbers) {
    const value = parseNumber(input[property], control, dropped, notes)
    if (value !== undefined) changes.push({ control, scheme: null, value })
  }

  const rawLeaves = Array.isArray(input['componentOverrides']) ? input['componentOverrides'] : []
  if (rawLeaves.length > AI_THEME_TOOL_MAX_COMPONENT_LEAVES) {
    dropped.push(
      `componentOverrides: ${rawLeaves.length - AI_THEME_TOOL_MAX_COMPONENT_LEAVES} past the ` +
        `${AI_THEME_TOOL_MAX_COMPONENT_LEAVES}-leaf limit`,
    )
  }
  const components = rawLeaves
    .slice(0, AI_THEME_TOOL_MAX_COMPONENT_LEAVES)
    .map((leaf, index) => parseComponentLeaf(leaf, index, dropped))
    .filter((leaf): leaf is ThemeComponentOverrideLeaf => leaf !== null)

  return {
    summary,
    changes,
    components,
    resetComponents: input['resetComponentOverrides'] === true,
    dropped,
    notes,
  }
}
