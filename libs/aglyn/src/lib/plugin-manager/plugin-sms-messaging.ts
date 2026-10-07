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
 * Sending a text message, as a platform capability any plugin may ask for
 * (AGL-3610) — the GENERIC half. Which vendor carries the message, how it is
 * metered and billed, and which numbers may not be texted are the provider
 * plugin's (`@aglyn/plugins-sms`); the caller knows none of it.
 *
 * Shaped like the tax profile seam (`plugin-tax-profile.ts`): one contract in
 * core, one provider plugin registers it at boot through its
 * `serverDeclarations`, and a consumer (commerce's order texts) resolves it by
 * contract rather than importing the plugin. The difference is the absent
 * case: a missing tax profile must refuse a charge, while a missing SMS
 * provider is an ordinary state — most installs have none — so
 * {@link pluginSmsMessaging} answers `undefined` and the caller offers email
 * only.
 */
export interface PluginSmsSendRequest {
  /** The number to text, in any format a person types; the provider normalizes. */
  to: string
  /** Plain text. The provider decides segmenting; keep it short. */
  body: string
  /** The site the message is sent for. Metering and rate limits key off its workspace. */
  hostId: string
  /**
   * Why this text is being sent. Only `transactional` exists today: a message
   * the recipient's own order or request owes them. Marketing texts need a
   * consent record this contract does not carry, so it does not admit them.
   */
  purpose: 'transactional'
  /** A short label for logs, e.g. `'order-shipped'`. */
  context?: string
  /**
   * Keeps the text out of the recipient's night. Given, a text that would
   * land between 9 PM and 8 AM in `timeZone` (an IANA name) is held and
   * delivered at 8 AM there instead; the outcome is still `sent`, with
   * `scheduledForMs`. Omit it for a text the recipient is waiting on right
   * now — a receipt at the counter, a sign-in code — which goes at once.
   */
  quietHours?: { timeZone: string }
}

export type PluginSmsSendOutcome =
  | {
      status: 'sent'
      /** The provider's message id. */
      id: string
      /** The number as sent, E.164. */
      to: string
      segments: number
      /** Held for the recipient's morning: when it will be delivered. */
      scheduledForMs?: number
    }
  /** No provider credentials: nothing was attempted. */
  | { status: 'not-configured' }
  /** The number could not be read as a phone number. */
  | { status: 'invalid-number' }
  /** The recipient texted STOP, or staff suppressed the number. */
  | { status: 'suppressed' }
  /** The workspace hit its text rate limit; nothing was sent. */
  | { status: 'rate-limited' }
  | { status: 'failed'; error: string }

export interface PluginSmsMessaging {
  /**
   * Whether texts can be sent at all. Cheap and synchronous, so a route can
   * ask it to decide whether to OFFER a text before anything is typed.
   */
  isConfigured(): boolean
  /** Sends one text. Never throws: every failure is an outcome. */
  send(request: PluginSmsSendRequest): Promise<PluginSmsSendOutcome>
}

export const PLUGIN_SMS_MESSAGING =
  definePluginServiceContract<PluginSmsMessaging>('core.messaging.sms', {
    multiple: false,
  })

export function registerPluginSmsMessaging(
  messaging: PluginSmsMessaging,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_SMS_MESSAGING, messaging, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered provider, or `undefined` when no plugin offers texts. */
export function pluginSmsMessaging(): PluginSmsMessaging | undefined {
  return resolvePluginServices(PLUGIN_SMS_MESSAGING)[0]?.impl
}

/** Whether a provider is registered AND configured: the UI's "offer text?" */
export function pluginSmsAvailable(): boolean {
  try {
    return pluginSmsMessaging()?.isConfigured() === true
  } catch {
    return false
  }
}
