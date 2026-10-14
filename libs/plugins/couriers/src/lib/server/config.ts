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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { parseSecretBoxKeyring, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { COURIERS_ENV } from '../constants'

/**
 * The deployment's half of couriers (AGL-3695): ONE variable on the console,
 * and no courier account of Aglyn's. Each merchant brings their own DoorDash
 * Drive developer keys; the deployment holds only the key those are sealed
 * under. Without it nothing can be stored, so no surface draws and no route
 * answers but 404.
 */

export const COURIERS_NOT_CONFIGURED_MESSAGE = 'Couriers are not available on this deployment.'

export function readCouriersKeyring(): SecretBoxKeyring | null {
  const value = String(process.env[COURIERS_ENV.tokenKey] ?? '').trim()
  if (!value) return null
  try {
    return parseSecretBoxKeyring(value)
  } catch (error) {
    console.error(`[couriers] ${COURIERS_ENV.tokenKey} is not a usable key`, (error as Error)?.message)
    return null
  }
}

/**
 * The console's own address for `path`: the canonical origin, or the
 * request's own on a local development server. `null` when neither is a URL.
 */
export function consoleAddress(path: string, requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${path}`
      }
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  try {
    const url = new URL(platformConsoleOrigin())
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}
