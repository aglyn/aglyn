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
import StaffGuard from '../../../../../../../../components/staff-guard.component'
import { entityPageTitle } from '../../../../../../../entity-page-title'

// Title-only shell (AGL-1059), plus the staff gate: this route sits in the
// full-screen `(editor)` group, outside the `(app)/admin` layout that gates
// every other staff page. The tab names the document — which
// `DocumentPreview` upgrades to its name once it loads — and the site it
// belongs to.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ hostId: string; kind: string; docId: string }>
}): Promise<Metadata> {
  const { hostId, kind, docId } = await params
  return {
    title: entityPageTitle({ subject: docId, noun: `Staff ${kind} preview`, scope: hostId }),
  }
}

export default function AdminSitePreviewLayout({ children }: { children: ReactNode }) {
  return <StaffGuard>{children}</StaffGuard>
}
