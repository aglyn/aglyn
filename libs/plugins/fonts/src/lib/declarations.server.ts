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

import { registerPluginThemeFontCatalog } from '@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog'
import { FONTS_PLUGIN_ID } from './constants'

/**
 * Registers the Google Fonts catalog as the platform's theme font catalog, in
 * both apps' servers (`serverDeclarations`), so a published page loads only
 * the weights a family offers and sizes its fallback to the family's metrics
 * (AGL-3656).
 *
 * Light on purpose: the catalog JSON loads with the first question, never at
 * boot.
 */
export function registerFontsServerDeclarations(): void {
  registerPluginThemeFontCatalog(
    {
      facts: async (family) => {
        const { findGoogleFontFamily } = await import('./catalog/google-fonts-catalog')
        const entry = await findGoogleFontFamily(family)
        if (!entry) return undefined
        const wght = entry.axes.find((axis) => axis.tag === 'wght')
        return {
          family: entry.family,
          category: entry.category,
          weights: entry.weights,
          italics: entry.italics,
          ...(wght ? { variableWeights: [wght.min, wght.max] as [number, number] } : {}),
          ...(entry.metrics ? { metrics: entry.metrics } : {}),
        }
      },
    },
    { pluginId: FONTS_PLUGIN_ID },
  )
}
