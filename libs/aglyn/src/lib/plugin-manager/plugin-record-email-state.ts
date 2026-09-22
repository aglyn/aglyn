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

import type { EmailState } from '../app-utils/email-state'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * The verdict on an address, written onto the records that carry it
 * (AGL-3245).
 *
 * The senders keep their lists — the platform's suppression list, a site's
 * suppressions, an organization's do-not-contact list — and those are what
 * a send consults. The record a person reads is the record system's: a
 * lead, a contact, whatever the plugin that keeps the workspace's records
 * calls them. A sender must not write that plugin's documents itself, nor
 * import it; so the record system registers a WRITER here, and a sender
 * that filed a verdict on a list says so through it.
 *
 * The writer finds every record the address is — the plugin knows its own
 * storage and its own index — and stamps `emailState` on each, keeping the
 * stronger verdict (`nextEmailState`). A single-implementation contract: a
 * workspace keeps one record system.
 *
 * ## The caller proves who is asking
 *
 * Like the timeline seam, the registry authenticates nobody. The caller
 * decides, in its own terms and before it asks, that the verdict is the
 * workspace's to write: an address it sent to, a list it wrote.
 */

export interface PluginRecordEmailStateRequest {
  /** The organization whose records are stamped. */
  orgId?: string
  /**
   * Or the site the send left from, when the caller knows only that — a
   * campaign webhook, an unsubscribe link. The writer reads the
   * organization off it.
   */
  hostId?: string
  email: string
  state: EmailState
  /** Write the state whatever the record holds — a release. */
  force?: boolean
}

export interface PluginRecordEmailStateReport {
  /** Records whose state moved. */
  records: number
}

export interface PluginRecordEmailStateWriter {
  /** Never throws: a list is the control, the stamp is what a person reads. */
  stamp(request: PluginRecordEmailStateRequest): Promise<PluginRecordEmailStateReport>
}

export const PLUGIN_RECORD_EMAIL_STATE = definePluginServiceContract<PluginRecordEmailStateWriter>(
  'core.record-email-state',
  { multiple: false },
)

/**
 * Registers the workspace's record email-state writer. The owner is the
 * loader's marker when a register fn is running, else `options.pluginId`;
 * with neither the registration throws, and a second plugin's writer is
 * refused naming both — the incumbent keeps serving.
 */
export function registerPluginRecordEmailStateWriter(
  writer: PluginRecordEmailStateWriter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_RECORD_EMAIL_STATE, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

export interface ResolvedPluginRecordEmailStateWriter {
  /** The plugin that keeps the records. */
  pluginId: string
  writer: PluginRecordEmailStateWriter
}

/** The writer, with its owner, or `null` when no plugin keeps records here. */
export function pluginRecordEmailStateWriter(): ResolvedPluginRecordEmailStateWriter | null {
  const entry = resolvePluginServices(PLUGIN_RECORD_EMAIL_STATE)[0]
  return entry ? { pluginId: entry.pluginId, writer: entry.impl } : null
}

/**
 * Stamps the verdict through whichever plugin keeps the records, or answers
 * `null` when none does. Never throws: every caller is a sender for whom
 * the stamp is a courtesy beside the list it already wrote.
 */
export async function stampRecordEmailState(
  request: PluginRecordEmailStateRequest,
): Promise<PluginRecordEmailStateReport | null> {
  const resolved = pluginRecordEmailStateWriter()
  if (!resolved) return null
  try {
    return await resolved.writer.stamp(request)
  } catch (error) {
    console.error('[record-email-state] the record system could not stamp the address', error)
    return null
  }
}
