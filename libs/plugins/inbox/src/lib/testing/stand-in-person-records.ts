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

import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginPersonRecords,
  type PluginPersonFindRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'

/**
 * A plugin that keeps people, standing in for the one that does (AGL-3080).
 *
 * The Inbox asks for the person behind an address through
 * `plugin-person-records` and imports no record system, so its specs stand an
 * owner up the way the loader would. One plugin may not import another, which
 * is why this is here rather than borrowed from the CRM.
 *
 * It finds a person in the spec's own store, by the address or by an
 * alternate one a merge folded in, narrowed to the site when asked — what the
 * owner answers, imitated over the spec's double. That the real owner answers
 * the same is held by the CRM's own `person-records.spec.ts`.
 */
export function standInPersonRecords(options: {
  /** The spec's documents, by path. */
  store: () => Readonly<Record<string, Record<string, unknown> | undefined>>
  orgId: string
}): PluginPersonFindRequest[] {
  const asked: PluginPersonFindRequest[] = []
  const prefix = `orgs/${options.orgId}/contacts/`
  registerPluginPersonRecords(
    {
      async find(request) {
        asked.push(request)
        const email = String(request.email ?? '').trim().toLowerCase()
        if (!email.includes('@')) return null
        for (const [path, data] of Object.entries(options.store())) {
          if (!data || !path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue
          const alternates = Array.isArray(data['alternateEmails']) ? data['alternateEmails'] : []
          if (data['email'] !== email && !alternates.includes(email)) continue
          // One address names one person: a record the site may not see is
          // nobody, not a reason to look further.
          if (
            request.onlyVisibleToSite &&
            request.hostId &&
            !visibleToHost(data['visibleTo'] as string[] | undefined, request.hostId)
          ) {
            return null
          }
          return { kind: 'contact', id: path.slice(prefix.length), email: String(data['email'] ?? ''), data }
        }
        return null
      },
      async read(request) {
        return request.records.map(() => null)
      },
    },
    { pluginId: 'record-system' },
  )
  return asked
}
