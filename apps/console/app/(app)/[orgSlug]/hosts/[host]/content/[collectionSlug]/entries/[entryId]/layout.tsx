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
import { entityPageTitle } from '../../../../../../../../entity-page-title'
import type { ReactNode } from 'react'

// Title-only shell (AGL-1059), and the deepest one on this branch — so this
// title is the one Next resolves for an entry.
//
// `Entry`, not `Content`: the noun says what KIND of page this is, and the
// sibling collection route is already `Content`. Two routes may not share a
// title, and "the blog" and "one post in the blog" are not the same page.
//
// The subject is the entry id. It is ugly and completely sufficient for the
// first paint — four tabs are four different strings, and the id is one the
// user's own URL bar is already showing — and the client swaps it for the
// entry's title in place. `new` is a real subject here too: a draft with no
// document yet reads `new · Entry · {host}`, which is honest.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; entryId: string }>
}): Promise<Metadata> {
  const { host, entryId } = await params
  return {
    title: entityPageTitle({ subject: entryId, noun: 'Entry', scope: host }),
  }
}

export default function HostContentEntryTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
