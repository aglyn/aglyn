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

import { readClientIp, type ClientIpHeaders } from '../app-utils/request-ip'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * Where a door hands a visitor's advertising consent to the plugin that sends
 * server-side conversion events (AGL-3694).
 *
 * A checkout and a form submission are the two moments a published site's
 * visitor reaches a server with their consent in hand (see
 * `app-utils/advertising-consent.ts` for why there is no other). The doors —
 * commerce's checkout routes and the form route — do not know which plugin, if
 * any, sends Conversions API events, and must not import it; they ASK through
 * this contract, the same shape as `plugin-conversion-credit.ts`. With no
 * plugin registered, or a site that connected nothing, every call is a no-op
 * and nothing is stored.
 *
 * Server only. Every call is best-effort and never throws: a conversion event
 * is never a reason to fail a checkout or lose a submission.
 */

/** What the request itself says about the visitor, beside the body. */
export interface AdvertisingRequestFacts {
  /** The browser's `User-Agent`, which a vendor needs for a web event. */
  userAgent: string | null
  /** The client address, as the deployment's proxy chain reports it. */
  ip: string | null
  /** The request carried `Sec-GPC: 1`, which outranks any record. */
  gpc: boolean
}

/** A checkout's consent, recorded under the id its order will carry. */
export interface AdvertisingOrderConsentRequest extends AdvertisingRequestFacts {
  hostId: string
  /** The Stripe Checkout Session id — the id the paid order is stored under. */
  orderKey: string
  /** The `adConsent` body field, untrusted. */
  wire: unknown
}

/** A lead a visitor just submitted, reported once with their consent. */
export interface AdvertisingLeadRequest extends AdvertisingRequestFacts {
  hostId: string
  /** The `adConsent` body field, untrusted; it names the lead's event id. */
  wire: unknown
  /** What the visitor typed, as the door read it. Hashed before it is kept. */
  person: {
    email?: string | null
    phone?: string | null
    name?: string | null
    firstName?: string | null
    lastName?: string | null
  }
  /** The form's own name, for the merchant's log. */
  formName?: string | null
}

export interface PluginAdvertisingConversions {
  recordOrderConsent(request: AdvertisingOrderConsentRequest): Promise<void>
  reportLead(request: AdvertisingLeadRequest): Promise<void>
}

export const PLUGIN_ADVERTISING_CONVERSIONS = definePluginServiceContract<PluginAdvertisingConversions>(
  'core.advertising-conversions',
  { multiple: false },
)

/** Registers the plugin that sends server-side conversion events. One per deployment. */
export function registerPluginAdvertisingConversions(
  impl: PluginAdvertisingConversions,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_ADVERTISING_CONVERSIONS, impl, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

async function implementation(): Promise<PluginAdvertisingConversions | null> {
  const found = resolvePluginServices(PLUGIN_ADVERTISING_CONVERSIONS)[0]
  if (found) return found.impl
  try {
    await runPluginDeclarationsRepair()
  } catch (error) {
    console.error('[advertising-conversions] plugin declarations failed', error)
  }
  return resolvePluginServices(PLUGIN_ADVERTISING_CONVERSIONS)[0]?.impl ?? null
}

function readHeader(headers: ClientIpHeaders, name: string): string | null {
  const reader = headers as { get?: (name: string) => unknown }
  if (typeof reader.get === 'function') {
    const value = reader.get(name)
    return typeof value === 'string' ? value : null
  }
  const value = (headers as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/** The facts a door reads off its own request, from either header shape. */
export function advertisingRequestFacts(headers: ClientIpHeaders): AdvertisingRequestFacts {
  let ip: string | null
  try {
    ip = readClientIp(headers)
  } catch {
    ip = null
  }
  return {
    userAgent: (readHeader(headers, 'user-agent') ?? '').slice(0, 500) || null,
    ip,
    gpc: String(readHeader(headers, 'sec-gpc') ?? '').trim() === '1',
  }
}

/**
 * Records a checkout's consent for the order it may become. A request with no
 * wire, or one carrying Global Privacy Control, is not even handed over.
 */
export async function recordAdvertisingOrderConsent(request: AdvertisingOrderConsentRequest): Promise<void> {
  if (!request.wire || request.gpc || !request.orderKey) return
  try {
    const found = await implementation()
    if (found) await found.recordOrderConsent(request)
  } catch (error) {
    console.error('[advertising-conversions] order consent not recorded', error)
  }
}

/** Reports a submitted lead. Same rules: no wire or GPC, nothing handed over. */
export async function reportAdvertisingLead(request: AdvertisingLeadRequest): Promise<void> {
  if (!request.wire || request.gpc) return
  try {
    const found = await implementation()
    if (found) await found.reportLead(request)
  } catch (error) {
    console.error('[advertising-conversions] lead not reported', error)
  }
}
