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

/**
 * How a lightbox looks and closes (AGL-3717), as plain data.
 *
 * ## Why this is its own module
 *
 * `lightbox-dialog.tsx` names `@mui/material/Dialog`, and the Dialog stack is
 * kept off every first paint (AGL-1290): an element reaches the dialog through
 * `lazy(() => import())` only once a visitor asks for it. What an element has
 * to know BEFORE that — which props are the lightbox's, so it does not spread
 * them onto its own DOM, and what each one is called in a props panel — lives
 * here, with no React and no MUI, so reading it costs a page nothing.
 *
 * The field list is generic on purpose: it says what each setting is and what
 * kind of control edits it, never how a particular editor draws that control.
 * Every element that opens a lightbox maps it onto its own schema, so the
 * Image, the Image List, the Video and the Lightbox container all offer the
 * same settings under the same names, and a reusable component's property can
 * be bound to any of them the same way.
 */

/** What draws the close control. */
export const LIGHTBOX_CLOSE_STYLES = ['icon', 'filled', 'text'] as const
export type LightboxCloseStyle = (typeof LIGHTBOX_CLOSE_STYLES)[number]

/** Where the close control sits: in the frame's top corner, or the screen's. */
export const LIGHTBOX_CLOSE_POSITIONS = [
  'inside-end',
  'inside-start',
  'outside-end',
] as const
export type LightboxClosePosition = (typeof LIGHTBOX_CLOSE_POSITIONS)[number]

/** Where a picture's caption goes: under it, over its foot, or nowhere. */
export const LIGHTBOX_CAPTION_PLACEMENTS = ['below', 'overlay', 'hidden'] as const
export type LightboxCaptionPlacement =
  (typeof LIGHTBOX_CAPTION_PLACEMENTS)[number]

/** How the lightbox arrives. A visitor who asks for reduced motion gets `none`. */
export const LIGHTBOX_TRANSITIONS = ['fade', 'zoom', 'none'] as const
export type LightboxTransition = (typeof LIGHTBOX_TRANSITIONS)[number]

/**
 * The resolved settings. Every look field is optional and absent means "the
 * element's own default", which is what keeps an element that existed before
 * these settings — the Video — rendering exactly as it did. The two closing
 * rules are always resolved, because a dialog has to decide them.
 */
export interface LightboxAppearance {
  backdropColor?: string
  /** 0–100. */
  backdropOpacity?: number
  /** Pixels of blur behind the backdrop. */
  backdropBlur?: number
  /** Any CSS length. */
  maxWidth?: string
  maxHeight?: string
  padding?: string
  /** Corner radius of the frame, in pixels. */
  radius?: number
  closeStyle?: LightboxCloseStyle
  closePosition?: LightboxClosePosition
  captionPlacement?: LightboxCaptionPlacement
  transition?: LightboxTransition
  closeOnBackdrop: boolean
  closeOnEscape: boolean
}

/**
 * The prop each setting is stored under on an element. Persisted in screen
 * documents; never rename a value.
 */
export const LIGHTBOX_APPEARANCE_PROPS = {
  backdropColor: 'lightboxBackdropColor',
  backdropOpacity: 'lightboxBackdropOpacity',
  backdropBlur: 'lightboxBackdropBlur',
  maxWidth: 'lightboxMaxWidth',
  maxHeight: 'lightboxMaxHeight',
  padding: 'lightboxPadding',
  radius: 'lightboxRadius',
  closeStyle: 'lightboxCloseStyle',
  closePosition: 'lightboxClosePosition',
  captionPlacement: 'lightboxCaptionPlacement',
  transition: 'lightboxTransition',
  closeOnBackdrop: 'lightboxCloseOnBackdrop',
  closeOnEscape: 'lightboxCloseOnEscape',
} as const satisfies Record<keyof LightboxAppearance, string>

export type LightboxAppearancePropName =
  (typeof LIGHTBOX_APPEARANCE_PROPS)[keyof typeof LIGHTBOX_APPEARANCE_PROPS]

/** Every appearance prop name, for an element to keep off its own DOM. */
export const LIGHTBOX_APPEARANCE_PROP_NAMES: readonly LightboxAppearancePropName[] =
  Object.values(LIGHTBOX_APPEARANCE_PROPS)

/** The props an element carries for its lightbox's look, as stored. */
export type LightboxAppearanceProps = Partial<
  Record<LightboxAppearancePropName, string | number | boolean | null>
>

/** The kind of control a setting is edited with. */
export type LightboxFieldKind =
  | 'color'
  | 'number'
  | 'dimension'
  | 'select'
  | 'switch'

export interface LightboxFieldDescriptor {
  name: LightboxAppearancePropName
  label: string
  description: string
  kind: LightboxFieldKind
  options?: ReadonlyArray<{ value: string; label: string }>
}

/**
 * The settings, in the order a props panel lists them. Each select's first
 * option is the default and a real value, so an author can always move back
 * to it (a `''` option could not persist, AGL-1191).
 */
export const LIGHTBOX_APPEARANCE_FIELDS: readonly LightboxFieldDescriptor[] = [
  {
    name: 'lightboxBackdropColor',
    label: 'Lightbox backdrop color',
    description: 'The color behind the lightbox. Leave empty for a dark backdrop.',
    kind: 'color',
  },
  {
    name: 'lightboxBackdropOpacity',
    label: 'Lightbox backdrop opacity',
    description: 'How solid the backdrop is, from 0 (clear) to 100 (solid).',
    kind: 'number',
  },
  {
    name: 'lightboxBackdropBlur',
    label: 'Lightbox backdrop blur',
    description: 'Blurs the page behind the lightbox, in pixels. 0 for none.',
    kind: 'number',
  },
  {
    name: 'lightboxMaxWidth',
    label: 'Lightbox max width',
    description: 'The widest the lightbox frame grows, e.g. 1200px or 90vw.',
    kind: 'dimension',
  },
  {
    name: 'lightboxMaxHeight',
    label: 'Lightbox max height',
    description: 'The tallest the lightbox frame grows, e.g. 90vh.',
    kind: 'dimension',
  },
  {
    name: 'lightboxPadding',
    label: 'Lightbox padding',
    description: 'Space between the frame edge and what it shows.',
    kind: 'dimension',
  },
  {
    name: 'lightboxRadius',
    label: 'Lightbox corner radius',
    description: 'Rounds the frame corners, in pixels.',
    kind: 'number',
  },
  {
    name: 'lightboxCloseStyle',
    label: 'Lightbox close button',
    description: 'How the close button looks.',
    kind: 'select',
    options: [
      { value: 'icon', label: 'Icon (default)' },
      { value: 'filled', label: 'Icon on a circle' },
      { value: 'text', label: 'The word Close' },
    ],
  },
  {
    name: 'lightboxClosePosition',
    label: 'Lightbox close position',
    description: 'Where the close button sits.',
    kind: 'select',
    options: [
      { value: 'inside-end', label: 'Frame, top right (default)' },
      { value: 'inside-start', label: 'Frame, top left' },
      { value: 'outside-end', label: 'Screen, top right' },
    ],
  },
  {
    name: 'lightboxCaptionPlacement',
    label: 'Lightbox caption',
    description: 'Where a picture caption shows in the lightbox.',
    kind: 'select',
    options: [
      { value: 'below', label: 'Below the picture (default)' },
      { value: 'overlay', label: 'Over the picture' },
      { value: 'hidden', label: 'Hidden' },
    ],
  },
  {
    name: 'lightboxTransition',
    label: 'Lightbox transition',
    description:
      'How the lightbox opens. Visitors who ask for reduced motion always get none.',
    kind: 'select',
    options: [
      { value: 'fade', label: 'Fade (default)' },
      { value: 'zoom', label: 'Zoom' },
      { value: 'none', label: 'None' },
    ],
  },
  {
    name: 'lightboxCloseOnBackdrop',
    label: 'Close on backdrop click',
    description: 'Closes the lightbox when a visitor clicks outside it. On by default.',
    kind: 'switch',
  },
  {
    name: 'lightboxCloseOnEscape',
    label: 'Close on Escape',
    description: 'Closes the lightbox when a visitor presses Escape. On by default.',
    kind: 'switch',
  },
]

const text = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const number = (
  value: unknown,
  min: number,
  max: number,
): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(Math.max(parsed, min), max)
}

const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

/**
 * A yes/no that defaults to yes: only an explicit no turns it off. The
 * strings are what a document, a reusable component's text substitution or
 * an older editor may hold.
 */
const onUnlessNo = (value: unknown): boolean =>
  !(value === false || value === 'false' || value === 'no' || value === 0)

/** A unitless length is pixels, as everywhere else on an element. */
const length = (value: unknown): string | undefined => {
  const raw = text(value)
  if (raw === undefined) return undefined
  return /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw
}

/**
 * Reads the settings off an element's props. Anything unreadable is treated
 * as unset rather than thrown on, because a stored document can hold any
 * value and a lightbox that refuses to open over a bad radius is worse than
 * one with square corners.
 */
export function readLightboxAppearance(
  props: Readonly<Record<string, unknown>> | null | undefined,
): LightboxAppearance {
  const bag = props ?? {}
  const P = LIGHTBOX_APPEARANCE_PROPS
  const appearance: LightboxAppearance = {
    closeOnBackdrop: onUnlessNo(bag[P.closeOnBackdrop]),
    closeOnEscape: onUnlessNo(bag[P.closeOnEscape]),
  }
  const backdropColor = text(bag[P.backdropColor])
  if (backdropColor) appearance.backdropColor = backdropColor
  const backdropOpacity = number(bag[P.backdropOpacity], 0, 100)
  if (backdropOpacity !== undefined) appearance.backdropOpacity = backdropOpacity
  const backdropBlur = number(bag[P.backdropBlur], 0, 64)
  if (backdropBlur !== undefined) appearance.backdropBlur = backdropBlur
  const maxWidth = length(bag[P.maxWidth])
  if (maxWidth) appearance.maxWidth = maxWidth
  const maxHeight = length(bag[P.maxHeight])
  if (maxHeight) appearance.maxHeight = maxHeight
  const padding = length(bag[P.padding])
  if (padding) appearance.padding = padding
  const radius = number(bag[P.radius], 0, 999)
  if (radius !== undefined) appearance.radius = radius
  const closeStyle = oneOf(bag[P.closeStyle], LIGHTBOX_CLOSE_STYLES)
  if (closeStyle) appearance.closeStyle = closeStyle
  const closePosition = oneOf(bag[P.closePosition], LIGHTBOX_CLOSE_POSITIONS)
  if (closePosition) appearance.closePosition = closePosition
  const captionPlacement = oneOf(
    bag[P.captionPlacement],
    LIGHTBOX_CAPTION_PLACEMENTS,
  )
  if (captionPlacement) appearance.captionPlacement = captionPlacement
  const transition = oneOf(bag[P.transition], LIGHTBOX_TRANSITIONS)
  if (transition) appearance.transition = transition
  return appearance
}

/**
 * Splits an element's props into its lightbox settings and everything else,
 * so the rest can be spread onto the element's DOM without a dozen unknown
 * attributes riding along.
 */
export function splitLightboxAppearanceProps<T extends object>(
  props: T,
): { appearance: LightboxAppearance; rest: Omit<T, LightboxAppearancePropName> } {
  const rest: Record<string, unknown> = {}
  const names = new Set<string>(LIGHTBOX_APPEARANCE_PROP_NAMES)
  for (const [key, value] of Object.entries(props)) {
    if (!names.has(key)) rest[key] = value
  }
  return {
    appearance: readLightboxAppearance(props as Record<string, unknown>),
    rest: rest as Omit<T, LightboxAppearancePropName>,
  }
}

/**
 * The backdrop's paint: the color at the opacity asked for. A hex color is
 * written as `rgba()`; any other color — a name, an `rgb()`, a theme variable
 * — is mixed with transparency, which every browser that renders the dialog
 * supports. `undefined` when neither is set, so the theme's backdrop stays.
 */
export function lightboxBackdropBackground(
  appearance: Pick<LightboxAppearance, 'backdropColor' | 'backdropOpacity'>,
): string | undefined {
  const { backdropColor, backdropOpacity } = appearance
  if (!backdropColor && backdropOpacity === undefined) return undefined
  const color = backdropColor ?? '#000000'
  const opacity = backdropOpacity ?? 80
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : hex[1]
    const red = parseInt(digits.slice(0, 2), 16)
    const green = parseInt(digits.slice(2, 4), 16)
    const blue = parseInt(digits.slice(4, 6), 16)
    return `rgba(${red}, ${green}, ${blue}, ${opacity / 100})`
  }
  return `color-mix(in srgb, ${color} ${opacity}%, transparent)`
}
