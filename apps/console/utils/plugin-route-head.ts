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
 * The `<head>` for a page a plugin draws (AGL-3080).
 *
 * A plugin's console page is a client component, so its head is built by the
 * nearest server layout — and for a plugin route that layout is the shell's
 * generic one, which can only title a page from the slugs in its URL. That
 * is right for a hub and wrong for a record: every marketplace listing
 * unfurled as the same generic console card until the app grew a route with
 * a layout of its own, and that route is one of the ~20 that cannot move
 * onto the generic one while a hand-written layout is the only way to have a
 * card.
 *
 * So the plugin declares how to answer for an address under its route
 * (`registerPluginRouteMetadata`), and this is the shell's half: it loads
 * the plugins' server surfaces, asks, and turns what comes back into the
 * tags.
 *
 * ## ⛔ The load is the whole risk, which is why it is here and not at the
 * call sites
 *
 * The declarations live in a runtime registry, and an unfilled registry
 * answers "nothing to add" for every address — silently, and exactly like
 * the honest answer for a route nobody declared. A layout that asked without
 * loading first would drop every card this exists to produce and stay green,
 * which is the AGL-3025 shape. There is one function, it loads before it
 * asks, and `apps/console/specs/listing-card-is-registered.spec.ts` runs the
 * real manifest and holds that a real listing address still answers.
 *
 * A compiled table is not the alternative it usually is: the answer depends
 * on the DOCUMENT behind the address, so there is nothing to compile. What
 * makes the registry safe here is that the reader is a server layout which
 * already awaits, so it can load first.
 *
 * ## Why the tags are built here rather than by each plugin
 *
 * A declaration answers a title, a description and an image. How those
 * become `openGraph` and `twitter` is the same for every route and is the
 * shell's knowledge: that defining `openGraph` REPLACES the root layout's
 * wholesale, so the site name and type have to be restated; and that a card
 * with no image degrades to the small one rather than rendering a blank
 * slab. A plugin writing its own tags would get a different answer per
 * plugin, and the ones that got it wrong would look exactly like the ones
 * that got it right until somebody shared a link.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
// STATIC, unlike the loader below. Deferring a lib by its own specifier makes
// nx treat it as lazy-loaded everywhere, which forbids every static import of
// core across this app (AGL-2282).
import {
  resolvePluginRouteHead,
  type PluginRouteHead,
} from '@aglyn/aglyn/plugin-manager/plugin-route-metadata'
import type { Metadata } from 'next'

/**
 * Asks whichever plugin owns `route` about one address under it, after
 * making sure that plugin's server surface has been loaded.
 *
 * `null` means "nothing to add" — no declaration, an address the owner does
 * not describe, or an owner that failed — and every one of them leaves the
 * caller's own title alone.
 *
 * The loader is imported here rather than at module scope because importing
 * it builds the console's plugin manifest; Node caches the module, so a
 * later call is a map lookup. Its failure is caught: a plugin that will not
 * load costs a card, and a layout's metadata rejecting costs the page.
 */
export async function pluginRouteHead(
  route: string,
  segments: readonly string[],
): Promise<PluginRouteHead | null> {
  try {
    const { serverPluginLoader } = await import('./server-plugin-loader')
    await serverPluginLoader.ensureAll(['consoleApi'])
  } catch (error) {
    console.error(`[route-head] plugins failed to load for "${route}"`, error)
    return null
  }
  return await resolvePluginRouteHead(route, segments)
}

/**
 * The head as tags, over the metadata the shell built for itself.
 *
 * A head with no title leaves `fallback` exactly as it was, which is what a
 * route nobody describes gets: same `<title>`, and the root layout's
 * `openGraph` inherited untouched, because a metadata export that omits a
 * field inherits the parent's.
 */
export function pluginRouteMetadataOver(
  fallback: Metadata,
  head: PluginRouteHead | null,
): Metadata {
  const title = head?.title?.trim()
  if (!title) return fallback
  const description = head?.description?.trim()
  const image = head?.image
  return {
    ...fallback,
    title,
    ...(description ? { description } : {}),
    // Restated, not inherited: defining `openGraph` at all replaces the root
    // layout's for this route.
    openGraph: {
      title,
      ...(description ? { description } : {}),
      siteName: PLATFORM_BRAND_NAME,
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      // No image means the large card would render a blank slab; degrade to
      // the small one instead, the same rule the tenant head follows.
      card: image ? 'summary_large_image' : 'summary',
      title,
      ...(description ? { description } : {}),
      // The DESCRIPTOR, not the bare URL (AGL-2417): `twitter:image:alt` is
      // emitted only for the object form, and a bare string is what left the
      // Twitter half of every card undescribed even once the OG half was not.
      ...(image ? { images: [image] } : {}),
    },
  }
}
