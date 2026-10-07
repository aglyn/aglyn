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
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * What a published page needs to know about a font family a theme names
 * (AGL-3656), asked of whichever plugin catalogs fonts rather than read off a
 * list in core.
 *
 * The page loads only the weights and italics a family really offers — a
 * theme asking for an 800 the family does not have would otherwise get the
 * browser's nearest face, or a synthesized bold — and sizes a local fallback
 * face to the family's own metrics, so nothing moves when the web font swaps
 * in. With no catalog registered, a page loads what the theme lists and
 * swaps with no metric-matched fallback, which is what every page did before.
 */
export interface ThemeFontFacts {
  family: string
  category: HostThemeFontCategory
  /** The upright weights the family offers. */
  weights: number[]
  /** The italic weights the family offers. */
  italics: number[]
  /**
   * The weight range of the family's variable font, when it has one. Such a
   * family can be served as one file holding every weight or as a file per
   * weight, and the page picks whichever is smaller for the weights it uses.
   */
  variableWeights?: [number, number]
  /** Of the regular face; absent when the catalog could not read them. */
  metrics?: HostThemeFontMetrics
}

export interface PluginThemeFontCatalog {
  /** The family's facts, matched case-insensitively, or undefined when unknown. */
  facts(family: string): Promise<ThemeFontFacts | undefined>
}

export const PLUGIN_THEME_FONT_CATALOG =
  definePluginServiceContract<PluginThemeFontCatalog>('core.theme.fontCatalog', {
    multiple: false,
  })

export function registerPluginThemeFontCatalog(
  catalog: PluginThemeFontCatalog,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_THEME_FONT_CATALOG, catalog, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * A family's facts from the registered catalog; undefined when no plugin
 * catalogs fonts, the family is not in it, or the catalog failed. Never
 * throws: a page renders without a fact rather than without its theme.
 */
export async function themeFontFacts(
  family: string,
): Promise<ThemeFontFacts | undefined> {
  const catalog = resolvePluginService(PLUGIN_THEME_FONT_CATALOG)
  if (!catalog) return undefined
  try {
    return await catalog.facts(family)
  } catch {
    return undefined
  }
}
