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

import { openSecret, sealSecret } from '@aglyn/shared-util-tools/secret-box'
import { REVIEW_PLATFORMS_COLLECTIONS } from '../constants/bundle-common'
import {
  INVITATION_MOMENTS,
  normalizeLocale,
  normalizeTrustpilotBccAddress,
  normalizeTrustpilotId,
  normalizeYotpoAppKey,
  TRUSTPILOT_MODES,
  type InvitationMoment,
  type ReviewPlatformsSettingsView,
  type ReviewPlatformsSettingsWrite,
  type TrustpilotMode,
} from '../model/review-platforms-settings'
import { apiConnectionsAvailable, type ReviewPlatformsConfig } from './config'
import { orgRef } from './db'

/**
 * ONE SITE'S REVIEW PLATFORMS (AGL-3699), one document per site under
 * `reviewPlatformsHostSettings` in its workspace. Every credential is sealed
 * under `REVIEW_PLATFORMS_TOKEN_KEY` with a context naming this document and
 * field, so a sealed value copied onto another site's record refuses to open
 * there. The console reads {@link toSettingsView}, which never carries a
 * credential back out.
 */

export interface StoredReviewPlatformsSettings {
  orgId: string
  hostId: string
  trustpilot?: {
    mode?: TrustpilotMode
    sendOn?: InvitationMoment
    bccAddress?: string | null
    sealedApiKey?: string
    sealedApiSecret?: string
    businessUnitId?: string | null
    businessUserId?: string | null
    locale?: string | null
    templateId?: string | null
  }
  yotpo?: {
    enabled?: boolean
    appKey?: string | null
    sealedSecretKey?: string
  }
  updatedAtMs?: number
  updatedBy?: string
}

export function settingsRef(orgId: string, hostId: string) {
  return orgRef(orgId).collection(REVIEW_PLATFORMS_COLLECTIONS.hostSettings).doc(hostId)
}

const sealContext = (orgId: string, hostId: string, field: string) =>
  `orgs/${orgId}/${REVIEW_PLATFORMS_COLLECTIONS.hostSettings}/${hostId}#${field}`

export async function readStoredSettings(orgId: string, hostId: string): Promise<StoredReviewPlatformsSettings> {
  const snapshot = await settingsRef(orgId, hostId).get()
  const data = snapshot.data() as StoredReviewPlatformsSettings | undefined
  return { ...(data ?? {}), orgId, hostId }
}

const mode = (value: unknown): TrustpilotMode =>
  (TRUSTPILOT_MODES as readonly string[]).includes(String(value)) ? (value as TrustpilotMode) : 'off'
const moment = (value: unknown): InvitationMoment =>
  (INVITATION_MOMENTS as readonly string[]).includes(String(value)) ? (value as InvitationMoment) : 'shipped'

function trustpilotApiConnected(stored: StoredReviewPlatformsSettings): boolean {
  const entry = stored.trustpilot
  return Boolean(entry?.sealedApiKey && entry?.sealedApiSecret && entry?.businessUnitId)
}

function yotpoConnected(stored: StoredReviewPlatformsSettings): boolean {
  return Boolean(stored.yotpo?.appKey && stored.yotpo?.sealedSecretKey)
}

/**
 * The mode in force: the API mode stands only while the deployment can open
 * the key and one is stored; BCC only with an address. Anything else is off.
 */
export function effectiveTrustpilotMode(stored: StoredReviewPlatformsSettings, config: ReviewPlatformsConfig): TrustpilotMode {
  const wanted = mode(stored.trustpilot?.mode)
  if (wanted === 'api') return apiConnectionsAvailable(config) && trustpilotApiConnected(stored) ? 'api' : 'off'
  if (wanted === 'bcc') return normalizeTrustpilotBccAddress(stored.trustpilot?.bccAddress) ? 'bcc' : 'off'
  return 'off'
}

/** The console's view: modes, switches and public identifiers. */
export function toSettingsView(stored: StoredReviewPlatformsSettings, config: ReviewPlatformsConfig): ReviewPlatformsSettingsView {
  const apiAvailable = apiConnectionsAvailable(config)
  const trustpilot = stored.trustpilot ?? {}
  return {
    apiAvailable,
    trustpilot: {
      mode: effectiveTrustpilotMode(stored, config),
      sendOn: moment(trustpilot.sendOn),
      bccAddress: normalizeTrustpilotBccAddress(trustpilot.bccAddress),
      apiConnected: apiAvailable && trustpilotApiConnected(stored),
      businessUnitId: trustpilot.businessUnitId ?? null,
      businessUserId: trustpilot.businessUserId ?? null,
      locale: trustpilot.locale ?? null,
      templateId: trustpilot.templateId ?? null,
    },
    yotpo: {
      enabled: apiAvailable && yotpoConnected(stored) && stored.yotpo?.enabled === true,
      connected: apiAvailable && yotpoConnected(stored),
      appKey: stored.yotpo?.appKey ?? null,
    },
  }
}

function open(stored: StoredReviewPlatformsSettings, config: ReviewPlatformsConfig, field: string, sealed: string | undefined): string | null {
  if (!sealed || !config.keyring) return null
  try {
    return openSecret(sealed, config.keyring, { context: sealContext(stored.orgId, stored.hostId, field) }).plaintext
  } catch (error) {
    console.error(`[review-platforms] a stored ${field} for ${stored.hostId} did not open`, error)
    return null
  }
}

export interface OpenedTrustpilotApi {
  apiKey: string
  apiSecret: string
  businessUnitId: string
  businessUserId: string | null
  locale: string
  templateId: string | null
  sendOn: InvitationMoment
}

/** Trustpilot's API credentials, when the API mode is in force and they open. */
export function openTrustpilotApi(stored: StoredReviewPlatformsSettings, config: ReviewPlatformsConfig): OpenedTrustpilotApi | null {
  if (effectiveTrustpilotMode(stored, config) !== 'api') return null
  const entry = stored.trustpilot ?? {}
  const apiKey = open(stored, config, 'trustpilot.apiKey', entry.sealedApiKey)
  const apiSecret = open(stored, config, 'trustpilot.apiSecret', entry.sealedApiSecret)
  if (!apiKey || !apiSecret || !entry.businessUnitId) return null
  return {
    apiKey,
    apiSecret,
    businessUnitId: entry.businessUnitId,
    businessUserId: entry.businessUserId ?? null,
    locale: entry.locale || 'en-US',
    templateId: entry.templateId ?? null,
    sendOn: moment(entry.sendOn),
  }
}

/** Trustpilot's BCC address and moment, when the BCC mode is in force. */
export function trustpilotBcc(
  stored: StoredReviewPlatformsSettings,
  config: ReviewPlatformsConfig,
): { address: string; sendOn: InvitationMoment } | null {
  if (effectiveTrustpilotMode(stored, config) !== 'bcc') return null
  const address = normalizeTrustpilotBccAddress(stored.trustpilot?.bccAddress)
  return address ? { address, sendOn: moment(stored.trustpilot?.sendOn) } : null
}

/** Yotpo's credentials, when it is connected, switched on and they open. */
export function openYotpo(stored: StoredReviewPlatformsSettings, config: ReviewPlatformsConfig): { appKey: string; secretKey: string } | null {
  if (stored.yotpo?.enabled !== true || !stored.yotpo.appKey) return null
  const secretKey = open(stored, config, 'yotpo.secretKey', stored.yotpo.sealedSecretKey)
  return secretKey ? { appKey: stored.yotpo.appKey, secretKey } : null
}

/** A refusal the console shows as is. */
export class SettingsRefusal extends Error {}

const credential = (value: unknown, max: number): string | null => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > max || /\s/.test(text)) throw new SettingsRefusal('That credential does not look right. Copy it again.')
  return text
}

/** An optional public field: blank clears it; anything else must pass `normalize`. */
function optional(value: unknown, normalize: (value: unknown) => string | null, refusal: string): string | null {
  if (value === null || String(value ?? '').trim() === '') return null
  const normalized = normalize(value)
  if (!normalized) throw new SettingsRefusal(refusal)
  return normalized
}

/**
 * Applies one change. Pure but for the seal: the caller has checked the
 * member may make it, and writes what this returns. A credential is only
 * taken when the deployment can seal it.
 */
export function applySettingsWrite(
  stored: StoredReviewPlatformsSettings,
  write: ReviewPlatformsSettingsWrite,
  config: ReviewPlatformsConfig,
): StoredReviewPlatformsSettings {
  const keyring = config.keyring
  const seal = (field: string, value: string) => {
    if (!keyring) throw new SettingsRefusal('API connections are not available here yet.')
    return sealSecret(value, keyring.current, { context: sealContext(stored.orgId, stored.hostId, field) })
  }
  const next: StoredReviewPlatformsSettings = { ...stored }
  if (write.platform === 'trustpilot') {
    const entry = { ...(stored.trustpilot ?? {}) }
    if (write.disconnect) {
      delete entry.sealedApiKey
      delete entry.sealedApiSecret
      if (entry.mode === 'api') entry.mode = 'off'
      next.trustpilot = entry
      return next
    }
    if (write.bccAddress !== undefined) {
      entry.bccAddress = optional(
        write.bccAddress,
        normalizeTrustpilotBccAddress,
        'Paste the invitation address from your Trustpilot account. It ends in @invite.trustpilot.com.',
      )
    }
    const apiKey = credential(write.apiKey, 200)
    const apiSecret = credential(write.apiSecret, 200)
    if (apiKey) entry.sealedApiKey = seal('trustpilot.apiKey', apiKey)
    if (apiSecret) entry.sealedApiSecret = seal('trustpilot.apiSecret', apiSecret)
    if (write.businessUnitId !== undefined) {
      entry.businessUnitId = optional(write.businessUnitId, normalizeTrustpilotId, 'The business unit ID is the letters and digits Trustpilot shows for your business.')
    }
    if (write.businessUserId !== undefined) {
      entry.businessUserId = optional(write.businessUserId, normalizeTrustpilotId, 'The business user ID is the letters and digits Trustpilot shows for your user.')
    }
    if (write.locale !== undefined) {
      entry.locale = optional(write.locale, normalizeLocale, 'The language is a code like en-US.')
    }
    if (write.templateId !== undefined) {
      entry.templateId = optional(write.templateId, normalizeTrustpilotId, 'The template ID is the letters and digits Trustpilot shows for the template.')
    }
    if (write.sendOn !== undefined) {
      if (!(INVITATION_MOMENTS as readonly string[]).includes(String(write.sendOn))) {
        throw new SettingsRefusal('Choose when the invitation goes.')
      }
      entry.sendOn = write.sendOn
    }
    if (write.mode !== undefined) {
      if (!(TRUSTPILOT_MODES as readonly string[]).includes(String(write.mode))) throw new SettingsRefusal('Choose how Trustpilot hears about orders.')
      entry.mode = write.mode
    }
    if (entry.mode === 'bcc' && !normalizeTrustpilotBccAddress(entry.bccAddress)) {
      throw new SettingsRefusal('Add your Trustpilot invitation address first.')
    }
    if (entry.mode === 'api') {
      if (!keyring) throw new SettingsRefusal('API connections are not available here yet.')
      if (!(entry.sealedApiKey && entry.sealedApiSecret && entry.businessUnitId)) {
        throw new SettingsRefusal('Add your Trustpilot API key, secret and business unit ID first.')
      }
    }
    next.trustpilot = entry
    return next
  }
  const entry = { ...(stored.yotpo ?? {}) }
  if (write.disconnect) {
    next.yotpo = { enabled: false, appKey: entry.appKey ?? null }
    return next
  }
  if (write.appKey !== undefined) {
    const appKey = optional(write.appKey, normalizeYotpoAppKey, 'The app key is the letters and digits in your Yotpo Reviews settings.')
    // A secret key belongs to its app key: another store's key drops it.
    if (appKey !== (entry.appKey ?? null)) delete entry.sealedSecretKey
    entry.appKey = appKey
  }
  const secretKey = credential(write.secretKey, 200)
  if (secretKey) entry.sealedSecretKey = seal('yotpo.secretKey', secretKey)
  if (write.enabled !== undefined) entry.enabled = write.enabled === true
  if (entry.enabled) {
    if (!keyring) throw new SettingsRefusal('API connections are not available here yet.')
    if (!(entry.appKey && entry.sealedSecretKey)) throw new SettingsRefusal('Add your Yotpo app key and secret key first.')
  }
  next.yotpo = entry
  return next
}
