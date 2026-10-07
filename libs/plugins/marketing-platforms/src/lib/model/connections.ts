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
 * The marketing platforms a site can connect (AGL-3639), as both the console
 * page and the server name them. Client-safe: no credential, no SDK.
 */

export type MarketingProviderId = 'mailchimp' | 'klaviyo' | 'omnisend' | 'attentive'

export const MARKETING_PROVIDER_IDS: readonly MarketingProviderId[] = ['mailchimp', 'klaviyo', 'omnisend', 'attentive']

export interface MarketingProviderInfo {
  id: MarketingProviderId
  label: string
  /** How a merchant connects without an app registration of ours: their own key. `null` = OAuth only. */
  apiKey: { label: string; help: string } | null
  /** What the provider calls the list contacts go into; `null` when it has none to pick. */
  listNoun: 'audience' | 'list' | null
  /** Whether order and checkout events are sent for the provider's flows. */
  events: boolean
}

export const MARKETING_PROVIDERS: Readonly<Record<MarketingProviderId, MarketingProviderInfo>> = {
  mailchimp: {
    id: 'mailchimp',
    label: 'Mailchimp',
    apiKey: {
      label: 'Mailchimp API key',
      help: 'In Mailchimp: Profile → Extras → API keys → Create a key. It ends in your data center, like -us21.',
    },
    listNoun: 'audience',
    events: false,
  },
  klaviyo: {
    id: 'klaviyo',
    label: 'Klaviyo',
    apiKey: {
      label: 'Klaviyo private API key',
      help: 'In Klaviyo: Settings → API keys → Create private API key, with full access to Profiles, Lists, Subscriptions and Events.',
    },
    listNoun: 'list',
    events: true,
  },
  omnisend: {
    id: 'omnisend',
    label: 'Omnisend',
    apiKey: {
      label: 'Omnisend API key',
      help: 'In Omnisend: Store settings → API keys → Create API key, with access to Contacts and Events.',
    },
    listNoun: null,
    events: true,
  },
  attentive: {
    id: 'attentive',
    label: 'Attentive',
    apiKey: null,
    listNoun: null,
    events: true,
  },
}

export function isMarketingProviderId(value: unknown): value is MarketingProviderId {
  return typeof value === 'string' && (MARKETING_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Where a connection stands.
 *
 * - `active` syncs on every tick.
 * - `paused` was paused by the merchant.
 * - `error` stopped after too many failures in a row; Sync now retries it.
 * - `reconnect` the provider refused the credential; only connecting again fixes it.
 */
export type MarketingConnectionStatus = 'active' | 'paused' | 'error' | 'reconnect'

/** A list (audience) the provider offers, to pick the one contacts go into. */
export interface MarketingProviderList {
  id: string
  name: string
}

/** A connection as the console page sees it. Never carries a credential. */
export interface MarketingConnectionView {
  id: string
  provider: MarketingProviderId
  hostId: string
  status: MarketingConnectionStatus
  /** How it was connected. */
  authKind: 'api-key' | 'oauth'
  /** The account's name at the provider, as it reported it. */
  accountName: string | null
  /** The list contacts go into, when the provider has lists. */
  listId: string | null
  lists: MarketingProviderList[]
  /** A tag every synced contact carries at the provider, so the merchant can segment them. Empty for none. */
  tag: string
  syncContacts: boolean
  syncEvents: boolean
  /** Whether the first full copy of the site's contacts has finished. */
  backfillDone: boolean
  lastRunAtMs: number | null
  lastSuccessAtMs: number | null
  nextRunAtMs: number | null
  /** The last error, in words a merchant can act on; `null` after a clean run. */
  lastError: string | null
  consecutiveFailures: number
  totals: {
    /** Contacts sent to the provider (added, updated or unsubscribed). */
    contactsPushed: number
    /** Unsubscribes and resubscribes read back from the provider. */
    consentPulled: number
    /** Events delivered. */
    eventsSent: number
  }
  connectedAtMs: number | null
}

/** One run, or one error, on a connection's log. */
export interface MarketingConnectionLogEntry {
  id: string
  atMs: number
  kind: 'run' | 'error' | 'event-failed'
  /** What happened, in words. */
  message: string
  contactsPushed?: number
  consentPulled?: number
  eventsSent?: number
}

/** The settings a merchant may change on a connection. */
export interface MarketingConnectionSettings {
  listId?: string | null
  tag?: string
  syncContacts?: boolean
  syncEvents?: boolean
  paused?: boolean
}

const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The settings in a request body, validated. Unknown keys are ignored; a bad
 * value refuses the whole change with a sentence for the page.
 */
export function readConnectionSettings(
  body: Record<string, unknown>,
): { ok: true; settings: MarketingConnectionSettings } | { ok: false; error: string } {
  const settings: MarketingConnectionSettings = {}
  if ('listId' in body) {
    const value = body['listId']
    if (value === null || value === '') settings.listId = null
    else if (typeof value === 'string' && LIST_ID.test(value)) settings.listId = value
    else return { ok: false, error: 'Choose a list from the menu' }
  }
  if ('tag' in body) {
    const tag = String(body['tag'] ?? '').trim()
    if (tag.length > 100) return { ok: false, error: 'Keep the tag under 100 characters' }
    settings.tag = tag
  }
  for (const key of ['syncContacts', 'syncEvents', 'paused'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') return { ok: false, error: 'Use the switch to change that setting' }
      settings[key] = body[key] as boolean
    }
  }
  return { ok: true, settings }
}

/** The connection id for one site and one provider: one connection per pair. */
export function marketingConnectionId(hostId: string, provider: MarketingProviderId): string {
  return `${hostId}_${provider}`
}
