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
 * A plugin's share of a PERSON erasure (AGL-2981).
 *
 * The person erasure removes one person from one workspace — a contact the
 * workspace kept, not an account: the contact document, what the CRM files
 * beside it, the leads, list memberships and delivery log under the
 * address, and the person's identity on orders and bookings. A plugin that
 * keeps records about such a person where none of those sweeps reach — a
 * collection under the organization keyed by the contact or by the address
 * — registers an eraser here, and the erasure runs every eraser with the
 * person's address, its key and the contacts it is about to delete.
 *
 * Erasers run AFTER the erasure has closed the door and BEFORE it deletes
 * the contacts: every site's suppression row is already written, so nothing
 * a plugin sends can reach the person while its eraser runs, and the contact
 * documents still exist for an eraser that has to read one.
 *
 * The two halves of the rule that holds everywhere else in the erasure hold
 * here too. A record ABOUT the person goes. A record that the person asked
 * not to be contacted — keyed by `personKey`, the hash every suppression
 * list is keyed by, and holding no address — is KEPT, because the promise
 * it records has to outlive the person's data; an eraser strips from it
 * anything that could identify the person again.
 *
 * Erasers run in registration order and are ISOLATED: a throw is logged
 * against its plugin, recorded as `null`, and does not stop the next one or
 * the erasure. The `null` is how the erasure's audit record says that
 * plugin's share may remain, which a report of zero would hide.
 *
 * A DRY RUN is handed to every eraser, which must then write nothing: it
 * counts what it would do.
 *
 * Registered from a plugin's declarations — `serverDeclarations`, or
 * `consoleServerDeclarations` for a plugin whose server code runs only in
 * the console — so the eraser is in place in a process that never loaded
 * the plugin's API surface.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** Who is being erased, and from which workspace. */
export interface PluginPersonErasureRequest {
  /** The workspace the person is erased from. */
  orgId: string
  /** The person's address, normalized. */
  email: string
  /**
   * `personKey(email)`: how every suppression list, and any list a plugin
   * keeps in the same way, names the person without their address.
   */
  key: string
  /** The contact documents the erasure is about to delete, by id. */
  contactIds: readonly string[]
  /** A plan, not an erasure: count, write nothing. */
  dryRun: boolean
}

/**
 * What an eraser reports for the erasure's audit record: counts and flags,
 * never the erased content. A `null` field is a figure the eraser could not
 * measure, which is not zero.
 */
export type PluginPersonErasureReport = Readonly<Record<string, number | boolean | null>>

export type PluginPersonEraser = (
  request: PluginPersonErasureRequest,
) => Promise<PluginPersonErasureReport>

interface Registration {
  pluginId: string
  eraser: PluginPersonEraser
}

const registrations: Registration[] = []

/**
 * Registers a plugin's person eraser. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`; an eraser with neither throws. One
 * eraser per plugin: registering again replaces the plugin's earlier eraser
 * in place, so a module evaluated twice does not erase twice.
 */
export function registerPluginPersonEraser(
  eraser: PluginPersonEraser,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin person eraser was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, eraser }
  else registrations.push({ pluginId, eraser })
}

/**
 * Runs every eraser, in registration order, and answers each plugin's
 * report by plugin id: the eraser's own report, or `null` for one that
 * threw. Never throws.
 */
export async function runPluginPersonErasers(
  request: PluginPersonErasureRequest,
): Promise<Record<string, PluginPersonErasureReport | null>> {
  const reports: Record<string, PluginPersonErasureReport | null> = {}
  for (const { pluginId, eraser } of [...registrations]) {
    try {
      reports[pluginId] = await eraser({
        orgId: request.orgId,
        email: request.email,
        key: request.key,
        contactIds: [...request.contactIds],
        dryRun: request.dryRun,
      })
    } catch (error) {
      reports[pluginId] = null
      // The org, never the address: this line outlives the erasure.
      console.error(`[plugins] ${pluginId} failed to erase a person in org ${request.orgId}`, error)
    }
  }
  return reports
}

/** The plugins with a person eraser, in the order they run. */
export function listPluginPersonErasers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam: forget every eraser. */
export function resetPluginPersonErasersForTests(): void {
  registrations.length = 0
}
