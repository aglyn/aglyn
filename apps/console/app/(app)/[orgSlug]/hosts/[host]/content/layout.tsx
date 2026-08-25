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
import { segmentTitle } from '../../../../../page-title'
import { ContentScopeProvider } from '../../../../../../components/content/content-scope.context'
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout.
//
// `segmentTitle`, not a bare string, since AGL-2498 put titled routes BELOW
// this one (`content/{collectionSlug}` and its entry). A segment that sets a
// plain string carries no template of its own, so it CONSUMES the root
// template and everything beneath renders unbranded — "dR3GYhkZS1 · Entry ·
// aglyn-marketing" with no "· Aglyn" on the end. The bare path keeps this
// exact default; only the object around it is new.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>
}): Promise<Metadata> {
  const { host } = await params
  return { title: segmentTitle(`Content · ${host}`) }
}

/**
 * The shared scope for every content route (AGL-2498).
 *
 * A SERVER layout rendering a CLIENT provider: `generateMetadata` above and
 * `'use client'` cannot live in one file, and both are needed here.
 *
 * Mounting the provider at this level is what let the collection list and the
 * entry detail become separate page components without the data layer becoming
 * two. A layout persists across its children in the App Router, so opening an
 * entry unmounts the list and mounts the detail while the collections listener,
 * the entries listener, the categories, the authors and the screens all stay
 * exactly where they were.
 */
export default function HostContentTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <ContentScopeProvider>{children}</ContentScopeProvider>
}
