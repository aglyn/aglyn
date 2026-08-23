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

import { getTenantEmail } from '@aglyn/shared-util-email'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { entityPageTitle } from '../../../../../../../../../entity-page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
//
// The one route in the AGL-2486 sweep whose title names the entity properly
// ON THE SERVER, with no client upgrade and no id fallback: an email template
// is identified by `templateKey`, and the key's human name comes from the
// STATIC catalog — `getTenantEmail` is an array lookup over product data
// compiled into the bundle, not a read of anything this org owns. So there is
// no document to authorize and nothing a stranger could learn from the title
// that `TENANT_EMAILS` does not already tell every reader of the source.
//
// Unknown keys fall back to the key itself rather than dropping the subject:
// a URL naming a template we do not ship is still a distinct tab, and a
// silently container-only title is the bug this issue is about.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; templateKey: string }>
}): Promise<Metadata> {
  const { host, templateKey } = await params
  return {
    title: entityPageTitle({
      subject: getTenantEmail(templateKey)?.name || templateKey,
      noun: 'Email besigner',
      scope: host,
    }),
  }
}

export default function EmailBesignerTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
