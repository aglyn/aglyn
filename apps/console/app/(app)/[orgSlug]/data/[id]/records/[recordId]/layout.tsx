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
import { entityPageTitle } from '../../../../../../entity-page-title'

// Title-only shell (AGL-1059, AGL-2486), and the deepest one on this branch:
// one record's own page beneath its dataset's tab (AGL-4047). The subject is
// the record id, then the dataset id, both from the address, so two tabs open
// on two records read as two strings.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string; recordId: string }>
}): Promise<Metadata> {
  const { orgSlug, id, recordId } = await params
  return {
    title: entityPageTitle({
      subject: `${recordId} · ${id}`,
      noun: 'Record',
      scope: orgSlug,
    }),
  }
}

export default function OrgDatasetRecordTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
