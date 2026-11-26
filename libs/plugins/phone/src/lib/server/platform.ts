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

import { checkEntitlement, pluginSeatAddonUnits } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginPersonRecords } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { pluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { consumeRateLimit } from '@aglyn/tenant-data-admin/server/rate-limit-store'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { randomUUID } from 'node:crypto'
import { PHONE_ADDON_KEY, PHONE_PLUGIN_ID } from '../constants/bundle-common'
import { PHONE_SENDS_PER_HOUR_PER_ORG } from '../constants/usage'
import { createTwilioClient } from '../twilio/twilio-client'
import { createFirestorePhoneRepository, type PhoneFirestore } from './phone-repository'
import { createPhoneService, type PhoneServiceDeps } from './phone-service'
import { createPhoneHookRoutes, createPhoneMemberRoutes, type PhoneRouteDeps } from './routes'
import type { PhoneGateDeps } from './route-gate'
import { createVoiceService } from './voice-service'

/**
 * The production wiring (AGL-4251): Firestore, the platform's Twilio account,
 * the CRM through core's seams. Loaded lazily by `server.ts` with the first
 * request, so booting the console never loads it.
 */

const DEFAULT_CONSOLE_ORIGIN = 'https://app.aglyn.io'

/** The console's public origin, which Twilio's webhooks are pointed at. */
export function phoneWebhookOrigin(): string | null {
  const raw = String(process.env['NEXT_PUBLIC_CONSOLE_URL'] ?? '').trim().replace(/\/+$/, '') || DEFAULT_CONSOLE_ORIGIN
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function serviceDeps(): PhoneServiceDeps {
  const firestore = () => firebaseAdmin.app().firestore() as unknown as PhoneFirestore
  return {
    repo: createFirestorePhoneRepository(firestore, (by) => firebaseAdmin.firestore.FieldValue.increment(by)),
    twilio: createTwilioClient(),
    now: Date.now,
    newId: () => randomUUID().replace(/-/g, '').slice(0, 20),
    webhookOrigin: phoneWebhookOrigin,
    async findPerson({ orgId, hostId, e164 }) {
      const owner = pluginPersonRecords()
      if (!owner?.records.search) return null
      const [person] = await owner.records.search({ hostId, orgId, text: e164.replace(/\D/g, '').slice(-10), limit: 1 })
      if (!person) return null
      const data = person.data as Record<string, unknown>
      const name =
        [data['firstName'], data['lastName']].filter((part) => typeof part === 'string' && part).join(' ') ||
        (typeof data['name'] === 'string' ? data['name'] : null) ||
        person.email
      return { kind: person.kind, id: person.id, name: name || null }
    },
    async logActivity(input) {
      const writer = pluginRecordTimelineWriter()?.writer
      if (!writer) return
      await writer.logActivity({
        orgId: input.orgId,
        hostId: input.hostId,
        link: { record: { kind: input.person.kind, id: input.person.id } },
        sourcePluginId: PHONE_PLUGIN_ID,
        kind: input.kind,
        atMs: input.atMs,
        body: input.body,
        byUid: input.byUid ?? PHONE_PLUGIN_ID,
        dedupeKey: input.dedupeKey,
      } as Parameters<typeof writer.logActivity>[0])
    },
    async consumeSendRate(orgId) {
      const result = await consumeRateLimit(`phone:org:${orgId}`, {
        limit: PHONE_SENDS_PER_HOUR_PER_ORG,
        windowMs: 60 * 60 * 1000,
      })
      return result.allowed
    },
  }
}

function gateDeps(): PhoneGateDeps {
  return {
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    isInvalidToken: (error) => invalidIdTokenResponse(error) !== null,
    isEmailVerified: (decoded) => isEmailVerified(decoded) || isImpersonationSession(decoded),
    resolveOrgPermissions: (uid, context) => resolveOrgPermissions(uid, context),
    async readOrg(orgId) {
      const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    hasFeature: (org, feature) => checkEntitlement(org as never, feature),
    lockdownRefusal: (options) => lockdownRefusal(options as Parameters<typeof lockdownRefusal>[0]),
  }
}

let routes: Record<string, (request: Request) => Promise<Response>> | null = null

/** Every Phone handler, built once per process. */
export function platformPhoneRoutes(): Record<string, (request: Request) => Promise<Response>> {
  if (routes) return routes
  const deps = serviceDeps()
  const phone = createPhoneService(deps)
  const voice = createVoiceService(deps, phone)
  const routeDeps: PhoneRouteDeps = {
    gate: gateDeps(),
    phone,
    voice,
    webhookOrigin: phoneWebhookOrigin,
    addonUnits: (org) =>
      pluginSeatAddonUnits((org as { seatAddons?: Record<string, unknown> }).seatAddons as never, PHONE_ADDON_KEY),
  }
  routes = { ...createPhoneMemberRoutes(routeDeps), ...createPhoneHookRoutes(routeDeps) }
  return routes
}
