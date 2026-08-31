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

import { entityPageTitle } from '../../../../../entity-page-title'
import {
  pluginPageTitle,
  pluginSectionTitle,
} from '../../../../../plugin-page-title'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; pluginSlug: string[] }>
}): Promise<Metadata> {
  const { host, pluginSlug } = await params
  /*
   * The SURFACE and the SECTION. The route is a catch-all, so `pluginSlug` is
   * every segment beneath the site — `['products', 'orders']` on a section
   * URL. A title built from the surface alone is the same string for every
   * section of a hub, so `/marketing/campaigns` and `/marketing/experiments`
   * put two identical tabs in the strip a reader is picking between, which is
   * the one job a tab title has.
   *
   * The second segment is a section only on a hub; on a surface that owns its
   * subtree it is a document id. `pluginSectionTitle` answers `''` for
   * anything it does not recognize as a declared section, and an empty part
   * is dropped rather than separated — so an entity route keeps the title it
   * has rather than gaining a mangled id.
   */
  const [surfaceSlug = '', sectionSlug = ''] = pluginSlug ?? []
  /*
   * `subject · noun · scope` (AGL-2184/AGL-2486), the console's own title
   * vocabulary: most specific first, because a browser tab is about twenty
   * characters wide and truncates from the right.
   *
   * Both names are the DISPLAYED ones rather than the URL slugs — the tab
   * reads `Products`, not `products`, and the page renders the same string
   * from `navItem.header?.title ?? navItem.label`.
   *
   * Neither depends on whether this org has the plugin enabled. Naming a page
   * is not a permission decision, and the page below gates itself.
   */
  return {
    title: entityPageTitle({
      subject: pluginSectionTitle(surfaceSlug, sectionSlug),
      noun: pluginPageTitle(surfaceSlug),
      scope: host,
    }),
  }
}

export default function HostPluginTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
