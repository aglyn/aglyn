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

import * as Aglyn from '@aglyn/aglyn'
import { parseBreakpointSpan } from '@aglyn/shared-data-enums'

/**
 * The Image element's `sizes` attribute (AGL-3485): how wide the browser
 * should assume the picture will be, which decides the `srcset` candidate it
 * downloads.
 *
 * Every image used to say `100vw`, so a 68px navbar logo and a 302px card
 * picture both fetched a 1280px or 1920px variant. The answer is now decided
 * in this order, first answer wins:
 *
 * 1. **The author's own Sizes attribute**, verbatim. An escape hatch for
 *    someone who knows the attribute; nobody needs to touch it.
 * 2. **Per breakpoint band, a pixel width the element itself states**: a
 *    pixel `width` (`'320px'`, or a plain number in `sx`, which MUI reads as
 *    pixels), or a pixel `height` under `width: auto` at the asset's known
 *    shape. Responsive values are read per band, so the header logo's
 *    `height: { xs: 44, md: 56 }` is a 54px slot on a phone and a 68px one
 *    from `md` up.
 * 3. **Per band, the width the Besigner MEASURED** when the page was saved.
 * 4. **Per band, the slot the layout around the image states**
 *    ({@link layoutBandWidths}): Grid spans, `repeat(n, 1fr)` grids, widths
 *    and max widths, and the Container that caps the page.
 * 5. For a band nothing describes, the next narrower band's answer, and
 *    `100vw` only for the narrowest band when nothing at all is known.
 *
 * Steps 2 and 4 are computed from the node tree the page renders, so they hold
 * for every page already published — on the server, with no re-save. The
 * measurement only refines what the layout cannot state.
 *
 * ## Why this does not bring back the AGL-2486 layout break
 *
 * `sizes` is not only a delivery hint: with `w` descriptors it is the image's
 * intrinsic width, which is what `width: 100%` resolves against inside a
 * shrink-to-fit parent. `sizes="auto"` broke fluid images because it is
 * circular there (300px default object size). Every answer above is a real
 * width of the slot the image fills: a definite length, a share of a parent of
 * definite width, or a measurement of the very layout being described —
 * which is a fixed point, since an image whose intrinsic width is its
 * measured width lays out at its measured width.
 */
export interface ImageSizesInput {
  /** The author's Sizes attribute. */
  sizes?: unknown
  /** The element's `width` attribute, as the author set it. */
  width?: unknown
  /** The element's `height` attribute, as the author set it. */
  height?: unknown
  /**
   * The node's own styles. Their `width` and `height` win over the
   * attributes, as they do in the render (`sx` is composed after the
   * defaults the attributes set).
   */
  sx?: unknown
  intrinsicWidth?: unknown
  intrinsicHeight?: unknown
  /** What the Besigner measured, as the save stored it. */
  renderedWidths?: unknown
  /** What the layout around the image states, per band. */
  layoutWidths?: LayoutWidths
}

export interface ImageSizes {
  sizes: string
  /**
   * The evidence says the image renders small everywhere it is known: a
   * pixel width of {@link SMALL_IMAGE_MAX_PX} or less, or under
   * {@link SMALL_IMAGE_MAX_PERCENT} of the page, in every band that was
   * stated, measured or derived. A lead image that is small is a logo or an
   * icon, not the page's largest paint, and gets no `fetchpriority="high"`.
   */
  small: boolean
}

/** At or under this many pixels wide an image is not a hero. */
export const SMALL_IMAGE_MAX_PX = 240

/** Under this share of the page in every known band, an image is not a hero. */
export const SMALL_IMAGE_MAX_PERCENT = 40

type Band = Aglyn.RenderedWidthBand
type BandValues<T> = Partial<Record<Band, T>>

const BANDS = Aglyn.RENDERED_WIDTH_BANDS

/**
 * One slot the layout states for a band: a share of the viewport less the
 * gutters and gaps taken out of it, and the pixel width it can never exceed
 * when something above it caps the page — `min(vw% - offset, cap)`.
 */
export interface LayoutSlot {
  vw: number
  offsetPx?: number
  capPx?: number
}

export type LayoutWidths = BandValues<LayoutSlot>

/**
 * A responsive value's reading at every band, cascading upwards the way MUI
 * applies one: a band with no value of its own takes the nearest narrower
 * band's. A scalar applies everywhere, an array is MUI's breakpoint array,
 * and keys that are not bands — a dark-scheme slice, a raw media query — are
 * not read.
 */
function bandValues(value: unknown): BandValues<unknown> {
  if (value === undefined || value === null || value === '') return {}
  let stated: BandValues<unknown>
  if (Array.isArray(value)) {
    stated = {}
    value.forEach((entry, index) => {
      if (index < BANDS.length && entry !== null && entry !== undefined) {
        stated[BANDS[index]] = entry
      }
    })
  } else if (typeof value === 'object') {
    stated = {}
    for (const band of BANDS) {
      const entry = (value as Record<string, unknown>)[band]
      if (entry !== undefined && entry !== null) stated[band] = entry
    }
  } else {
    return Object.fromEntries(BANDS.map((band) => [band, value]))
  }
  const out: BandValues<unknown> = {}
  let current: unknown
  for (const band of BANDS) {
    if (stated[band] !== undefined) current = stated[band]
    if (current !== undefined) out[band] = current
  }
  return out
}

/**
 * A CSS sizing value as MUI's `sx` reads it: a number in (0, 1] is a share of
 * the parent, any other number is pixels, and a string may be either unit.
 */
type Length =
  | { kind: 'px'; value: number }
  | { kind: 'fraction'; value: number }
  | { kind: 'vw'; value: number }
  | { kind: 'auto' }

function length(value: unknown): Length | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value <= 1) return { kind: 'fraction', value }
    return value > 1 ? { kind: 'px', value } : undefined
  }
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === 'auto') return { kind: 'auto' }
  const match = /^(\d+(?:\.\d+)?)(px|%|vw)$/.exec(text)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!(amount > 0)) return undefined
  if (match[2] === 'px') return { kind: 'px', value: amount }
  if (match[2] === 'vw') return { kind: 'vw', value: amount }
  return { kind: 'fraction', value: amount / 100 }
}

/** A node's `sx` as one plain object: an array of objects merged in order. */
function plainSx(sx: unknown): Record<string, unknown> {
  if (Array.isArray(sx)) {
    return Object.assign(
      {},
      ...sx.filter(
        (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
      ),
    )
  }
  return sx && typeof sx === 'object' ? (sx as Record<string, unknown>) : {}
}

const usable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The length the element itself states per band, as a `sizes` length: a
 * pixel or viewport width, or a pixel height under `width: auto` at the
 * asset's shape. Per band, so a responsive value is read the way MUI applies
 * it; a band where the element states nothing usable is left to the layout.
 */
function ownLengths(input: ImageSizesInput): BandValues<string> {
  const sx = plainSx(input.sx)
  const widths = bandValues(input.width)
  const heights = bandValues(input.height)
  const sxWidths = bandValues(sx['width'])
  const sxHeights = bandValues(sx['height'])
  const ratio =
    usable(input.intrinsicWidth) && usable(input.intrinsicHeight)
      ? input.intrinsicWidth / input.intrinsicHeight
      : undefined
  const out: BandValues<string> = {}
  for (const band of BANDS) {
    const width = length(sxWidths[band] ?? widths[band])
    if (width?.kind === 'px') {
      out[band] = `${Math.round(width.value)}px`
      continue
    }
    if (width?.kind === 'vw') {
      out[band] = `${Math.round(width.value * 10) / 10}vw`
      continue
    }
    const height = length(sxHeights[band] ?? heights[band])
    if (width?.kind === 'auto' && height?.kind === 'px' && ratio) {
      out[band] = `${Math.round(height.value * ratio)}px`
    }
  }
  return out
}

/** A layout slot as a `sizes` length for a band. */
function slotLength(band: Band, slot: LayoutSlot): string {
  // A cap that binds across the whole band — the page is at least the band's
  // minimum wide, so the slot is the cap from its first pixel — is the
  // definite length. Below that, the share of the viewport is the answer, and
  // it can only overstate the slot by the gutters.
  const offset = slot.offsetPx ?? 0
  // A pixel of slack absorbs the rounding of the share and the cap.
  if (
    slot.capPx !== undefined &&
    slot.capPx <=
      (slot.vw / 100) * Aglyn.RENDERED_WIDTH_BAND_MIN[band] - offset + 1
  ) {
    return `${slot.capPx}px`
  }
  return offset >= 1 ? `calc(${slot.vw}vw - ${offset}px)` : `${slot.vw}vw`
}

/**
 * What was measured, with the layout's statement filling the bands the
 * Besigner never saw.
 *
 * A measured band wins. Above it, the layout's value is used only where it
 * says something NEW — a value that differs from the one the layout gave the
 * measured band. A value it merely carried up from the measured band's span
 * is the same slot measured more precisely, so the measurement carries
 * instead: a cell measured at 28% on a large screen is not 33% on a wider
 * one just because its span did not change.
 */
function combineBandLengths(
  measured: Aglyn.RenderedWidths,
  layout: BandValues<string>,
): BandValues<string> {
  const known: BandValues<string> = {}
  let lastMeasured: string | undefined
  let layoutWhenMeasured: string | undefined
  for (const band of BANDS) {
    const value = measured[band]
    if (value !== undefined) {
      known[band] = `${value}vw`
      lastMeasured = known[band]
      layoutWhenMeasured = layout[band]
      continue
    }
    const stated = layout[band]
    if (stated !== undefined && stated !== layoutWhenMeasured) {
      known[band] = stated
    } else if (lastMeasured !== undefined) {
      known[band] = lastMeasured
    }
  }
  return known
}

/** Whether a known length is a small slot. */
function isSmall(css: string): boolean {
  if (css.endsWith('px') && !css.startsWith('calc(')) {
    return Number.parseFloat(css) <= SMALL_IMAGE_MAX_PX
  }
  const vw = /(\d+(?:\.\d+)?)vw/.exec(css)
  return vw ? Number(vw[1]) < SMALL_IMAGE_MAX_PERCENT : false
}

/** The `sizes` an Image element should carry. See the module note. */
export function imageSizes(input: ImageSizesInput): ImageSizes {
  const authored = typeof input.sizes === 'string' ? input.sizes.trim() : ''
  if (authored) return { sizes: authored, small: false }
  const layout: BandValues<string> = {}
  for (const band of BANDS) {
    const slot = input.layoutWidths?.[band]
    if (slot) layout[band] = slotLength(band, slot)
  }
  const known = {
    ...combineBandLengths(
      Aglyn.parseRenderedWidths(input.renderedWidths),
      layout,
    ),
    ...ownLengths(input),
  }
  const values = Object.values(known) as string[]
  return {
    sizes: Aglyn.sizesFromBandLengths(known),
    small: values.length > 0 && values.every(isSmall),
  }
}

/** No published page nests deeper; a walk past this is following a cycle. */
const MAX_LAYOUT_DEPTH = 256

/** The Grid element's persisted component id (`grid.tsx`). */
const GRID_COMPONENT_ID = 'muiGrid'

/** The Container element's persisted component id (`container.ts`). */
const CONTAINER_COMPONENT_ID = 'muiContainer'

/**
 * A Container's `maxWidth` keys in pixels: MUI's, `xs` floored at 444px. An
 * absent or cleared value is MUI's own `lg` (the element drops a cleared one
 * so MUI's default applies, AGL-1435); `false` caps nothing.
 */
const CONTAINER_MAX_WIDTHS: Readonly<Record<string, number>> = {
  xs: 444,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
}

/**
 * A Container's side gutters: MUI's `theme.spacing(2)` a side on a phone and
 * `theme.spacing(3)` from `sm` up.
 */
const CONTAINER_GUTTER_PX: Readonly<Record<Band, number>> = {
  xs: 16,
  sm: 24,
  md: 24,
  lg: 24,
  xl: 24,
}

/** One theme spacing unit; MUI's default, which `sx` gaps are counted in. */
const SPACING_PX = 8

/** A gap in pixels: a number is theme spacing units, a string must be px. */
function gapPixels(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value * SPACING_PX
  }
  const text = String(value ?? '').trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * SPACING_PX
  const match = /^(\d+(?:\.\d+)?)px$/.exec(text)
  return match ? Number(match[1]) : 0
}

/** A node as the canvas holds it, as far as this walk reads it. */
export interface LayoutNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
  sx?: unknown
  parent?: LayoutNode | undefined
}

const propsOf = (node: LayoutNode | undefined) =>
  node?.resolvedProps ?? node?.props ?? {}

/** A Grid cell's span at each band: a column count, or `null` for auto/grow. */
function gridSpanPerBand(size: unknown): BandValues<number | null> {
  if (size === undefined || size === null || size === '') return {}
  const span = parseBreakpointSpan(size as string | number)
  if (span.raw !== undefined) return {}
  const read = (value: unknown) => (typeof value === 'number' ? value : null)
  if (span.base !== undefined) {
    const value = read(span.base)
    return Object.fromEntries(BANDS.map((band) => [band, value]))
  }
  const values: Record<string, unknown> = {}
  for (const [band, value] of Object.entries(span.values ?? {})) {
    values[band] = read(value)
  }
  return bandValues(values) as BandValues<number | null>
}

const FR_TRACK = /^(?:1fr|minmax\(\s*0(?:px)?\s*,\s*1fr\s*\))$/
const REPEAT_TRACKS =
  /^repeat\(\s*(\d+)\s*,\s*(1fr|minmax\(\s*0(?:px)?\s*,\s*1fr\s*\))\s*\)$/

/**
 * The equal tracks a `gridTemplateColumns` value lays out: `repeat(3, 1fr)`,
 * or the same written out, `1fr 1fr 1fr` — and a single `1fr`, which is one
 * column the full width. Anything else (fixed tracks, `auto-fill`) is not an
 * equal split this can state.
 */
function equalTracks(value: unknown): number | undefined {
  const text = String(value ?? '').trim()
  const repeat = REPEAT_TRACKS.exec(text)
  if (repeat) return Number(repeat[1]) > 0 ? Number(repeat[1]) : undefined
  const tracks = text.split(/\s+(?![^(]*\))/).filter(Boolean)
  return tracks.length && tracks.every((track) => FR_TRACK.test(track))
    ? tracks.length
    : undefined
}

/** How many tracks a grid child spans, from its own `gridColumn`. */
function spannedTracks(value: unknown, tracks: number): number {
  const text = String(value ?? '').trim()
  const span = /^span\s+(\d+)$/.exec(text)
  if (span) return Math.min(Number(span[1]), tracks)
  if (/^1\s*\/\s*-1$/.test(text)) return tracks
  return 1
}

/**
 * The slot the layout around an image gives it, per band, from what the
 * layout STATES rather than what anyone measured — computed from the node
 * tree a page renders, so a published page has it on the server with nothing
 * re-saved. Walking up from the image:
 *
 * - every **Grid cell** it sits in takes its responsive span of its row's
 *   columns (`xs:12 md:4` is a third from `md` up), less its share of the
 *   row's spacing;
 * - every **CSS grid** of equal tracks (`repeat(3, 1fr)`, per breakpoint)
 *   gives each child one track, or the tracks its `gridColumn` spans, less
 *   its share of the gap;
 * - every **width or max width** given as a share of the parent shrinks the
 *   slot by it, and one given in pixels caps it;
 * - every **Container** takes its gutters off and caps it at its max width.
 *
 * Each step maps the parent's width to the child's as `share × parent −
 * offset`, so they compose: a third of a half is a sixth, and a gap inside a
 * capped Container is still a gap. The answer per band is `min(vw% − offset,
 * cap)`. A band is answered only when something stated it and nothing between
 * the image and the page made it unknowable — an `auto` or `grow` Grid cell is
 * sized by its content, so a band where any cell is one has no answer here.
 * Theme spacing is taken at MUI's 8px, and anything this does not model
 * (padding on an ordinary Box, a flex row) is left in, so a guess errs wide:
 * a slightly larger candidate, never a blurry one.
 *
 * The same function serves the Besigner canvas and the published render; the
 * tree differs only in that the canvas has not grafted reusable components or
 * expanded repeats, which the measurement covers there.
 */
export function layoutBandWidths(
  node: LayoutNode | undefined,
): LayoutWidths {
  /** Per band, the image's width as `share × W − offset` of the ancestor W. */
  const share: BandValues<number | null> = {}
  const offset: BandValues<number> = {}
  const cap: BandValues<number> = {}
  let stated = false
  const known = (band: Band) => share[band] !== null
  /** The child takes `factor × parent − minus`. */
  const step = (band: Band, factor: number | null, minus = 0) => {
    if (!known(band)) return
    if (factor === null) {
      share[band] = null
      return
    }
    const k = share[band] ?? 1
    offset[band] = (offset[band] ?? 0) + k * minus
    share[band] = k * factor
  }
  /** The child is never wider than `pixels`. */
  const capAt = (band: Band, pixels: number) => {
    if (!known(band)) return
    const scaled = (share[band] ?? 1) * pixels - (offset[band] ?? 0)
    cap[band] = Math.min(cap[band] ?? Infinity, scaled)
  }
  /** Width and max width as a share or a cap, from a node's own styles. */
  const applySizing = (target: LayoutNode, includeWidth: boolean) => {
    const sx = plainSx(target.sx)
    for (const key of includeWidth ? ['width', 'maxWidth'] : ['maxWidth']) {
      const values = bandValues(sx[key])
      for (const band of BANDS) {
        const value = length(values[band])
        if (value?.kind === 'fraction') {
          step(band, Math.min(value.value, 1))
          stated = true
        } else if (value?.kind === 'px') {
          capAt(band, value.value)
          stated = true
        }
      }
    }
  }
  // The image's own max width caps it; its own width is read as its own
  // stated length, not as layout.
  if (node) applySizing(node, false)
  let child = node
  // Stored pages name the root as its own parent (`parentId: "_@_"`), so a
  // walk that only stops at a missing parent never ends (AGL-3565). Stop at
  // any node already visited, and never climb further than a page can nest.
  const visited = new Set<LayoutNode>(node ? [node] : [])
  let depth = 0
  for (
    let current = node?.parent;
    current && !visited.has(current) && depth < MAX_LAYOUT_DEPTH;
    current = current.parent, depth += 1
  ) {
    visited.add(current)
    const props = propsOf(current)
    if (current.componentId === GRID_COMPONENT_ID) {
      const spans = gridSpanPerBand(props['size'])
      if (Object.keys(spans).length) {
        const row = current.parent
        const rowProps = row?.componentId === GRID_COMPONENT_ID ? propsOf(row) : {}
        const columns = Number(rowProps['columns'])
        const total = columns > 0 ? columns : 12
        const spacing = bandValues(
          rowProps['columnSpacing'] ?? rowProps['spacing'],
        )
        stated = true
        for (const band of BANDS) {
          const span = spans[band]
          if (span === undefined || span === null) {
            step(band, null)
            continue
          }
          const portion = Math.min(span / total, 1)
          step(band, portion, gapPixels(spacing[band]) * (1 - portion))
        }
      }
    }
    const sx = plainSx(current.sx)
    const templates = bandValues(sx['gridTemplateColumns'])
    const gaps = bandValues(sx['columnGap'] ?? sx['gap'])
    for (const band of BANDS) {
      const tracks = equalTracks(templates[band])
      if (tracks === undefined) continue
      const spanned = spannedTracks(
        bandValues(plainSx(child?.sx)['gridColumn'])[band],
        tracks,
      )
      const portion = spanned / tracks
      step(band, portion, gapPixels(gaps[band]) * (1 - portion))
      stated = true
    }
    applySizing(current, true)
    if (current.componentId === CONTAINER_COMPONENT_ID) {
      const maxWidth = props['maxWidth']
      const key =
        maxWidth === undefined || maxWidth === null || maxWidth === ''
          ? 'lg'
          : maxWidth
      const pixels =
        typeof key === 'string' ? CONTAINER_MAX_WIDTHS[key] : undefined
      for (const band of BANDS) {
        const gutters = props['disableGutters']
          ? 0
          : 2 * CONTAINER_GUTTER_PX[band]
        // The gutters come off whatever the page is; the cap is the max width
        // less the same gutters, since MUI pads inside the max width.
        if (pixels) capAt(band, pixels - gutters)
        step(band, 1, gutters)
      }
      stated = true
    }
    child = current
  }
  if (!stated) return {}
  const widths: LayoutWidths = {}
  for (const band of BANDS) {
    const fraction = share[band] === undefined ? 1 : share[band]
    if (typeof fraction !== 'number' || !(fraction > 0)) continue
    const minus = Math.round(offset[band] ?? 0)
    const capPx = cap[band]
    widths[band] = {
      vw: Math.round(fraction * 1000) / 10,
      ...(minus >= 1 ? { offsetPx: minus } : {}),
      ...(capPx !== undefined && Number.isFinite(capPx)
        ? { capPx: Math.round(capPx) }
        : {}),
    }
  }
  return widths
}
