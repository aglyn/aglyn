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
import { entityPageTitle } from '../../../../entity-page-title'
import { segmentTitle } from '../../../../page-title'

// Title-only shell (AGL-1059, AGL-2486): one dataset's tab of the organization
// Data page (AGL-4047). The page is the client Data page, so its title lives
// here. The subject is the dataset id from the address, which the tab's own
// URL already shows: two tabs open on two datasets read as two strings.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string }>
}): Promise<Metadata> {
  const { orgSlug, id } = await params
  return {
    // `segmentTitle`: a record's page is titled below this one.
    title: segmentTitle(entityPageTitle({ subject: id, noun: 'Dataset', scope: orgSlug })),
  }
}

export default function OrgDatasetTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
