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

import type { SiteStarterTheme } from '../app-utils/site-starter'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * The look each site style gives a new site, as the console's SERVER reads it
 * (AGL-4049).
 *
 * A site is created only once a person has chosen a style
 * (`app-utils/site-styles.ts`). The core keeps the list of styles; what each
 * one LOOKS like — a built-in theme, a brand color, a font pairing — is the
 * AI plugin's, which designed the 21 looks. So the core names the one
 * question the create asks and one plugin answers it. With none registered,
 * a site still starts in the default theme, and its style is still recorded.
 */

/** A built-in theme with a brand and fonts over it: the shape a style's look takes. */
export type SiteStyleLook = Extract<SiteStarterTheme, { kind: 'builtin' }>

export interface PluginSiteStyleLookSource {
  /** The look a style starts a site in, or `null` for a style this source has none for. */
  look(styleId: string): Promise<SiteStyleLook | null>
}

export const PLUGIN_SITE_STYLE_LOOKS = definePluginServiceContract<PluginSiteStyleLookSource>(
  'core.site-style-looks',
  { multiple: false },
)

/** Registers the plugin that answers each style's look. One per deployment; a second is refused. */
export function registerPluginSiteStyleLooks(
  impl: PluginSiteStyleLookSource,
  options: { pluginId: string },
): void {
  registerPluginService(PLUGIN_SITE_STYLE_LOOKS, impl, { pluginId: options.pluginId })
}

/** The registered look source, or `null` when no plugin answers. */
export function resolveSiteStyleLooks(): PluginSiteStyleLookSource | null {
  return resolvePluginService(PLUGIN_SITE_STYLE_LOOKS) ?? null
}
