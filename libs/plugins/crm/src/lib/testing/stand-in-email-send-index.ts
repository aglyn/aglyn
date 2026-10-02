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

import { registerPluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * The `emailSend` record index the plugin that sends campaigns publishes
 * (AGL-3080), stood in for this plugin's specs — this plugin may not load
 * the marketing plugin. A send is named as that plugin's index names it: the
 * name the team gave it, else its subject, and an unnamed send is left out.
 * `read` answers the stored send the spec holds for an org and an id; what
 * the marketing plugin itself answers is held in its own spec.
 */
export function standInEmailSendIndex(
  read: (orgId: string, sendId: string) => Readonly<Record<string, unknown>> | undefined,
): void {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  registerPluginRecordIndex(
    'emailSend',
    {
      async list() {
        return { records: [], truncated: false }
      },
      async get({ orgId, id }) {
        const data = orgId ? read(orgId, id) : undefined
        const name = data ? text(data['displayName']) || text(data['subject']) : ''
        return name ? { id, name, facts: { hostId: text(data?.['hostId']) } } : null
      },
    },
    { pluginId: 'marketing' },
  )
}
