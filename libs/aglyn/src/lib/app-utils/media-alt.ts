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
 * The `alt` a rendered `<img>` carries, and the cap every author-typed one
 * is trimmed to.
 *
 * Its own module because a published page reads only these two — every cover
 * image on a site stamps its `alt` through them — while `media-metadata.ts`
 * around it is pick-time and upload-time work: tag normalization, the
 * inherited-alt decision, intrinsic sizing, and a byte-level image header
 * parser for PNG, JPEG, GIF, WebP and AVIF. None of that runs to render an
 * attribute, and a bundler cannot drop it around a single named import.
 */

/** Longest `alt` stored or emitted; anything longer is trimmed to it. */
export const MEDIA_ALT_MAX_LENGTH = 300

/**
 * The `alt` to put on a rendered `<img>` (AGL-2418).
 *
 * The render-time counterpart to `inheritedMediaAlt`, which decides what to
 * STORE at pick time. This decides what to EMIT, and it always returns a
 * string — never `undefined` — because the one thing a cover must not do is
 * render without the attribute at all. `alt=""` and a missing `alt` are
 * different announcements: the empty attribute tells a screen reader "skip
 * this, the adjacent text names it", while an absent one makes it fall back
 * to reading the file name aloud. Every entry and event authored before the
 * field existed takes the empty branch, so that distinction is not an edge
 * case here — it is the majority of real content.
 *
 * `fallback` is for the placements where the image IS the accessible name of
 * its own link, and so cannot be silent — the related-entries cover, whose
 * only text is the title it sits under. Placements where adjacent text
 * already names the image (the entry hero directly beneath its `<h1>`, the
 * 96×96 event thumbnail beside its title) pass no fallback and stay empty,
 * because repeating the heading there is a double announcement. The two
 * rules look inconsistent and are not; flattening them to one would make
 * accessibility worse in whichever direction it flattened.
 *
 * Nothing is ever fabricated from a file name, for the reason
 * `inheritedMediaAlt` gives: "IMG_4021.jpg" read aloud is worse than silence.
 */
export function renderedMediaAlt(authored?: unknown, fallback?: unknown) {
  const typed = typeof authored === 'string' ? authored.trim() : ''
  if (typed) return typed.slice(0, MEDIA_ALT_MAX_LENGTH)
  const named = typeof fallback === 'string' ? fallback.trim() : ''
  return named ? named.slice(0, MEDIA_ALT_MAX_LENGTH) : ''
}
