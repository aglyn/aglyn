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
 * How wide an element RENDERS, measured where it is built (AGL-3485).
 *
 * An `<img>` with a `srcset` downloads the candidate its `sizes` says the slot
 * needs, and nothing on a published page knows how wide the slot is: the
 * server has no layout, and the author's CSS is routinely `width: 100%` of
 * whatever holds it. So every image said `sizes="100vw"`, and a 68px logo
 * downloaded the 1920px variant.
 *
 * The one place that does know is the Besigner canvas, where the page is laid
 * out at the breakpoint the author is looking at. An element that wants its
 * width remembered records it here as it renders on the canvas, per
 * breakpoint band and as a share of the page's width; the editor's save writes
 * what was recorded onto the node under {@link RENDERED_WIDTHS_PROP}; and the
 * published render reads it back to say how big the image will be. Nobody has
 * to type anything: authors who have never heard of `sizes` get the right
 * one by building the page.
 *
 * A share of the page (`vw`), not pixels: the canvas is narrower than the
 * window it sits in, and a slot that is a third of the page on the canvas is a
 * third of the visitor's viewport too.
 *
 * The registry is process-wide on purpose, and lives on `globalThis` under a
 * registered symbol: the element that records and the editor that saves are
 * loaded by different bundles, and a module-level map would be a separate
 * copy in each.
 */

/** The breakpoint bands, narrowest first. MUI's keys, and the site theme's. */
export const RENDERED_WIDTH_BANDS = ['xs', 'sm', 'md', 'lg', 'xl'] as const

export type RenderedWidthBand = (typeof RENDERED_WIDTH_BANDS)[number]

/**
 * Where each band starts, in CSS pixels. MUI's defaults, which no site theme
 * overrides (`create-responsive-theme.ts` lists the keys and keeps the
 * values), and the widths the device switcher previews at.
 */
export const RENDERED_WIDTH_BAND_MIN: Readonly<
  Record<RenderedWidthBand, number>
> = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 }

/** A rendered width per band, as a percentage of the page's width. */
export type RenderedWidths = Partial<Record<RenderedWidthBand, number>>

/**
 * The node prop the editor's save writes the recorded widths to. Never an
 * author control: it describes where the element landed, not what anyone
 * asked for, and it is rewritten by the next save.
 */
export const RENDERED_WIDTHS_PROP = 'renderedWidths'

/**
 * How far a new measurement must move before the save rewrites the stored
 * one, in percentage points. Sub-pixel layout noise would otherwise rewrite
 * every image on every save and broadcast each one to co-editors.
 */
export const RENDERED_WIDTH_TOLERANCE = 0.5

const isBand = (key: string): key is RenderedWidthBand =>
  (RENDERED_WIDTH_BANDS as readonly string[]).includes(key)

/** A percentage rounded to the one decimal that is stored. */
function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

/** A usable stored percentage: finite, above zero, at most the whole page. */
function usablePercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value <= 0) return undefined
  return roundPercent(Math.min(value, 100))
}

/**
 * Reads a stored {@link RENDERED_WIDTHS_PROP} value, keeping only bands with a
 * usable percentage. Anything else — a hand-edited string, an unknown band —
 * is dropped rather than trusted, so Raw JSON cannot break a page's images.
 */
export function parseRenderedWidths(value: unknown): RenderedWidths {
  const widths: RenderedWidths = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return widths
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isBand(key)) continue
    const percent = usablePercent(raw)
    if (percent !== undefined) widths[key] = percent
  }
  return widths
}

/** The band a viewport (or a pinned device) of `width` pixels falls in. */
export function renderedWidthBand(width: number): RenderedWidthBand {
  let band: RenderedWidthBand = 'xs'
  for (const key of RENDERED_WIDTH_BANDS) {
    if (width >= RENDERED_WIDTH_BAND_MIN[key]) band = key
  }
  return band
}

/**
 * The percentage of the page an element of `elementWidth` pixels takes, or
 * undefined when either width is not a measurement (a hidden element, a page
 * that has not laid out).
 */
export function renderedWidthPercent(
  elementWidth: number,
  pageWidth: number,
): number | undefined {
  if (!(elementWidth > 0) || !(pageWidth > 0)) return undefined
  return usablePercent((elementWidth / pageWidth) * 100)
}

const REGISTRY_KEY = Symbol.for('aglyn.renderedWidths')

type Registry = Map<string, RenderedWidths>

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  let found = holder[REGISTRY_KEY]
  if (!found) {
    found = new Map()
    holder[REGISTRY_KEY] = found
  }
  return found
}

/**
 * Records that the element `nodeId` renders `percent` of the page wide in
 * `band`. Called by the element itself while it is on the canvas; the latest
 * measurement per band wins, so a layout the author changes is re-recorded as
 * it changes.
 */
export function recordRenderedWidth(
  nodeId: string,
  band: RenderedWidthBand,
  percent: number,
): void {
  const usable = usablePercent(percent)
  if (!nodeId || usable === undefined || !isBand(band)) return
  const entries = registry()
  entries.set(nodeId, { ...entries.get(nodeId), [band]: usable })
}

/** What has been recorded for `nodeId` since the registry was last cleared. */
export function recordedRenderedWidths(nodeId: string): RenderedWidths {
  return { ...registry().get(nodeId) }
}

/** Every node id with a recording, for the editor's save. */
export function recordedRenderedWidthNodeIds(): string[] {
  return [...registry().keys()]
}

/**
 * Forgets every recording. The editor calls it when it opens a document, so
 * a node id that two documents share cannot carry one page's measurements
 * into the other.
 */
export function clearRecordedRenderedWidths(): void {
  registry().clear()
}

/**
 * The stored widths with the recorded ones laid over them, or `undefined`
 * when no band moved by more than {@link RENDERED_WIDTH_TOLERANCE} — the
 * caller then leaves the node alone.
 *
 * Bands that were not recorded keep what an earlier session measured: an
 * author who checked the phone layout last week and the desktop one today
 * should not lose the phone measurement for having saved from the desktop.
 */
export function mergeRenderedWidths(
  stored: unknown,
  recorded: RenderedWidths,
): RenderedWidths | undefined {
  const previous = parseRenderedWidths(stored)
  const next: RenderedWidths = { ...previous }
  let changed = false
  for (const band of RENDERED_WIDTH_BANDS) {
    const value = usablePercent(recorded[band])
    if (value === undefined) continue
    const before = previous[band]
    if (
      before === undefined ||
      Math.abs(before - value) > RENDERED_WIDTH_TOLERANCE
    ) {
      next[band] = value
      changed = true
    }
  }
  return changed ? next : undefined
}

/**
 * A `sizes` attribute from a CSS length per band (`'33.3vw'`, `'68px'`),
 * widest band first, adjacent bands that agree merged into one condition. A
 * band with no length is given the next narrower band's, and the narrowest
 * band falls back to `100vw` — the last resort, used only where nothing better
 * is known.
 *
 * Inheriting the NARROWER band's length is the safe direction: a slot rarely
 * takes a bigger share of a wider page, so the guess errs towards a larger
 * candidate, which costs bytes, never sharpness.
 */
export function sizesFromBandLengths(
  lengths: Partial<Record<RenderedWidthBand, string>>,
): string {
  const resolved: Array<[RenderedWidthBand, string]> = []
  let carried = '100vw'
  for (const band of RENDERED_WIDTH_BANDS) {
    const value = lengths[band]
    if (typeof value === 'string' && value.trim()) carried = value.trim()
    resolved.push([band, carried])
  }
  const parts: string[] = []
  for (let index = resolved.length - 1; index >= 0; index -= 1) {
    const [band, value] = resolved[index]
    const below = index > 0 ? resolved[index - 1][1] : undefined
    if (below === value) continue
    parts.push(
      band === 'xs'
        ? value
        : `(min-width: ${RENDERED_WIDTH_BAND_MIN[band]}px) ${value}`,
    )
  }
  return parts.join(', ')
}

/** {@link sizesFromBandLengths} for widths given as percentages of the page. */
export function sizesFromBandWidths(widths: RenderedWidths): string {
  const lengths: Partial<Record<RenderedWidthBand, string>> = {}
  for (const band of RENDERED_WIDTH_BANDS) {
    const value = usablePercent(widths[band])
    if (value !== undefined) lengths[band] = `${value}vw`
  }
  return sizesFromBandLengths(lengths)
}
