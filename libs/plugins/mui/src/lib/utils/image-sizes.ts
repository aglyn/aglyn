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
 * Every image used to say `100vw`, so a 68px navbar logo and a 361px card
 * picture both fetched the 1920px variant. The answer is now decided in this
 * order, first answer wins:
 *
 * 1. **The author's own Sizes attribute**, verbatim. An escape hatch for
 *    someone who knows the attribute; nobody needs to touch it.
 * 2. **A pixel width the element was given**, which is the size exactly.
 * 3. **A pixel height with an `auto` width and a known shape**, which is a
 *    pixel width once the asset's own pair supplies the ratio.
 * 4. **Per breakpoint band**: the width the Besigner MEASURED the image at
 *    when the page was saved, else the width the layout states — a Grid cell's
 *    responsive span, a `repeat(n, 1fr)` grid track — else, for a band
 *    nothing describes, the next narrower band's answer, and `100vw` only
 *    for the narrowest band when nothing at all is known.
 *
 * ## Why this does not bring back the AGL-2486 layout break
 *
 * `sizes` is not only a delivery hint: with `w` descriptors it is the image's
 * intrinsic width, which is what `width: 100%` resolves against inside a
 * shrink-to-fit parent. `sizes="auto"` broke fluid images because it is
 * circular there (300px default object size). Every answer above is a real
 * width of the slot the image fills: a definite length, a span of a parent
 * of definite width, or a measurement of the very layout being described —
 * which is a fixed point, since an image whose intrinsic width is its
 * measured width lays out at its measured width.
 */
export interface ImageSizesInput {
  /** The author's Sizes attribute. */
  sizes?: unknown
  /** The element's CSS width, as the author set it. */
  width?: unknown
  /** The element's CSS height, as the author set it. */
  height?: unknown
  intrinsicWidth?: unknown
  intrinsicHeight?: unknown
  /** What the Besigner measured, as the save stored it. */
  renderedWidths?: unknown
  /** What the layout around the image states, per band. */
  layoutWidths?: Aglyn.RenderedWidths
}

export interface ImageSizes {
  sizes: string
  /**
   * The evidence says the image renders small everywhere it is known: a
   * pixel width of {@link SMALL_IMAGE_MAX_PX} or less, or under
   * {@link SMALL_IMAGE_MAX_PERCENT} of the page in every band that was
   * measured or stated. A lead image that is small is a logo or an icon, not
   * the page's largest paint, and gets no `fetchpriority="high"`.
   */
  small: boolean
}

/** At or under this many pixels wide an image is not a hero. */
export const SMALL_IMAGE_MAX_PX = 240

/** Under this share of the page in every known band, an image is not a hero. */
export const SMALL_IMAGE_MAX_PERCENT = 40

const PIXELS = /^(\d+(?:\.\d+)?)px$/

const usable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

function pixels(value: unknown): number | undefined {
  const match = PIXELS.exec(String(value ?? '').trim())
  return match ? Number(match[1]) : undefined
}

/** The `sizes` an Image element should carry. See the module note. */
export function imageSizes(input: ImageSizesInput): ImageSizes {
  const authored = typeof input.sizes === 'string' ? input.sizes.trim() : ''
  if (authored) return { sizes: authored, small: false }
  const pinned = pixels(input.width)
  if (pinned !== undefined) {
    return { sizes: `${pinned}px`, small: pinned <= SMALL_IMAGE_MAX_PX }
  }
  const height = pixels(input.height)
  if (
    height !== undefined &&
    String(input.width ?? '').trim() === 'auto' &&
    usable(input.intrinsicWidth) &&
    usable(input.intrinsicHeight)
  ) {
    const derived = Math.round(
      (height * input.intrinsicWidth) / input.intrinsicHeight,
    )
    return { sizes: `${derived}px`, small: derived <= SMALL_IMAGE_MAX_PX }
  }
  const known = combineBandWidths(
    Aglyn.parseRenderedWidths(input.renderedWidths),
    input.layoutWidths ?? {},
  )
  const values = Object.values(known)
  return {
    sizes: Aglyn.sizesFromBandWidths(known),
    small:
      values.length > 0 &&
      values.every((value) => (value ?? 100) < SMALL_IMAGE_MAX_PERCENT),
  }
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
function combineBandWidths(
  measured: Aglyn.RenderedWidths,
  layout: Aglyn.RenderedWidths,
): Aglyn.RenderedWidths {
  const known: Aglyn.RenderedWidths = {}
  let lastMeasured: number | undefined
  let layoutWhenMeasured: number | undefined
  for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
    const value = measured[band]
    if (value !== undefined) {
      known[band] = value
      lastMeasured = value
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

/** The Grid element's persisted component id (`grid.tsx`). */
const GRID_COMPONENT_ID = 'muiGrid'

/** A node as the canvas holds it, as far as this walk reads it. */
export interface LayoutNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
  sx?: unknown
  parent?: LayoutNode | undefined
}

type BandValues<T> = Partial<Record<Aglyn.RenderedWidthBand, T>>

/**
 * A responsive value's reading at every band, cascading upwards the way MUI
 * applies one: a band with no value of its own takes the nearest narrower
 * band's. A band below the first stated value has none.
 */
function cascade<T>(values: BandValues<T>): BandValues<T> {
  const out: BandValues<T> = {}
  let current: T | undefined
  for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
    if (values[band] !== undefined) current = values[band]
    if (current !== undefined) out[band] = current
  }
  return out
}

/** A Grid cell's span at each band: a column count, or `null` for auto/grow. */
function gridSpanPerBand(size: unknown): BandValues<number | null> {
  if (size === undefined || size === null || size === '') return {}
  const span = parseBreakpointSpan(size as string | number)
  if (span.raw !== undefined) return {}
  const read = (value: unknown) => (typeof value === 'number' ? value : null)
  if (span.base !== undefined) {
    const value = read(span.base)
    return Object.fromEntries(
      Aglyn.RENDERED_WIDTH_BANDS.map((band) => [band, value]),
    )
  }
  const values: BandValues<number | null> = {}
  for (const [band, value] of Object.entries(span.values ?? {})) {
    values[band as Aglyn.RenderedWidthBand] = read(value)
  }
  return cascade(values)
}

const REPEAT_TRACKS =
  /^repeat\(\s*(\d+)\s*,\s*(?:1fr|minmax\(\s*0(?:px)?\s*,\s*1fr\s*\))\s*\)$/

/** A `gridTemplateColumns` of `repeat(n, 1fr)`, per band, as n. */
function repeatTracksPerBand(value: unknown): BandValues<number> {
  const tracks = (raw: unknown): number | undefined => {
    const match = REPEAT_TRACKS.exec(String(raw ?? '').trim())
    const count = match ? Number(match[1]) : NaN
    return count > 0 ? count : undefined
  }
  if (typeof value === 'string') {
    const count = tracks(value)
    if (count === undefined) return {}
    return Object.fromEntries(
      Aglyn.RENDERED_WIDTH_BANDS.map((band) => [band, count]),
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const values: BandValues<number> = {}
  for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
    const count = tracks((value as Record<string, unknown>)[band])
    if (count !== undefined) values[band] = count
  }
  return cascade(values)
}

const propsOf = (node: LayoutNode | undefined) =>
  node?.resolvedProps ?? node?.props ?? {}

/**
 * The share of the page the layout around an image gives it, per band, from
 * what the layout STATES rather than what it measured: the responsive span of
 * every Grid cell the image sits in (`xs:12 md:4` → a third from `md` up),
 * and every `repeat(n, 1fr)` grid it sits in. Nested ones multiply.
 *
 * A band is answered only when something stated it and nothing between the
 * image and the page made it unknowable — an `auto` or `grow` cell is sized by
 * its content, so a band where any cell is one has no answer here. Gutters are
 * not subtracted: a slightly wide guess costs a slightly larger candidate.
 */
export function layoutBandWidths(
  node: LayoutNode | undefined,
): Aglyn.RenderedWidths {
  const fractions: BandValues<number | null> = {}
  let stated = false
  const apply = (band: Aglyn.RenderedWidthBand, factor: number | null) => {
    const current = fractions[band]
    if (current === null) return
    fractions[band] = factor === null ? null : (current ?? 1) * factor
  }
  for (let current = node?.parent; current; current = current.parent) {
    if (current.componentId === GRID_COMPONENT_ID) {
      const spans = gridSpanPerBand(propsOf(current)['size'])
      if (Object.keys(spans).length) {
        const container = current.parent
        const columns =
          container?.componentId === GRID_COMPONENT_ID
            ? Number(propsOf(container)['columns'])
            : NaN
        const total = columns > 0 ? columns : 12
        stated = true
        for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
          const span = spans[band]
          if (span === undefined) apply(band, null)
          else apply(band, span === null ? null : Math.min(span / total, 1))
        }
      }
    }
    const sx = current.sx
    const template =
      sx && typeof sx === 'object' && !Array.isArray(sx)
        ? (sx as Record<string, unknown>)['gridTemplateColumns']
        : undefined
    const tracks = repeatTracksPerBand(template)
    if (Object.keys(tracks).length) {
      stated = true
      for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
        const count = tracks[band]
        if (count !== undefined) apply(band, 1 / count)
      }
    }
  }
  if (!stated) return {}
  const widths: Aglyn.RenderedWidths = {}
  for (const band of Aglyn.RENDERED_WIDTH_BANDS) {
    const fraction = fractions[band]
    if (typeof fraction === 'number' && fraction > 0) {
      widths[band] = Math.round(fraction * 1000) / 10
    }
  }
  return widths
}
