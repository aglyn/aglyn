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
 * The vendors a site can send server-side conversion events to (AGL-3694),
 * as the console card and the server both name them. Client-safe: no
 * credential, no SDK.
 *
 * The provider ids are the `analytics.adTags` keys of the matching browser
 * tags, so one id names the pixel and its Conversions API connection.
 */

export type AdProviderId = 'meta' | 'tiktok' | 'pinterest'

export const AD_PROVIDER_IDS: readonly AdProviderId[] = ['meta', 'tiktok', 'pinterest']

export interface AdProviderInfo {
  id: AdProviderId
  label: string
  /** What the vendor calls its server-side API. */
  api: string
  /** The browser tag the events pair with, as the Tracking tab names it. */
  tag: string
  /** Where the merchant makes the access token. */
  tokenHelp: string
  /** Whether events are sent to the browser tag's own id, so that id must be set first. */
  needsTagId: boolean
  /** Pinterest sends to an ad account rather than to the tag. */
  adAccount: { label: string; help: string } | null
  /** How a test event is marked: a code from the vendor's test tool, or a flag. */
  testEvents: { codeLabel: string; help: string } | { flag: true; help: string }
}

export const AD_PROVIDERS: Readonly<Record<AdProviderId, AdProviderInfo>> = {
  meta: {
    id: 'meta',
    label: 'Meta',
    api: 'Conversions API',
    tag: 'Meta pixel',
    tokenHelp:
      'In Meta Events Manager: your pixel → Settings → Conversions API → Generate access token.',
    needsTagId: true,
    adAccount: null,
    testEvents: {
      codeLabel: 'Test event code',
      help: 'From Events Manager → Test events, like TEST12345. Test orders and the Send test event button use it; real orders never do.',
    },
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    api: 'Events API',
    tag: 'TikTok pixel',
    tokenHelp:
      'In TikTok Ads Manager: Assets → Events → your pixel → Settings → Events API → Generate access token.',
    needsTagId: true,
    adAccount: null,
    testEvents: {
      codeLabel: 'Test event code',
      help: 'From Events Manager → your pixel → Test events. Test orders and the Send test event button use it; real orders never do.',
    },
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    api: 'Conversions API',
    tag: 'Pinterest tag',
    tokenHelp:
      'In Pinterest Ads: Conversions → Conversions API → Generate new token, for the ad account below.',
    needsTagId: false,
    adAccount: {
      label: 'Pinterest ad account ID',
      help: 'The number in your Pinterest Ads address, after /advertiser/.',
    },
    testEvents: {
      flag: true,
      help: 'Test orders and the Send test event button are sent with Pinterest’s test flag, so they never count as real conversions.',
    },
  },
}

export function isAdProviderId(value: unknown): value is AdProviderId {
  return typeof value === 'string' && (AD_PROVIDER_IDS as readonly string[]).includes(value)
}

/**
 * Where a connection stands.
 *
 * - `active` sends every owed event.
 * - `paused` was paused by the merchant; nothing new is owed to it.
 * - `reconnect` the vendor refused the token; only a new one fixes it.
 */
export type AdConnectionStatus = 'active' | 'paused' | 'reconnect'

/** A connection as the console card sees it. Never carries the token. */
export interface AdConnectionView {
  id: string
  provider: AdProviderId
  hostId: string
  status: AdConnectionStatus
  /** Pinterest's ad account; `null` for the others. */
  adAccountId: string | null
  /** The vendor's test event code, when one is set. A label, not a secret. */
  testEventCode: string | null
  /** When an event was last accepted, and which. */
  lastSentAtMs: number | null
  lastSentEvent: string | null
  lastSentTest: boolean
  /** When an event last failed, and the vendor's reason in words. */
  lastFailedAtMs: number | null
  lastError: string | null
  totals: {
    sent: number
    failed: number
  }
  connectedAtMs: number | null
}

/** The settings a merchant may change on a connection. */
export interface AdConnectionSettings {
  testEventCode?: string | null
  adAccountId?: string | null
  paused?: boolean
}

const TEST_CODE = /^[A-Za-z0-9_-]{1,64}$/

/** A Pinterest ad account id: digits. */
export const PINTEREST_AD_ACCOUNT_PATTERN = /^[0-9]{6,24}$/

/**
 * The settings in a request body, validated. Unknown keys are ignored; a bad
 * value refuses the whole change with a sentence for the card.
 */
export function readAdConnectionSettings(
  body: Record<string, unknown>,
): { ok: true; settings: AdConnectionSettings } | { ok: false; error: string } {
  const settings: AdConnectionSettings = {}
  if ('testEventCode' in body) {
    const code = String(body['testEventCode'] ?? '').trim()
    if (!code) settings.testEventCode = null
    else if (TEST_CODE.test(code)) settings.testEventCode = code
    else return { ok: false, error: 'A test event code is letters and digits, like TEST12345' }
  }
  if ('adAccountId' in body) {
    const account = String(body['adAccountId'] ?? '').trim()
    if (!account) settings.adAccountId = null
    else if (PINTEREST_AD_ACCOUNT_PATTERN.test(account)) settings.adAccountId = account
    else return { ok: false, error: 'An ad account ID is the number from your Pinterest Ads address' }
  }
  if ('paused' in body) {
    if (typeof body['paused'] !== 'boolean') return { ok: false, error: 'Use the button to pause or resume' }
    settings.paused = body['paused']
  }
  return { ok: true, settings }
}

/** The connection id for one site and one vendor: one connection per pair. */
export function adConnectionId(hostId: string, provider: AdProviderId): string {
  return `${hostId}_${provider}`
}

/** What the card shows about the site around the connections. */
export interface AdSiteSetup {
  /** The browser tag id the site configured on Tracking, per vendor; `null` when none. */
  tagIds: Record<AdProviderId, string | null>
  /**
   * Whether the site's visitors can grant advertising at all: the consent
   * tool is on and asks about advertising. Without it no event is ever sent.
   */
  asksAboutAdvertising: boolean
}
