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

import type { SiteChatVisitorReader } from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import { readActiveMemberSession } from './membership'

/**
 * Who a site chat visitor is, for its greeting (AGL-4250): a signed-in site
 * member's first name, read from the member's own session the way every
 * member endpoint reads it (a suspended or signed-out member is nobody).
 * The name only: the chat learns nothing else about the account.
 */
export const commerceSiteChatVisitor: SiteChatVisitorReader = {
  async readVisitor({ hostId, cookies }) {
    const session = await readActiveMemberSession({ cookies } as never, hostId)
    if (session.status !== 'active') return null
    const data = (session.member.data() ?? {}) as Record<string, unknown>
    const full = String(data['firstName'] ?? data['name'] ?? data['displayName'] ?? '').trim()
    const first = full.split(/\s+/)[0]?.slice(0, 40) ?? ''
    return first ? { name: first } : null
  },
}
