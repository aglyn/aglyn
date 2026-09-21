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
import { entityPageTitle } from '../../../../entity-page-title'
import type { ReactNode } from 'react'

/**
 * Title-only shell (AGL-1059) for a row of a staff page that claims its
 * subtree (AGL-3080): the page is a client component and cannot export
 * `metadata`, so the title lives in the nearest server layout.
 *
 * NAMED BY ITS ROW, not by the queue (AGL-2486). The layout one level up
 * titles every staff page by its id, which on a detail route would put the
 * same string on every row — two reviewers with two submissions open would
 * share one tab title, which is the failure `page-title.spec.ts` exists to
 * catch. The id is the best a SERVER layout can do: resolving it to a
 * display name would take a read of a document the client is already
 * fetching, and the page replaces it with the real name through
 * `PageHeaderRecord` as soon as it lands.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ staffPage: string; staffDetail?: string[] }>
}): Promise<Metadata> {
  const { staffPage, staffDetail } = await params
  const subject = (staffDetail ?? []).join('/')
  return {
    title: entityPageTitle({
      subject: subject || staffPage,
      noun: 'Staff page',
    }),
  }
}

export default function AdminStaffPluginDetailTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
