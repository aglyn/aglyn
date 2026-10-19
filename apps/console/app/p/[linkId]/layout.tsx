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
import { entityPageTitle } from '../../entity-page-title'
import { segmentTitle } from '../../page-title'

/**
 * Title-only shell for a photo link's page (AGL-3957): the page is a client
 * component, so its title lives here.
 *
 * The address is `/p/{linkId}#{secret}`. The secret is in the fragment,
 * which never reaches the server, so the title can only ever name the link
 * by its id. The page is kept out of search indexes and sends no referrer:
 * whoever holds its full address can upload to the site.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ linkId: string }>
}): Promise<Metadata> {
  const { linkId } = await params
  return {
    title: segmentTitle(entityPageTitle({ subject: String(linkId ?? ''), noun: 'Send photos' })),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  }
}

export default function PhotoLinkTitleLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
