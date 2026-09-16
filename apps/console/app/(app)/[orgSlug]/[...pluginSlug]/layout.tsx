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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { entityPageTitle } from '../../../entity-page-title'
import { pluginPageTitle, pluginSectionTitle } from '../../../plugin-page-title'

// Title-only shell (AGL-1059): the page is a client component and cannot
// export `metadata`, so its title lives in the nearest server layout.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; pluginSlug: string[] }>
}): Promise<Metadata> {
  const { orgSlug, pluginSlug } = await params
  /*
   * `section · surface · org` (AGL-2184/AGL-2486), built exactly as the site
   * plugin route builds it with the site as the scope: the surface is the
   * first segment, and the second is titled only when the local section table
   * declares it (AGL-2974), so an entity id is never Title Cased onto a tab.
   */
  const [surfaceSlug = '', sectionSlug = ''] = pluginSlug ?? []
  return {
    title: entityPageTitle({
      subject: pluginSectionTitle(surfaceSlug, sectionSlug),
      noun: pluginPageTitle(surfaceSlug),
      scope: orgSlug,
    }),
  }
}

export default function OrgPluginTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
