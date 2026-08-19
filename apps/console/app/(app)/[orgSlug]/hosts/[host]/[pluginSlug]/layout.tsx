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

import { pluginPageTitle } from '../../../../../plugin-page-title'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; pluginSlug: string }>
}): Promise<Metadata> {
  const { host, pluginSlug } = await params
  /*
   * The DISPLAYED name, not the URL slug (AGL-2184). This returned
   * `${pluginSlug} · ${host}` — the raw lowercase segment — so every plugin
   * page's browser tab read `products · aglyn-marketing` while the page
   * itself rendered `Products`. The page has always had the right string
   * (`navItem.header?.title ?? navItem.label`); the tab was reading the URL.
   *
   * A title also must not depend on whether this org has the plugin enabled —
   * naming the page is not a permission decision, and the page below already
   * gates itself.
   */
  return { title: `${pluginPageTitle(pluginSlug)} · ${host}` }
}

export default function HostPluginTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
