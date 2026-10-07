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

import type { HostThemeFont } from '@aglyn/shared-data-types'

// The browser half of the font loader (AGL-3656), kept apart from
// `self-hosted-fonts.ts` because every published page loads it.

/** The name a family's metric-matched fallback face is declared under. */
export function metricFallbackFamily(family: string): string {
  return `${family.replace(/['"\\\n\r]/g, '').trim()} Fallback`
}

/** The families in a CSS `font-family` stack, unquoted. */
export function stackFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
}

/**
 * A stack with each loaded family's fallback named right after it, once:
 * `"Inter", system-ui` → `"Inter", "Inter Fallback", system-ui`. Where no
 * page declares the fallback (the editor), the name matches nothing.
 */
export function withMetricFallbacks(stack: string, families: readonly string[]): string {
  if (!families.length) return stack
  const loaded = new Set(families.map((family) => family.toLowerCase()))
  const present = new Set(stackFamilies(stack).map((family) => family.toLowerCase()))
  const out: string[] = []
  for (const part of stack.split(',')) {
    out.push(part)
    const name = part.trim().replace(/^['"]|['"]$/g, '').trim()
    const fallback = metricFallbackFamily(name)
    if (loaded.has(name.toLowerCase()) && !present.has(fallback.toLowerCase())) {
      out.push(` "${fallback}"`)
    }
  }
  return out.join(',')
}

/** The families a theme loads as web fonts: Google families and uploads. */
export function themeWebFontFamilies(fonts: readonly HostThemeFont[] | undefined): string[] {
  return (fonts ?? [])
    .filter((font) => font.family && (font.source ?? 'google') !== 'system')
    .map((font) => font.family.trim())
}

/**
 * A theme with each web font's fallback named in its stacks, for the page
 * that declares the fallbacks. `baseStack` and `baseFonts` stand in for a
 * theme that names no face of its own but whose base loads one (the brand's
 * on an operator host). Done on the server, so no browser bundle carries it.
 */
export function withThemeMetricFallbacks<
  T extends {
    fonts?: readonly HostThemeFont[]
    typography?: { fontFamily?: string; variants?: Record<string, { fontFamily?: string } | undefined> }
  },
>(theme: T | undefined, baseStack?: string, baseFonts: readonly HostThemeFont[] = []): T | undefined {
  const families = themeWebFontFamilies([...(theme?.fonts ?? []), ...baseFonts])
  if (!families.length) return theme
  const typography = theme?.typography
  const stack = typography?.fontFamily ?? (baseFonts.length ? baseStack : undefined)
  const variants = typography?.variants
    ? Object.fromEntries(
        Object.entries(typography.variants).map(([key, variant]) => [
          key,
          variant?.fontFamily
            ? { ...variant, fontFamily: withMetricFallbacks(variant.fontFamily, families) }
            : variant,
        ]),
      )
    : undefined
  return {
    ...(theme as T),
    typography: {
      ...typography,
      ...(stack ? { fontFamily: withMetricFallbacks(stack, families) } : {}),
      ...(variants ? { variants } : {}),
    },
  }
}
