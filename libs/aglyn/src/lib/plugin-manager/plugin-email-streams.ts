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
 * A site's email streams, reopened for a signed-in person (AGL-3305).
 *
 * A site keeps what a recipient left in two places: its suppression list for
 * "everything", and a per-stream opt-out for one topic. Both are written from
 * the site's own pages by whoever holds a link signed for the address, over
 * the topic catalog the plugin that keeps email preferences owns.
 *
 * The console has a second door onto ONE of those streams: the account's
 * answer about product updates, which stands for a topic on the operator's
 * marketing site. When that answer turns back to yes the stream has to
 * reopen — and reopening it for somebody who left everything needs the
 * catalog, because they asked for product updates, not for the newsletter
 * and the promotions they also left. Core does not read another plugin's
 * storage, so it asks through this slot.
 *
 * One implementation, from the plugin that keeps the site's email
 * preferences, registered from its `consoleServerDeclarations`: the only
 * caller is a console route, and the tenant has no reason to hold it.
 *
 * ## The caller proves who is asking
 *
 * Like every seam here, the slot authenticates nobody. Reopening a stream
 * undoes something a recipient did from their mailbox, so the caller asks
 * only for the address of a signed-in account whose email is VERIFIED — the
 * same proof of mailbox the signed link carried. An unverified account could
 * otherwise type a stranger's address and reverse the stranger's unsubscribe.
 */

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/** Which stream, for whom, on which site. */
export interface PluginEmailStreamRejoinRequest {
  /** The site whose lists change. */
  hostId: string
  /** The address, as a verified account carries it. */
  email: string
  /** The one stream to reopen. */
  topicId: string
}

/** What reopening did. */
export type PluginEmailStreamRejoinResult =
  /**
   * The address may be mailed about the stream again. When it had left
   * everything, `keptLeft` streams became opt-outs before the suppression
   * was lifted, so they stay left.
   */
  | { status: 'rejoined'; releasedSuppression: boolean; keptLeft: number }
  /**
   * A record the person may not lift from here — a bounce, a complaint, an
   * erasure, a staff hold — so nothing changed.
   */
  | { status: 'held'; reason: string }

export interface PluginEmailStreams {
  /**
   * Reopen one stream: lift its opt-out, and turn a whole-site unsubscribe
   * into opt-outs of every OTHER stream before lifting it. Idempotent.
   */
  rejoin(request: PluginEmailStreamRejoinRequest): Promise<PluginEmailStreamRejoinResult>
}

export const PLUGIN_EMAIL_STREAMS = definePluginServiceContract<PluginEmailStreams>(
  'core.email-streams',
  { multiple: false },
)

/**
 * Fills the slot. The owner is the loader's marker when a register fn is
 * running, else `options.pluginId`; with neither the registration throws, and
 * a second plugin's implementation is refused naming both.
 */
export function registerPluginEmailStreams(
  impl: PluginEmailStreams,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_EMAIL_STREAMS, impl, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** What a caller learns: the plugin's answer, or why there was none. */
export type EmailStreamRejoinOutcome =
  | PluginEmailStreamRejoinResult
  /** No plugin keeps email preferences in this process. */
  | { status: 'unavailable' }
  /** The plugin threw. Logged; the caller's own write stands. */
  | { status: 'failed' }

/**
 * Reopens the stream through whichever plugin keeps email preferences. Never
 * throws: every caller has already recorded the person's answer, and a
 * stream that could not reopen is a thing to report, not a reason to lose it.
 */
export async function rejoinEmailStream(
  request: PluginEmailStreamRejoinRequest,
): Promise<EmailStreamRejoinOutcome> {
  const impl = resolvePluginService(PLUGIN_EMAIL_STREAMS)
  if (!impl) return { status: 'unavailable' }
  try {
    return await impl.rejoin(request)
  } catch (error) {
    // The site, never the address.
    console.error(`[email-streams] could not reopen a stream on ${request.hostId}`, error)
    return { status: 'failed' }
  }
}
