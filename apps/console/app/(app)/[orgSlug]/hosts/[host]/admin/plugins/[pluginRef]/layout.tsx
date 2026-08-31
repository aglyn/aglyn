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
import { entityPageTitle } from '../../../../../../../entity-page-title'

/*
 * Title-only shell (AGL-1059): the page is a client component, and a client
 * component cannot export `metadata` — so its title lives here, in the
 * nearest server layout.
 *
 * The detail page sits OUTSIDE the admin `(sections)` group deliberately. The
 * sections layout is a hub — one header, one tab rail, one page per tab — and
 * a plugin's own page is not a tab: it owns its header and its breadcrumb
 * trail, exactly as the workspace-scoped `/[orgSlug]/plugins/[pluginRef]`
 * does. Nesting it inside the hub would have shown "Site Admin" above a page
 * about Bookings.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; pluginRef: string }>
}): Promise<Metadata> {
  const { host, pluginRef } = await params
  // Scoped to the SITE, which is what separates this page from the
  // workspace-scoped `/[orgSlug]/plugins/[pluginRef]`. Both are about the
  // same plugin, and without the site both name it identically — two tabs
  // reading the same string for two pages that do different things.
  return {
    title: entityPageTitle({ subject: pluginRef, noun: 'Plugin', scope: host }),
  }
}

export default function SitePluginTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
