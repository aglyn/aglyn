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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * "A record changed": the one signal every server writer of an org record
 * already gives (AGL-3336).
 *
 * The capture doors, the conversion, the merge, an automation's step, the
 * record system's own routes — each of them, after it writes a record under
 * `orgs/{orgId}/{collection}`, restamps the fields that record's list
 * queries (`restampCrmListFieldsAt`). That restamp is the only place all of
 * them pass, so it is where a plugin that needs to act on the record AFTER
 * any write — re-evaluating the sharing rules that match it, say — is told.
 * A listener registered here is the alternative to editing every writer.
 *
 * ## What a listener may do
 *
 * Read the record and write it again, in its own transaction. It must not
 * call back into the restamp, which is what would loop; the restamp
 * notifies after its own write, once. A listener that throws is logged and
 * the next one still runs: the write it is told about already landed.
 */

/**
 * A written record, by its path: the listener opens its own reference, so
 * core names no database SDK.
 */
export interface PluginRecordWrittenEvent {
  /** `orgs/{orgId}/{collection}/{id}`. */
  path: string
  /** The collection's name under the org. */
  collection: string
}

export type PluginRecordWrittenListener = (event: PluginRecordWrittenEvent) => Promise<void>

export const PLUGIN_RECORD_WRITTEN = definePluginServiceContract<PluginRecordWrittenListener>(
  'core.record-written',
  { multiple: true },
)

/**
 * Registers a listener. The owner is the loader's marker when a register fn
 * is running, else `options.pluginId`; registering twice under one key
 * replaces in place.
 */
export function registerPluginRecordWrittenListener(
  listener: PluginRecordWrittenListener,
  options?: { pluginId?: string; key?: string },
): void {
  registerPluginService(PLUGIN_RECORD_WRITTEN, listener, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    ...(options?.key ? { key: options.key } : {}),
  })
}

/** Tells every listener. Never throws. */
export async function notifyPluginRecordWritten(event: PluginRecordWrittenEvent): Promise<void> {
  for (const entry of resolvePluginServices(PLUGIN_RECORD_WRITTEN)) {
    try {
      await entry.impl(event)
    } catch (error) {
      console.error(
        `[record-written] ${entry.pluginId} failed on ${event.path}`,
        error,
      )
    }
  }
}
