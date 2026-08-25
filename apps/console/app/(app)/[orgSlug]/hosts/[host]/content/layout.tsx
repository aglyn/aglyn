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
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout.
//
// `segmentTitle`, not a bare string, since AGL-2498 put titled routes BELOW
// this one (`content/{collectionId}` and its entry). A segment that sets a
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

export default function HostContentTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
