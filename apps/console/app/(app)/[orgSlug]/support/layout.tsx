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

import { segmentTitle } from '../../../page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout.
//
// `segmentTitle`, not a bare string: AGL-1158 put titled routes below this one
// (`tickets/`, `forum/`). A plain string title carries no template of its own,
// so it would consume the ancestor template and strip the brand suffix from
// every route nested beneath it.
export const metadata: Metadata = { title: segmentTitle('Support') }

export default function OrgSupportTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
