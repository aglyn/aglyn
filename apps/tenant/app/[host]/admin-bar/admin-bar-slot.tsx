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

import { isReleaseFlagOn } from '@aglyn/aglyn/server'
import { getServerReleaseFlagValues } from '@aglyn/tenant-data-admin'
import { getHostCached } from '../host-data'
import AdminBarStub from './admin-bar-stub'

const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

/**
 * Server-side mount point for the tenant admin bar (admin edit bar,
 * AGL-1302 follow-on), rendered from the `[host]` layout.
 *
 * Gated on `release_edit_bar` HERE, on the server: with the flag off (the
 * default — it ships dark) nothing reaches the client at all, not even the
 * stub. Costs the render nothing it wasn't already paying — `getHostCached`
 * is the same request-deduped read the layout theming does, and the flag
 * values are a 60s-TTL module cache. Both are baked into the ISR page, so a
 * flag flip propagates within a revalidation, same as any content change.
 *
 * Fails silent by design: an error resolving the flag or the host must
 * never take down a published page for a convenience surface.
 */
export default async function AdminBarSlot({ host }: { host: string }) {
  try {
    const hostRes = await getHostCached(host)
    const hostDoc = hostRes.host as
      | { $id?: string; orgId?: string }
      | undefined
    if (!hostDoc?.$id) return null
    const flags = await getServerReleaseFlagValues()
    if (
      !isReleaseFlagOn(
        'release_edit_bar',
        flags.release_edit_bar,
        hostDoc.orgId ?? null,
      )
    ) {
      return null
    }
    return <AdminBarStub hostId={hostDoc.$id} consoleOrigin={CONSOLE_ORIGIN} />
  } catch {
    return null
  }
}
