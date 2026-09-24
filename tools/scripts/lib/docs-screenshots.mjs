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

// The pure half of `check:docs-screenshots` (AGL-1950): find the images a docs
// page points at, and decide whether what is on disk is actually a picture.
//
// Split out from the CLI for the same reason every other guard here is: the
// only thing worth knowing about a green scan is whether the scanner can go
// red, and that is a question about these two functions, not about the tree
// they happen to be pointed at.

/**
 * A screenshot smaller than this is a flat fill whatever else it claims —
 * PNG's filters leave a real console capture far above it. Deliberately well
 * below the smallest genuine capture in the tree (~6 KB, a cropped panel
 * after the harness optimizes it) so the floor is never the thing that
 * fails; `isFlatColour` is the assertion meant to bite.
 */
export const MIN_BYTES = 1024

/**
 * The ceiling every docs image is held to (AGL-3319), the same number the
 * capture harness optimizes toward (`tools/e2e/lib/optimize-png.mjs`). A
 * frame over it is a composition problem, too much page or a photograph where
 * a UI crop was meant, and it is what a reader on a slow line pays for.
 */
export const MAX_BYTES = 300 * 1024

/**
 * Both spellings a docs page can use for a static image: the markdown
 * `![alt](/img/…)` the capture plan prescribes, and the raw `<img src="/img/…">`
 * a page reaches for when it needs a width.
 *
 * Anchored at `/img/` on purpose. A remote URL is somebody else's uptime and a
 * relative path is resolved by the bundler, which already fails the build —
 * this guard exists for the case Docusaurus CANNOT see, which is a root-
 * absolute reference into `static/`.
 *
 * @param {string} source markdown/MDX file contents
 * @returns {{ url: string, line: number }[]} in first-appearance order
 */
export function findImageReferences(source) {
  const patterns = [
    /!\[[^\]]*\]\((\/img\/[^)\s]+)/g,
    /<img[^>]+src=["'](\/img\/[^"']+)["']/g,
  ]
  const found = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source))) {
      found.push({
        url: match[1],
        line: source.slice(0, match.index).split('\n').length,
        index: match.index,
      })
    }
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ url, line }) => ({ url, line }))
}

/**
 * Is every channel of this image a single constant value? That is what an
 * all-white capture, an all-transparent one, or a `clip` that resolved to a
 * region of empty backdrop looks like — a real file, of a plausible size, with
 * correct dimensions, and no picture in it.
 *
 * Takes the stats object rather than a path so it can be tested without
 * encoding a PNG, and so the CLI owns the only sharp import.
 *
 * @param {{ channels: { stdev: number }[] }} stats as returned by sharp().stats()
 */
export function isFlatColour(stats) {
  const channels = stats?.channels
  if (!Array.isArray(channels) || channels.length === 0) return false
  return channels.every((channel) => channel.stdev === 0)
}

/**
 * The verdict on one referenced image.
 *
 * @param {{ size: number | null, stats: object | null, error: string | null }} probe
 *   `size: null` means the file is not there; `error` means it would not decode.
 * @returns {string | null} the reason it fails, or null if it is a real picture
 */
export function classifyImage(probe) {
  if (probe.size === null || probe.size === undefined) {
    return 'no such file under apps/docs/static'
  }
  if (probe.error) return `will not decode (${probe.error})`
  if (probe.size < MIN_BYTES) {
    return `only ${probe.size} bytes — not a screenshot`
  }
  if (probe.size > MAX_BYTES) {
    return `${Math.round(probe.size / 1024)} KB — over the ${MAX_BYTES / 1024} KB ceiling`
  }
  if (isFlatColour(probe.stats)) {
    return 'decodes to a single flat colour — a capture of nothing'
  }
  return null
}

/**
 * Every root-absolute `img/…` path a source names, with or without the
 * leading slash: `docusaurus.config.ts` writes `img/aglyn-social-card.png`,
 * a page writes `/img/…`.
 *
 * @param {string} source any text file
 * @returns {string[]} paths relative to `static/`, e.g. `img/api/x.png`
 */
export function findStaticImagePaths(source) {
  const found = new Set()
  const pattern = /(?:^|[^\w/.-])\/?(img\/[\w./-]+\.(?:png|jpe?g|webp|gif|svg|ico))/g
  let match
  while ((match = pattern.exec(source))) found.add(match[1])
  return [...found]
}

/**
 * The images under `static/img` that nothing points at (AGL-3319).
 *
 * An orphan is not harmless: the capture harness keeps re-shooting it, the
 * inventory keeps counting it, and nobody can tell from the file whether a
 * page lost it on purpose. A page that stops using an image deletes it.
 *
 * @param {string[]} images every image path under static/, as `img/…`
 * @param {Iterable<string>} referenced the `img/…` paths any page, the site
 *   config or a theme component names
 * @returns {string[]} the orphans, sorted
 */
export function findOrphanImages(images, referenced) {
  const named = new Set(referenced)
  return images.filter((image) => !named.has(image)).sort()
}
