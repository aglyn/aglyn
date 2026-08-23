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

import { getSystemEmailTemplate } from '@aglyn/shared-util-email'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { entityPageTitle } from '../../../../../../../entity-page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
//
// Named from the STATIC platform catalog (AGL-2486), for the same reason the
// tenant email besigner is: `getSystemEmailTemplate` is an array lookup over
// product data, so the real name is free on the server and no client upgrade
// is needed. Staff had every system email sharing one tab — worse than the
// tenant case, because staff routinely open several at once to compare copy.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateKey: string }>
}): Promise<Metadata> {
  const { templateKey } = await params
  return {
    title: entityPageTitle({
      subject: getSystemEmailTemplate(templateKey)?.name || templateKey,
      noun: 'Staff email besigner',
    }),
  }
}

export default function AdminEmailBesignerTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
