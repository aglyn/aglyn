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
 * WHERE A PERSON FIRST CAME FROM, told to the record system (AGL-3519).
 *
 * A door that meets somebody — the platform's own account sign-up, a sales
 * sequence enrolling them — knows HOW it met them, and the record system
 * keeps the field a sales team reads that answer from. The door must not
 * write that plugin's records itself, nor import it; so the record system
 * registers a WRITER here, and the door names the person and its own word
 * for how it met them.
 *
 * ## Original source: never overwritten
 *
 * The writer records the origin only on a record that holds none — the
 * first door to meet a person names where they came from, and nothing later
 * moves it. What the word becomes, and whether the workspace still offers
 * it, is the writer's to decide; a word it does not know records nothing.
 *
 * A single-implementation contract: a workspace keeps one record system.
 */

/**
 * A first-party door's word for how it met a person. Open, so a plugin's own
 * door can name itself; the record system ignores a word it has no value for.
 */
export type PluginRecordOrigin =
  | 'form'
  | 'booking'
  | 'newsletter'
  | 'member'
  | 'order'
  | 'account'
  | 'sequence'
  | 'emailCampaign'
  | (string & {})

export interface PluginRecordOriginRequest {
  /** The organization whose records are stamped, when the caller knows it. */
  orgId?: string
  /** The site the door met the person on: whose records, and whose view of them. */
  hostId: string
  email: string
  origin: PluginRecordOrigin
  /**
   * Only a record this door just started — a person met for the first time.
   * A door that touches people already on file (a capture on a known
   * address) asks for this; one acting on a person deliberately (an
   * enrollment) does not.
   */
  firstTouchOnly?: boolean
}

export interface PluginRecordOriginReport {
  /** Records that took the origin. */
  records: number
}

export interface PluginRecordOriginWriter {
  /** Never throws: the door has already done what it records. */
  stamp(request: PluginRecordOriginRequest): Promise<PluginRecordOriginReport>
}

export const PLUGIN_RECORD_ORIGIN = definePluginServiceContract<PluginRecordOriginWriter>(
  'core.record-origin',
  { multiple: false },
)

/**
 * Registers the workspace's record-origin writer. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with
 * neither the registration throws, and a second plugin's writer is refused
 * naming both — the incumbent keeps serving.
 */
export function registerPluginRecordOriginWriter(
  writer: PluginRecordOriginWriter,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_RECORD_ORIGIN, writer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * Records where a person came from through whichever plugin keeps the
 * records, or answers `null` when none does. Never throws: every caller has
 * already met the person, and the origin is bookkeeping beside it.
 */
export async function stampRecordOrigin(
  request: PluginRecordOriginRequest,
): Promise<PluginRecordOriginReport | null> {
  const entry = resolvePluginServices(PLUGIN_RECORD_ORIGIN)[0]
  if (!entry) return null
  try {
    return await entry.impl.stamp(request)
  } catch (error) {
    console.error('[record-origin] the record system could not record where a person came from', error)
    return null
  }
}
