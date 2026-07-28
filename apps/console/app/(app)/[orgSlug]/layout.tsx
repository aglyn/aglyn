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
import { segmentTitle } from '../../page-title'
import OrgGuard from '../../../components/org-guard.component'

// Fallback title for the org area (AGL-1059) — the slug is the only org
// identity available without a read, and every real page below overrides it
// with its own segment.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}): Promise<Metadata> {
  const { orgSlug } = await params
  return { title: segmentTitle(orgSlug) }
}

/**
 * Org-scoped shell (AGL-621): everything under `/[orgSlug]` is gated on the
 * signed-in user belonging to that org. The authenticated + main chrome is
 * provided by the parent `(app)` layout; this only adds the membership guard.
 */
export default function OrgSlugLayout({ children }: { children: ReactNode }) {
  return <OrgGuard>{children}</OrgGuard>
}
