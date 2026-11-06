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

import { useContext } from 'react'
import { pluginConnectionRecordFor, type PluginConnectionSiteRecord } from './plugin-connection-records'
import { PluginConnectionRecordsContext } from './plugin-connection-records-context'
import { RealmElementNodeContext } from './realm-elements-context'

export type {
  PluginConnectionRecordValue,
  PluginConnectionSiteRecord,
} from './plugin-connection-records'

/**
 * THE CONNECTION RECORD A SIGNED PLUGIN'S SITE ELEMENT READS (AGL-4195).
 *
 * On the realm host surface: a bundle reads it as `aglyn.usePluginConnectionRecord`.
 *
 * ```js
 * const record = usePluginConnectionRecord('reviews')
 * if (!record) return null // not connected yet, or not synced: render nothing
 * return h('p', null, `${record.fields.rating} from ${record.fields.reviewCount} reviews`)
 * ```
 *
 * `connectionId` is a connection the plugin's OWN manifest declares; the
 * listing is never an argument. It is the listing whose namespace the asking
 * element is in, which the renderer knows and the bundle cannot change, so an
 * element can only ever read its own plugin's record.
 *
 * On a published page the record arrives with the page, server-rendered, and
 * this hook only looks it up: no fetch, no effect, the same answer on the
 * server and in the browser. `null` when the site has not connected or no sync
 * has finished, when the workspace's plan does not include connections, and on
 * every surface that hands no records (the editor, Preview). The element
 * decides what `null` looks like; rendering nothing is the usual answer.
 */
export function usePluginConnectionRecord(connectionId: string): PluginConnectionSiteRecord | null {
  const nodeId = useContext(RealmElementNodeContext)
  const records = useContext(PluginConnectionRecordsContext)
  return pluginConnectionRecordFor(records, nodeId, connectionId)
}
