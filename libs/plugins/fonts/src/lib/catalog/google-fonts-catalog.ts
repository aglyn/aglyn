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

import type {
  HostThemeFontCategory,
  HostThemeFontMetrics,
} from '@aglyn/shared-data-types'

/**
 * The Google Fonts catalog the plugin ships (AGL-3656): every family, what it
 * offers, and the metrics of its regular face. Written by
 * `tools/scripts/generate-google-fonts-catalog.mts`; this module reads it.
 *
 * Loaded on first use and kept, never at import: it is ~270 KB of JSON, and
 * the module that imports this one is loaded at boot by both apps' servers.
 */

/** A variation axis a family's variable font offers. */
export interface GoogleFontAxis {
  tag: string
  min: number
  max: number
}

export interface GoogleFontFamily {
  family: string
  category: HostThemeFontCategory
  /** Upright weights, ascending. */
  weights: number[]
  /** Italic weights, ascending; empty when the family has no italics. */
  italics: number[]
  /** Variation axes; empty for a family served only as static faces. */
  axes: GoogleFontAxis[]
  /** Scripts the family covers (`latin`, `latin-ext`, `cyrillic`, …). */
  subsets: string[]
  /** 1 is the most used family on the web. */
  popularity: number
  metrics?: HostThemeFontMetrics
}

interface CatalogRow {
  f: string
  c: HostThemeFontCategory
  w: number[]
  i?: number[]
  a?: string
  s: string[]
  p: number
  m?: [number, number, number, number, number]
}

function parseAxes(value: string | undefined): GoogleFontAxis[] {
  if (!value) return []
  return value.split(',').flatMap((entry) => {
    const match = /^([A-Za-z]{4}):(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(entry)
    return match ? [{ tag: match[1], min: Number(match[2]), max: Number(match[3]) }] : []
  })
}

/** One catalog row, expanded. Exported for the specs. */
export function expandCatalogRow(row: CatalogRow): GoogleFontFamily {
  return {
    family: row.f,
    category: row.c,
    weights: row.w,
    italics: row.i ?? [],
    axes: parseAxes(row.a),
    subsets: row.s,
    popularity: row.p,
    ...(row.m
      ? {
          metrics: {
            unitsPerEm: row.m[0],
            ascent: row.m[1],
            descent: row.m[2],
            lineGap: row.m[3],
            xWidthAvg: row.m[4],
          },
        }
      : {}),
  }
}

let catalog: Promise<GoogleFontFamily[]> | undefined
let byName: Promise<Map<string, GoogleFontFamily>> | undefined

/** Every family, most popular first. */
export function loadGoogleFontsCatalog(): Promise<GoogleFontFamily[]> {
  catalog ??= import('./google-fonts.catalog.json').then((module) => {
    const data = ((module as { default?: unknown }).default ?? module) as {
      families: CatalogRow[]
    }
    return data.families.map(expandCatalogRow)
  })
  return catalog
}

/** One family by name, matched case-insensitively. */
export async function findGoogleFontFamily(
  family: string,
): Promise<GoogleFontFamily | undefined> {
  byName ??= loadGoogleFontsCatalog().then(
    (families) => new Map(families.map((entry) => [entry.family.toLowerCase(), entry])),
  )
  return (await byName).get(family.trim().toLowerCase())
}
