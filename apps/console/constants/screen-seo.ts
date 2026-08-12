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
 * How a screen's `seo` map is rebuilt from a partial edit (AGL-1437).
 *
 * ## Why this is one function and not two panels' worth of inline code
 *
 * Two surfaces edit the same map — the besigner's Screen Properties ▸ SEO
 * panel and the screen detail page's SEO card — and they DID drift. The
 * detail page carried untouched keys forward and dropped a cleared image;
 * the besigner defaulted the social-image triple to `''`/`0`/`0`, so saving a
 * description on a screen with no social image invented three keys the
 * document never had. `/careers` held exactly `{ description, title }`, and a
 * save through the besigner would have made it five.
 *
 * The rules below are the subtle part and belong in one place, exactly as
 * `ScreenSocialImageDraft`'s staging contract does — which is why that type
 * lives here now too, rather than in the field component that happens to
 * produce it.
 *
 * ## The rules
 *
 * 1. **Never invent a key.** An absent `image` and an `image: ''` beside
 *    `0`×`0` are not the same document to any reader that checks presence
 *    rather than truthiness, and the second makes a screen look like it has
 *    an authored social card when it does not.
 * 2. **Carry untouched keys forward.** `updateDoc` REPLACES a nested map, so
 *    a panel that edits two fields and writes a fresh map silently deletes
 *    `breadcrumb` and anything else stored beside them.
 * 3. **Emptied means removed**, not stored blank — same reason as (1), and it
 *    is what lets the head fall back to the site default.
 * 4. **The image and its dimensions move as ONE group.** An image beside the
 *    previous image's size describes a card that does not exist.
 *
 * Carrying keys forward is what makes both call sites the AGL-1358 shape:
 * `existing` comes off a Firestore LISTENER, so the write must still be
 * wrapped in `writeGuardedBySeed`. This function is pure and knows nothing
 * about that — it cannot be the place the guard is enforced, and neither call
 * site may treat it as one.
 */

/**
 * A staged social image (AGL-1337).
 *
 * The dimensions travel WITH the reference, so this is one draft value rather
 * than three independent fields. An empty `image` is a real, saveable value
 * meaning "cleared", which the head reads as "inherit the site default".
 */
export interface ScreenSocialImageDraft {
  image: string
  imageWidth: number
  imageHeight: number
}

/**
 * The staged edits. Every field is optional and `null`/`undefined` means the
 * author did not touch it — which is NOT the same as clearing it, and is the
 * distinction that keeps a save from writing over a field nobody opened.
 */
export interface ScreenSeoEdits {
  /** Staged search title. */
  title?: string | null
  /** Staged search description. */
  description?: string | null
  /** Staged social image; an empty `image` means the author cleared it. */
  image?: ScreenSocialImageDraft | null
}

/** The text fields, which share their emptied-means-removed rule. */
const TEXT_FIELDS = ['title', 'description'] as const

/** The social image and its dimensions, written and removed together. */
const IMAGE_FIELDS = ['image', 'imageWidth', 'imageHeight'] as const

/**
 * Apply `edits` over the stored `seo` map.
 *
 * Returns the map to write, or `null` when nothing is left in it — the caller
 * writes `deleteField()` there rather than storing an empty map, which reads
 * back as an authored-but-blank SEO record.
 */
export function buildScreenSeoUpdate(
  existing: Record<string, unknown> | undefined | null,
  edits: ScreenSeoEdits,
): Record<string, unknown> | null {
  const seo: Record<string, unknown> = { ...(existing ?? {}) }
  for (const field of TEXT_FIELDS) {
    const staged = edits[field]
    // Untouched. Whatever the document holds stays exactly as it is.
    if (staged == null) continue
    const value = staged.trim()
    if (value) seo[field] = value
    else delete seo[field]
  }
  if (edits.image != null) {
    if (edits.image.image) {
      seo.image = edits.image.image
      seo.imageWidth = edits.image.imageWidth
      seo.imageHeight = edits.image.imageHeight
    } else {
      for (const field of IMAGE_FIELDS) delete seo[field]
    }
  }
  return Object.keys(seo).length ? seo : null
}

export default buildScreenSeoUpdate
