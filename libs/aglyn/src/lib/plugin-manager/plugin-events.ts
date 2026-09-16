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
 * Platform events a plugin listens to (AGL-2939, AGL-2940).
 *
 * Core raises a small number of facts about the workspace that a plugin
 * may care about — a seat add-on was bought or dropped, a permission key
 * moved on a member, a role or a site — and a plugin subscribes from its
 * declarations rather than core calling the plugin's own writer. The
 * billing-webhook hooks are the precedent for one vendor's events; this is
 * the same shape for the platform's own.
 *
 * Handlers run sequentially and are ISOLATED: a plugin that throws is
 * logged and the next one runs, because these are consequences of a write
 * that has already happened — an activity row, a notification — and a
 * failure in one must not undo or hide the write for the customer.
 */

import type { OrgSeatAddons } from '../foundation'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** Who did it, as the activity logs record an actor. */
export interface PluginEventActor {
  uid: string | null
  email: string | null
}

/** The payload each platform event carries. */
export interface PluginEventPayloads {
  /** An org's purchased seat add-ons were written (a purchase, a removal, a webhook mirror). */
  'org.seatAddons.changed': {
    orgId: string
    actor: PluginEventActor
    before: OrgSeatAddons | null | undefined
    after: OrgSeatAddons | null | undefined
  }
  /** One permission key moved on a subject of the org. */
  'org.permissions.changed': {
    orgId: string
    actor: PluginEventActor
    subject: {
      type: 'org' | 'role' | 'member' | 'host'
      id?: string | null
      name?: string | null
    }
    permission: string
    granted: boolean
  }
}

export type PluginEventName = keyof PluginEventPayloads

export type PluginEventHandler<E extends PluginEventName> = (
  payload: PluginEventPayloads[E],
) => void | Promise<void>

interface Registration {
  pluginId: string
  handler: PluginEventHandler<PluginEventName>
}

const handlers = new Map<PluginEventName, Registration[]>()

/**
 * Subscribes to an event. Owner = the loader's marker inside a register fn,
 * else `options.pluginId`; a subscription with neither throws. A plugin
 * re-subscribing replaces its earlier handler for that event, so a module
 * evaluated twice does not write two rows.
 */
export function registerPluginEventHandler<E extends PluginEventName>(
  event: E,
  handler: PluginEventHandler<E>,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `plugin event "${event}" subscribed with no owner: pass { pluginId } ` +
        'when subscribing outside a plugin register fn',
    )
  }
  const list = (handlers.get(event) ?? []).filter((entry) => entry.pluginId !== pluginId)
  list.push({ pluginId, handler: handler as PluginEventHandler<PluginEventName> })
  handlers.set(event, list)
}

/**
 * Raises an event. Every handler runs, in subscription order; a throw is
 * logged with the plugin's id and does not stop the others.
 */
export async function runPluginEventHandlers<E extends PluginEventName>(
  event: E,
  payload: PluginEventPayloads[E],
): Promise<{ handled: number; failed: string[] }> {
  let handled = 0
  const failed: string[] = []
  for (const { pluginId, handler } of handlers.get(event) ?? []) {
    try {
      await handler(payload)
      handled += 1
    } catch (error) {
      failed.push(pluginId)
      console.error(`[plugins] ${pluginId} failed on event ${event}`, error)
    }
  }
  return { handled, failed }
}

/** The plugins subscribed to an event, for diagnostics. */
export function listPluginEventHandlers(event: PluginEventName): string[] {
  return (handlers.get(event) ?? []).map((entry) => entry.pluginId)
}

/** Test seam: forget every subscription. */
export function resetPluginEventHandlersForTests(): void {
  handlers.clear()
}
