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
 * A bulk send's own figures, moved by a door that is not its sender
 * (AGL-3080).
 *
 * A message a bulk send carried names the send — its id is signed into the
 * unsubscribe link and tagged on the message — and the plugin that serves
 * the site's unsubscribe page learns that a recipient left. That plugin is
 * not the sender: the send, and the figures its report reads, are the
 * plugin's that sent it. So the door reports what happened and the sender
 * counts it, without either importing the other.
 *
 * A MULTIPLE contract: several plugins may send in bulk, and the door does
 * not know which one a send id is. Each tally answers whether the send was
 * its own and counted; the first that answers yes ends the ask.
 *
 * ## The caller proves what happened
 *
 * The registry authenticates nobody. A door counts only what it has already
 * written: an unsubscribe is counted once, when its suppression was created,
 * never on a second click of the same link.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

/** A send, as a link or a message tag names it. */
export interface PluginSendTallyRequest {
  /** The site whose mail it was. */
  hostId: string
  /** The send's id, as signed into the link. */
  sendId: string
}

export interface PluginSendTally {
  /**
   * One more recipient left from this send's mail. Answers whether the send
   * is this plugin's and was counted; a send it does not keep is `false`.
   */
  unsubscribed(request: PluginSendTallyRequest): Promise<boolean>
}

export const PLUGIN_SEND_TALLIES = definePluginServiceContract<PluginSendTally>(
  'core.send-tallies',
  { multiple: true },
)

/**
 * Registers a sender's tally. The owner is the loader's marker when a
 * register fn is running, else `options.pluginId`; registering again under
 * the same plugin replaces in place.
 */
export function registerPluginSendTally(
  tally: PluginSendTally,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_SEND_TALLIES, tally, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * Tells the sender of a send that a recipient left. Never throws: the door's
 * own write — the suppression — has landed, and a figure must never be able
 * to cost it. Answers whether any sender counted it.
 */
export async function tallySendUnsubscribe(request: PluginSendTallyRequest): Promise<boolean> {
  for (const entry of resolvePluginServices(PLUGIN_SEND_TALLIES)) {
    try {
      if (await entry.impl.unsubscribed(request)) return true
    } catch (error) {
      console.error(`[send-tallies] ${entry.pluginId} failed on ${request.hostId}`, error)
    }
  }
  return false
}
