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
import { entityPageTitle } from '../../../../entity-page-title'
import { pluginPageTitle, pluginSectionTitle } from '../../../../plugin-page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; crmSlug?: string[] }>
}): Promise<Metadata> {
  const { orgSlug, crmSlug } = await params
  /*
   * `section · CRM · org` (AGL-2184/AGL-2486), the console's own title
   * vocabulary — the site hub's layout builds the same string with the site
   * as the scope. The surface slug is fixed: this route serves one hub, and
   * the section is the first segment beneath it. A record id in the second
   * segment is dropped, as it is on the site route.
   */
  const [sectionSlug = ''] = crmSlug ?? []
  return {
    title: entityPageTitle({
      subject: pluginSectionTitle('crm', sectionSlug),
      noun: pluginPageTitle('crm'),
      scope: orgSlug,
    }),
  }
}

export default function OrgCrmTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
