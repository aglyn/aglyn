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
import { entityPageTitle } from '../../../../../../../../../entity-page-title'

// Title-only shell. This route had NO metadata export of ANY kind until
// AGL-2486, so it inherited `Besigner · {host}` from the host layout six
// segments up — the same string the besigner tab beside it showed, on a
// different document. Three preview routes did this, which is why the tab
// strip could not distinguish a preview from the editor that opened it.
//
// The existing "every route has a title" guard could not see it: an ancestor
// title counts as a title, and one did exist. Only the entity check added in
// `page-title.spec.ts` for this issue reaches it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; componentId: string }>
}): Promise<Metadata> {
  const { host, componentId } = await params
  return {
    title: entityPageTitle({ subject: componentId, noun: 'Component preview', scope: host }),
  }
}

export default function ComponentPreviewTitleLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
