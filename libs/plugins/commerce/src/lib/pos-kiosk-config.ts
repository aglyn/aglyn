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

import type { PluginConfigField } from '@aglyn/aglyn'
import {
  POS_KIOSK_IDLE_SECONDS_DEFAULT,
  POS_KIOSK_IDLE_SECONDS_MAX,
  POS_KIOSK_IDLE_SECONDS_MIN,
  posKioskIdleSeconds,
} from './model/commerce-pos-kiosk'

/*==========================================
 * THE SELF-SERVICE KIOSK'S SETTINGS (AGL-3623). Pure data, spread into
 * `COMMERCE_CONFIG_SCHEMA` beside the register's own, so the settings form,
 * the kiosk route and the kiosk read one set of keys with one set of bounds.
 * Tips and receipts are the register's settings: a kiosk asks for a tip
 * exactly when the register does.
 *=========================================*/

export const POS_KIOSK_CONFIG_FIELDS: PluginConfigField[] = [
  {
    key: 'posKioskPayAtCounter',
    label: 'Kiosk: let customers pay at the counter',
    type: 'boolean',
    description:
      'Adds "Pay at counter" to the self-service kiosk. The order goes to the ' +
      'register’s queue with its number, and a cashier takes payment there.',
  },
  {
    key: 'posKioskIdleSeconds',
    label: 'Kiosk: start over after (seconds idle)',
    type: 'number',
    min: POS_KIOSK_IDLE_SECONDS_MIN,
    max: POS_KIOSK_IDLE_SECONDS_MAX,
    description:
      'After this long without a touch the kiosk asks "Still there?", then ' +
      'clears the cart and anything the customer typed.',
  },
  {
    key: 'posKioskWelcome',
    label: 'Kiosk welcome',
    type: 'string',
    description: 'The line the kiosk’s start screen shows under your store name. Leave blank for "Order here".',
  },
]

export const POS_KIOSK_CONFIG_DEFAULTS: Record<string, unknown> = {
  posKioskPayAtCounter: true,
  posKioskIdleSeconds: POS_KIOSK_IDLE_SECONDS_DEFAULT,
  posKioskWelcome: '',
}

export interface PosKioskSettings {
  payAtCounter: boolean
  idleSeconds: number
  welcome: string
}

/** Read defensively, for a config read with or without the schema. */
export function posKioskSettings(config: Record<string, unknown> | null | undefined): PosKioskSettings {
  return {
    payAtCounter: config?.['posKioskPayAtCounter'] !== false,
    idleSeconds: posKioskIdleSeconds(config?.['posKioskIdleSeconds']),
    welcome: String(config?.['posKioskWelcome'] ?? '').trim().slice(0, 120),
  }
}
