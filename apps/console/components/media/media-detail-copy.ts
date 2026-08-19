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

/**
 * The asset-detail drawer's two new decisions, out of the component (AGL-2143).
 *
 * `media-library.component.tsx` mounts a Firestore listener stack and a
 * dnd-kit surface, so a test that renders it is a test of the mocks — the
 * reason `media-asset-card-selection.spec.tsx` says it renders the card and
 * not the grid. Both of these are pure string questions, so they move here
 * and are asserted directly, the same split `media-delete-copy.ts` and
 * `media-usage-copy.ts` already use.
 */

export interface MediaDeliveryFacts {
  /** Stable CDN path, absent for a free-tier or storage-served asset. */
  cdnPath?: string
  /** WebP widths actually generated for THIS asset. */
  variants?: number[]
}

export interface MediaDeliveryDescription {
  /** Whether the asset is CDN-delivered, for the status dot. */
  onCdn: boolean
  /** The widths, sorted and sanitised. */
  widths: number[]
  label: string
}

/**
 * What the drawer's delivery footer says.
 *
 * `/product/media`'s mockup names `CDN · variants 320 / 640 / 1280`, and those
 * are exactly the widths `media-variants.ts` generates — and never surfaced
 * anywhere. An org WITHOUT `mediaCdn` is told plenty (a "No CDN · URLs change
 * on move" chip and a tooltip explaining what a paid plan buys); an org that
 * has PAID for it was told nothing at all, which is the wrong way round for
 * an upgrade we want renewed.
 *
 * READS THE ASSET, NOT THE CONSTANT. `MEDIA_CDN_VARIANT_WIDTHS` says what the
 * generator aims to produce; the doc's `variants` array says what this file
 * actually got. `media-variants.ts` is explicit that an empty array means
 * either "nothing was eligible" (an SVG, a non-image) or "generation was
 * attempted and failed" — indistinguishable from outside, so the honest thing
 * to say is that there are none, rather than naming three widths a `?w=320`
 * request would not be served from.
 *
 * It is also a server module, so importing it into this client component
 * would pull a server-only graph into the console bundle.
 */
export function describeMediaDelivery(
  media: MediaDeliveryFacts | null | undefined,
): MediaDeliveryDescription {
  const widths = Array.isArray(media?.variants)
    ? media.variants
        .map((width) => Number(width))
        .filter((width) => Number.isFinite(width) && width > 0)
        .sort((a, b) => a - b)
    : []
  if (!media?.cdnPath) {
    return {
      onCdn: false,
      widths,
      label: 'Served from storage · no CDN, no variants',
    }
  }
  return {
    onCdn: true,
    widths,
    label: widths.length
      ? `CDN · variants ${widths.join(' / ')}`
      : 'CDN · no responsive variants for this file',
  }
}

/**
 * Folds a typed tag into the drawer's stored comma-joined string, or reports
 * that nothing changed.
 *
 * The stored shape is deliberately UNCHANGED — still the comma-joined string
 * `handleSave` normalises — so nothing downstream moves and a tag typed as a
 * chip is byte-identical to one typed into the old free-text field.
 *
 * `normalizeMediaTags` is the same function the save path runs, which is what
 * makes a chip on screen exactly a tag that will be stored. It drops blanks,
 * duplicates, anything past the length cap, and lower-cases — so a trailing
 * space can no longer become a distinct tag that no filter chip will ever
 * match, which was the actual cost of reading tags back out of free text.
 *
 * Returns `null` when the draft added nothing. The caller clears the field
 * either way: re-adding a tag that is already a chip should look like nothing
 * happened, because it is.
 */
export function addMediaTag(current: string, draft: string): string | null {
  const existing = Aglyn.normalizeMediaTags(current ?? '')
  const next = Aglyn.normalizeMediaTags([...existing, draft ?? ''])
  if (next.length === existing.length) return null
  return next.join(', ')
}

/** Removes one tag, preserving the stored comma-joined shape. */
export function removeMediaTag(current: string, tag: string): string {
  return Aglyn.normalizeMediaTags(current ?? '')
    .filter((entry) => entry !== tag)
    .join(', ')
}
