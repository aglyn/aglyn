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

import type { PluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import type {
  PluginUsageMeterContext,
  PluginUsageMeterReading,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { consumeRateLimit, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isPhoneContactSuppressed } from '@aglyn/tenant-data-admin/server/contact-suppression'
import { SMS_SENDS_PER_HOUR_PER_ORG } from './constants'
import { createSmsMessaging } from './sms-messaging'
import type { SmsProvider } from './sms-provider'
import { measureSmsUsage } from './sms-usage-meter'

/**
 * The production wiring (AGL-3610): the configured vendor and the platform's
 * stores. Its own module, loaded lazily by `declarations.server.ts` with the
 * first text, so booting an app never loads the data layer for a plugin that
 * may never send — and so this package imports `@aglyn/tenant-data-admin`
 * statically in exactly one place (`check:lib-boundaries`).
 */
export function createPlatformSmsMessaging(provider: SmsProvider): PluginSmsMessaging {
  return createSmsMessaging({
    provider,
    firestore: () => firebaseAdmin.app().firestore(),
    increment: (by) => firebaseAdmin.firestore.FieldValue.increment(by),
    isSuppressed: (e164) => isPhoneContactSuppressed(e164, 'texts'),
    orgIdForHost: async (hostId) =>
      (await getOrgForHost(hostId).catch(() => null))?.orgId ?? null,
    consumeRate: (key) =>
      consumeRateLimit(key, {
        limit: SMS_SENDS_PER_HOUR_PER_ORG,
        windowMs: 60 * 60 * 1000,
      }),
  })
}

/** The usage sweep's reading, against the platform's Firestore. */
export function measurePlatformSmsUsage(
  context: PluginUsageMeterContext,
): Promise<PluginUsageMeterReading> {
  return measureSmsUsage(context, firebaseAdmin.app().firestore())
}

/** Records an inbound STOP / START on the platform suppression list. */
export { applyInboundSmsKeyword } from '@aglyn/tenant-data-admin/server/sms-keywords'
