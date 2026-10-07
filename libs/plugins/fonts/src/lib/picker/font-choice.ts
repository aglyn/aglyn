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

import type { HostThemeFontCategory } from '@aglyn/shared-data-types'
import type { ThemeFontChoice } from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import type { GoogleFontFamily } from '../catalog/google-fonts-catalog'

/** The role a font plays in a theme, as the picker offers it. */
export type FontRole = 'body' | 'heading'

/** How the picker names each category, in the order its chips list them. */
export const FONT_CATEGORY_LABELS: ReadonlyArray<{ value: HostThemeFontCategory; label: string }> = [
  { value: 'sans-serif', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Handwriting' },
  { value: 'monospace', label: 'Monospace' },
]

export function categoryLabel(category: HostThemeFontCategory): string {
  return FONT_CATEGORY_LABELS.find((entry) => entry.value === category)?.label ?? category
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
  1000: 'Extra black',
}

/** `Bold 700`. */
export function weightLabel(weight: number): string {
  const name = WEIGHT_NAMES[weight]
  return name ? `${name} ${weight}` : String(weight)
}

/** The CSS generic family a category falls back to. */
export function genericFamily(category: HostThemeFontCategory): string {
  if (category === 'serif') return 'serif'
  if (category === 'monospace') return 'monospace'
  return 'sans-serif'
}

/** Each wanted weight as the nearest one offered, without repeats. */
export function nearestWeights(wanted: readonly number[], offered: readonly number[]): number[] {
  if (!offered.length) return [...wanted]
  return [
    ...new Set(
      wanted.map((weight) =>
        offered.reduce((best, candidate) =>
          Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
        ),
      ),
    ),
  ].sort((a, b) => a - b)
}

/**
 * A family as first chosen for a role: body text in its regular and bold with
 * a true italic, headings in its bold. The person then adds or removes
 * weights.
 */
export function defaultFontChoice(family: GoogleFontFamily, role: FontRole): ThemeFontChoice {
  const weights = nearestWeights(role === 'body' ? [400, 700] : [700], family.weights)
  const italics = role === 'body' && family.italics.length ? nearestWeights([400], family.italics) : []
  return {
    family: family.family,
    category: family.category,
    weights,
    ...(italics.length ? { italics } : {}),
    source: 'google',
  }
}

/** `Regular 400, Bold 700 + italic`, for a choice's summary line. */
export function choiceStylesLabel(choice: ThemeFontChoice): string {
  const weights = choice.weights.map(weightLabel).join(', ')
  return choice.italics?.length ? `${weights} + italic` : weights
}

/** Families matching a search, most used first, names that start with it before the rest. */
export function searchFontFamilies(
  catalog: readonly GoogleFontFamily[],
  query: string,
  category: string,
): GoogleFontFamily[] {
  const words = query.trim().toLowerCase()
  const inCategory = category ? catalog.filter((entry) => entry.category === category) : catalog
  if (!words) return [...inCategory]
  const starts: GoogleFontFamily[] = []
  const contains: GoogleFontFamily[] = []
  for (const entry of inCategory) {
    const name = entry.family.toLowerCase()
    if (name.startsWith(words)) starts.push(entry)
    else if (name.includes(words)) contains.push(entry)
  }
  return [...starts, ...contains]
}
