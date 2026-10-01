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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import {
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * One overlay as another plugin's picker names it: its own name, else the
 * bar's text or the popup's headline, else its id. A retired overlay
 * (`deletedAt`) is left out.
 */
export function overlayIndexedRecord(
  id: string,
  data: Readonly<Record<string, unknown>>,
): PluginIndexedRecord | null {
  if (!id || !data || data['deletedAt'] != null) return null
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const bar = (data['bar'] ?? {}) as Record<string, unknown>
  const popup = (data['popup'] ?? {}) as Record<string, unknown>
  return {
    id,
    name: text(data['name']) || text(bar['text']) || text(popup['headline']) || id,
    facts: {},
  }
}

/**
 * A site's announcement bars and popups, listed in the console for another
 * plugin's picker (AGL-3080) — an automation's "Show overlay" step choosing
 * the one it opens. A site's own kind: asked with no site, it lists none.
 * Ordered by document id, so the window is the same one every time.
 */
export const overlayRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.hostId) return null
    return query(
      collection(firestore, 'hosts', request.hostId, 'overlays'),
      orderBy(documentId()),
      limit(request.limit),
    )
  },
  record: overlayIndexedRecord,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerMarketingRecordLists(): void {
  registerPluginRecordListSource('overlay', overlayRecordListSource, { pluginId: BUNDLE_ID })
}
