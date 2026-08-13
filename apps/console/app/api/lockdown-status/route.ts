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

/**
 * The PLATFORM lockdown notice, sanitized, for anyone (AGL-1501).
 *
 * Deliberately unauthenticated: the whole point of the notice is that it is
 * reachable by exactly the people whose sessions were just revoked — a
 * notice behind auth would redirect-loop the people it exists for. And
 * deliberately platform-scope only: org/host/user lockdown details reach
 * their subjects through the authenticated surfaces (the 423 bodies, the
 * console banner); serving them here would let anyone enumerate which
 * accounts are locked. The body carries only what the notice shows —
 * reason, title, copy, contact, window — never the actor or any target id.
 */

import { lockdownNotice, lockdownRetryAfterSeconds } from '@aglyn/aglyn/server'
import { getPlatformLockdown } from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const state = await getPlatformLockdown()
  if (!state) {
    return Response.json(
      { locked: false },
      // Cacheable for a minute at the edge: this is the hot "everything is
      // fine" answer every console load asks for. The locked answer below
      // is no-store — flipping the switch must not fight a cached "fine".
      { status: 200, headers: { 'Cache-Control': 'public, max-age=60' } },
    )
  }
  const notice = lockdownNotice(state)
  const retryAfter = lockdownRetryAfterSeconds(state, Date.now())
  return Response.json(
    {
      locked: true,
      reason: state.reason,
      title: notice.title,
      message: notice.body,
      ...(notice.contact ? { contact: notice.contact } : {}),
      ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    },
  )
}
