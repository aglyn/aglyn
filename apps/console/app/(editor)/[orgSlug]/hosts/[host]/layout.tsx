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
import HostGuard from '../../../../../components/host-guard.component'

/**
 * Host shell for the full-screen editor routes (AGL-622): resolves the
 * `[host]` subdomain to a doc id (spinner while pending) and 404s an unknown
 * subdomain, inside the route tree so the not-found boundary catches it.
 */
export default function EditorHostLayout({
  children,
}: {
  children: ReactNode
}) {
  return <HostGuard>{children}</HostGuard>
}
