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

import type { ReactNode } from 'react'
import OrgGuard from '../../../components/org-guard.component'

/**
 * Org-scoped guard for the full-screen editor routes (AGL-621). The
 * authenticated shell comes from the parent `(editor)` layout; this adds the
 * `/[orgSlug]` membership check so an editor deep link for a foreign org
 * bounces to the jump page instead of rendering.
 */
export default function EditorOrgSlugLayout({
  children,
}: {
  children: ReactNode
}) {
  return <OrgGuard>{children}</OrgGuard>
}
