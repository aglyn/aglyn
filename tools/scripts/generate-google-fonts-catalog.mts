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
 * Writes the Google Fonts catalog the fonts plugin ships (AGL-3656).
 *
 * ```
 * npm run generate:google-fonts-catalog
 * node tools/scripts/generate-google-fonts-catalog.mts --limit=50   # a quick sample
 * ```
 *
 * Two things the platform cannot ask Google for at page view:
 *
 *  1. **The catalog** the theme editor's font picker browses — every family,
 *     its category, the weights and italics it offers, its variation axes, the
 *     scripts it covers and its popularity rank. From Google's public metadata
 *     document, trimmed to those fields.
 *  2. **The metrics** a published page sizes its fallback face to
 *     (`size-adjust` and the ascent, descent and line-gap overrides). Those are
 *     read from each family's own regular face: its Latin WOFF2 file is
 *     downloaded, unwrapped and read with the plugin's own SFNT reader — the
 *     same code the installer reads an uploaded font with, so a Google family
 *     and an uploaded one are measured one way.
 *
 * The output is DATA fetched from the network, so there is no `--check`: run
 * it when Google adds families, and review the diff. A family whose file could
 * not be read keeps its catalog row without metrics; the page then swaps in
 * the font with no metric-matched fallback, which is what every page did
 * before this existed.
 *
 * About 2,000 families and two requests each; a few minutes at the default
 * concurrency.
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFontFile } from '../../libs/plugins/fonts/src/lib/font-file/read-font-file.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'libs/plugins/fonts/src/lib/catalog/google-fonts.catalog.json')
const require = createRequire(import.meta.url)
const fontverter = require('fontverter') as {
  convert(buffer: Buffer, format: 'truetype' | 'sfnt'): Promise<Buffer>
}

const METADATA_URL = 'https://fonts.google.com/metadata/fonts'
/** Google's CSS2 API answers a current Chrome with WOFF2. */
const WOFF2_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1]
const LIMIT = Number(arg('limit') ?? Infinity)
const CONCURRENCY = Number(arg('concurrency') ?? 24)

const CATEGORY: Record<string, string> = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'display',
  Handwriting: 'handwriting',
  Monospace: 'monospace',
}

interface MetadataFamily {
  family: string
  category: string
  subsets: string[]
  fonts: Record<string, unknown>
  axes?: Array<{ tag: string; min: number; max: number; defaultValue: number }>
  popularity: number
}

async function text(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

async function metricsFor(family: MetadataFamily, weight: number) {
  const css = await text(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.family).replace(/%20/g, '+')}:wght@${weight}&display=swap`,
    { headers: { 'User-Agent': WOFF2_USER_AGENT } },
  )
  // The Latin file when the family has one; otherwise the first it lists.
  const latin = /\/\*\s*latin\s*\*\/[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css)
  const url = latin?.[1] ?? /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css)?.[1]
  if (!url) return undefined
  const response = await fetch(url)
  if (!response.ok) return undefined
  const sfnt = await fontverter.convert(Buffer.from(await response.arrayBuffer()), 'truetype')
  const { metrics } = readFontFile(sfnt)
  return [metrics.unitsPerEm, metrics.ascent, metrics.descent, metrics.lineGap, metrics.xWidthAvg]
}

async function pool<T, R>(items: T[], size: number, run: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await run(items[index], index)
      }
    }),
  )
  return results
}

const metadata = JSON.parse((await text(METADATA_URL)).replace(/^\)\]\}'\n?/, '')) as {
  familyMetadataList: MetadataFamily[]
}
const families = metadata.familyMetadataList
  .filter((family) => CATEGORY[family.category])
  .sort((a, b) => a.popularity - b.popularity)
  .slice(0, LIMIT)

let failed = 0
const rows = await pool(families, CONCURRENCY, async (family, index) => {
  const upright = Object.keys(family.fonts)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b)
  const italics = Object.keys(family.fonts)
    .filter((key) => /^\d+i$/.test(key))
    .map((key) => Number(key.slice(0, -1)))
    .sort((a, b) => a - b)
  const regular = upright.length
    ? upright.reduce((best, weight) =>
        Math.abs(weight - 400) < Math.abs(best - 400) ? weight : best,
      )
    : 400
  let metrics: number[] | undefined
  try {
    metrics = await metricsFor(family, regular)
  } catch {
    metrics = undefined
  }
  if (!metrics) failed += 1
  if ((index + 1) % 200 === 0) console.log(`  ${index + 1}/${families.length}`)
  return {
    f: family.family,
    c: CATEGORY[family.category],
    w: upright,
    ...(italics.length ? { i: italics } : {}),
    ...(family.axes?.length
      ? { a: family.axes.map((axis) => `${axis.tag}:${axis.min}-${axis.max}`).join(',') }
      : {}),
    s: family.subsets.filter((subset) => subset !== 'menu'),
    p: index + 1,
    ...(metrics ? { m: metrics } : {}),
  }
})

writeFileSync(
  OUT,
  `${JSON.stringify({
    $comment:
      'Generated by tools/scripts/generate-google-fonts-catalog.mts (AGL-3656) from Google Fonts metadata. Do not edit by hand. f family, c category, w upright weights, i italic weights, a variation axes, s subsets, p popularity rank, m metrics [unitsPerEm, ascent, descent, lineGap, xWidthAvg] of the regular face.',
    families: rows,
  })}\n`,
)
console.log(`${rows.length} families written to ${OUT}; ${failed} without metrics.`)
