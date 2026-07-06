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

import type { HostThemeSchemeColors } from '@aglyn/shared-data-types'

export type PaletteColorKey =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'surface'
  | 'error'
  | 'warning'
  | 'info'
  | 'success'

export const PALETTE_COLOR_FIELDS: Array<{
  key: PaletteColorKey
  label: string
}> = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'tertiary', label: 'Tertiary' },
  { key: 'surface', label: 'Surface' },
  { key: 'error', label: 'Error' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
  { key: 'success', label: 'Success' },
]

export type SurfaceColorPath =
  | ['background', 'default']
  | ['background', 'paper']
  | ['text', 'primary']
  | ['text', 'secondary']
  | ['text', 'disabled']

export const SURFACE_COLOR_FIELDS: Array<{
  path: SurfaceColorPath
  label: string
}> = [
  { path: ['background', 'default'], label: 'Background' },
  { path: ['background', 'paper'], label: 'Paper' },
  { path: ['text', 'primary'], label: 'Text' },
  { path: ['text', 'secondary'], label: 'Secondary text' },
  { path: ['text', 'disabled'], label: 'Disabled text' },
]

/** Curated Google Fonts choices for the font family selector. */
export const GOOGLE_FONT_OPTIONS: Array<{
  family: string
  category: 'sans-serif' | 'serif' | 'monospace' | 'display'
  weights: Array<number>
}> = [
  { family: 'Inter', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Lato', category: 'sans-serif', weights: [400, 700] },
  { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Poppins', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Nunito', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Work Sans', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Raleway', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Merriweather', category: 'serif', weights: [400, 700] },
  { family: 'Playfair Display', category: 'serif', weights: [400, 700] },
  { family: 'Lora', category: 'serif', weights: [400, 700] },
  { family: 'Source Serif 4', category: 'serif', weights: [400, 700] },
  { family: 'JetBrains Mono', category: 'monospace', weights: [400, 700] },
  { family: 'Bebas Neue', category: 'display', weights: [400] },
]

export function fontFamilyStack(
  family: string,
  category: (typeof GOOGLE_FONT_OPTIONS)[number]['category'],
) {
  const fallback = category === 'monospace' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif'
  return `"${family}", ${fallback}`
}

export function getSchemeColor(
  colors: HostThemeSchemeColors | undefined,
  path: SurfaceColorPath,
): string | undefined {
  const [group, key] = path
  return (colors?.[group] as Record<string, string> | undefined)?.[key]
}
