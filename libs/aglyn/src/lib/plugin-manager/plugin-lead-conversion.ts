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
 * A plugin's share of a LEAD CONVERSION (AGL-3233).
 *
 * When a lead becomes a contact — by the convert dialog, over the REST API,
 * or on its own when the person signs up or buys — the record system moves
 * what it filed on the lead onto the contact: the activities, the tasks.
 * A plugin that keeps records ABOUT the lead where those sweeps do not
 * reach — a sequence enrollment naming the lead, say — registers a
 * listener here, and the conversion runs every listener with the lead and
 * the contact it became, so the plugin can re-point its own records.
 *
 * Listeners run AFTER the lead is stamped converted, so a listener that
 * reads the lead finds `convertedContactId` on it, and after the record
 * system's own moves, so a listener that reads the contact's timeline
 * finds the lead's history already there.
 *
 * Listeners run in registration order and are ISOLATED: a throw is logged
 * against its plugin, recorded as `null`, and does not stop the next one or
 * the conversion — which has already happened. The `null` is how the
 * conversion's report says that plugin's records may still name the lead.
 *
 * Registered from a plugin's declarations — `serverDeclarations`, or
 * `consoleServerDeclarations` for a plugin whose server code runs only in
 * the console — so the listener is in place in a process that never loaded
 * the plugin's API surface. The core never imports a plugin; this is how a
 * conversion the tenancy runtime performs reaches a plugin's records.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** Which door converted the lead. */
export type PluginLeadConversionBy =
  /** A member, from the console's convert dialog. */
  | 'member'
  /** An API key, over `POST /v1/leads/{id}/convert`. */
  | 'api'
  /** The person opened a member account. */
  | 'signup'
  /** The person bought something. */
  | 'purchase'
  /** The one-time migration to the one-record model. */
  | 'backfill'

/** The lead that converted, and the contact it became. */
export interface PluginLeadConversionRequest {
  orgId: string
  /** The site the lead lived under. */
  hostId: string
  /** `hosts/{hostId}/leads/{leadId}` — the person key. */
  leadId: string
  /** `orgs/{orgId}/contacts/{contactId}`. */
  contactId: string
  /** The person's address, normalized. */
  email: string
  by: PluginLeadConversionBy
}

/**
 * What a listener reports: counts and flags, never content. A `null`
 * field is a figure the listener could not measure, which is not zero.
 */
export type PluginLeadConversionReport = Readonly<Record<string, number | boolean | null>>

export type PluginLeadConversionListener = (
  request: PluginLeadConversionRequest,
) => Promise<PluginLeadConversionReport>

interface Registration {
  pluginId: string
  listener: PluginLeadConversionListener
}

const registrations: Registration[] = []

/**
 * Registers a plugin's conversion listener. Owner = the loader's marker
 * inside a register fn, else `options.pluginId`; a listener with neither
 * throws. One listener per plugin: registering again replaces the plugin's
 * earlier listener in place, so a module evaluated twice does not move
 * records twice.
 */
export function registerPluginLeadConversionListener(
  listener: PluginLeadConversionListener,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin lead-conversion listener was registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, listener }
  else registrations.push({ pluginId, listener })
}

/** The plugins with a listener in place, in registration order. Only for specs and the guards. */
export function listPluginLeadConversionListeners(): readonly string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Only for specs: forgets every listener. */
export function resetPluginLeadConversionListenersForTests(): void {
  registrations.length = 0
}

/**
 * Runs every listener, in registration order, and answers each plugin's
 * report by plugin id: the listener's own report, or `null` for one that
 * threw. Never throws.
 */
export async function runPluginLeadConversionListeners(
  request: PluginLeadConversionRequest,
): Promise<Record<string, PluginLeadConversionReport | null>> {
  const reports: Record<string, PluginLeadConversionReport | null> = {}
  for (const { pluginId, listener } of [...registrations]) {
    try {
      reports[pluginId] = await listener({ ...request })
    } catch (error) {
      reports[pluginId] = null
      // The ids, never the address: this line outlives the person's records.
      console.error(
        `[plugins] ${pluginId} failed to follow lead ${request.leadId} to contact ${request.contactId} in org ${request.orgId}`,
        error,
      )
    }
  }
  return reports
}
