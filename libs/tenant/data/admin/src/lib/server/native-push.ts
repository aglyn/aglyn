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
 * Registers the native apps' push delivery (APNs and FCM, AGL-3651) with the
 * fan-out, once per server instance. A deployment's server entry calls it at
 * boot (the console's and the tenant's `instrumentation.ts`).
 *
 * This file imports nothing heavy: the sender it registers imports
 * `push-delivery.ts`, and through it each transport, only when a
 * notification has push recipients.
 */

import { registerMobilePushSender } from './mobile-push-switch'

// On `globalThis` for the same reason as the registry itself: a second
// module copy must not register a second sender and push everything twice.
const REGISTERED_KEY = Symbol.for('@aglyn/tenant-data-admin:native-push-registered')

const globalScope = globalThis as typeof globalThis & { [REGISTERED_KEY]?: true }

export function registerNativePushSenders(): void {
  if (globalScope[REGISTERED_KEY]) return
  globalScope[REGISTERED_KEY] = true
  registerMobilePushSender(async (uids, payload, context) => {
    const { nativePushSender } = await import('./push-delivery')
    await nativePushSender(uids, payload, context)
  })
}
