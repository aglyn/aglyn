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
import { entityPageTitle } from '../../../../../../entity-page-title'
import { segmentTitle } from '../../../../../../page-title'
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout. The suffix comes from the root title template.
//
// The collection NAMES the tab (AGL-2486's rule, reached by AGL-2498's
// routing). The parent `content/layout.tsx` titles every collection
// `Content · {host}`, so four tabs open on four collections of one site read
// identically — the exact defect that rule exists to catch, and one this
// route only became capable of having when the collection moved into the URL.
//
// The subject is the id, not the display name, and deliberately: this runs on
// the SERVER, where the console has no authorization to spend — an anonymous
// GET of a console URL returns the server-rendered `<head>`. See
// `document-subject.ts` for the whole argument. The client upgrades the id to
// the collection's name in place.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; collectionId: string }>
}): Promise<Metadata> {
  const { host, collectionId } = await params
  // The subject wraps INSIDE `segmentTitle`, not around it: this layout has
  // a titled route below it (the entry), so what it declares must stay the
  // `{ default, template }` object — `entityPageTitle` builds the DEFAULT
  // string that object carries. A bare string here strips the brand off every
  // entry page, which is the AGL-1059 regression `page-title.spec.ts` catches.
  return {
    title: segmentTitle(
      entityPageTitle({
        subject: collectionId,
        noun: 'Content',
        scope: host,
      }),
    ),
  }
}

export default function HostContentCollectionTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
