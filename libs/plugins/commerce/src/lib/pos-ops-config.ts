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

/*==========================================
 * HOW THE REGISTER IS RUN (AGL-3609): shifts, refunds at the till, the
 * staff lock and what the receipt prints. Pure data, spread into
 * `COMMERCE_CONFIG_SCHEMA`, so the settings form, the routes and the
 * register read one set of keys with one set of bounds.
 *=========================================*/

/**
 * The most a register refund may be without a manager's PIN, by default:
 * nothing. Before this, only an admin of the whole workspace could refund at
 * all, so a default above zero would hand every cashier refunds on the day it
 * shipped. A merchant who trusts the till raises it.
 */
export const POS_REFUND_LIMIT_DEFAULT = 0

export const POS_OPS_CONFIG_FIELDS: PluginConfigField[] = [
  {
    key: 'posRequireOpenShift',
    label: 'Require an open shift to sell',
    type: 'boolean',
    description:
      'A register refuses sales and cash refunds until someone opens a shift ' +
      'with a starting float, so every sale is counted in a drawer.',
  },
  {
    key: 'posRefundLimit',
    label: 'Cashier refund limit ($)',
    type: 'number',
    min: 0,
    max: 100000,
    description:
      'The largest return a cashier may refund at the register without a ' +
      'manager entering their PIN. Workspace admins have no limit. Set to 0 to ' +
      'have a manager approve every register refund.',
  },
  {
    key: 'posAutoLockMinutes',
    label: 'Lock the register after (minutes idle)',
    type: 'number',
    min: 0,
    max: 240,
    description:
      'After this many minutes without a tap the register locks and asks for ' +
      'a staff PIN. Set to 0 to never lock.',
  },
  {
    key: 'posReceiptAddress',
    label: 'Address on printed receipts',
    type: 'string',
    description: 'Printed under your store name. Put each line on its own line.',
  },
  {
    key: 'posReturnPolicy',
    label: 'Return policy on printed receipts',
    type: 'string',
    description: 'Printed at the foot of every receipt and gift receipt.',
  },
]

export const POS_OPS_CONFIG_DEFAULTS: Record<string, unknown> = {
  posRequireOpenShift: false,
  posRefundLimit: POS_REFUND_LIMIT_DEFAULT,
  posAutoLockMinutes: 0,
  posReceiptAddress: '',
  posReturnPolicy: '',
}

/** The register settings, typed and bounded, for one site's merged config. */
export interface PosOpsSettings {
  requireOpenShift: boolean
  refundLimitCents: number
  autoLockMinutes: number
  receiptAddress: string
  returnPolicy: string
}

/**
 * Read defensively: the framework has already clamped a schema'd value, and
 * this second bound is for a config read without the schema.
 */
export function posOpsSettings(config: Record<string, unknown> | null | undefined): PosOpsSettings {
  const number = (key: string, max: number, fallback: number) => {
    const raw = Number(config?.[key])
    return Number.isFinite(raw) ? Math.min(max, Math.max(0, raw)) : fallback
  }
  return {
    requireOpenShift: config?.['posRequireOpenShift'] === true,
    refundLimitCents: Math.round(number('posRefundLimit', 100000, POS_REFUND_LIMIT_DEFAULT) * 100),
    autoLockMinutes: Math.round(number('posAutoLockMinutes', 240, 0)),
    receiptAddress: String(config?.['posReceiptAddress'] ?? '').slice(0, 500),
    returnPolicy: String(config?.['posReturnPolicy'] ?? '').slice(0, 1000),
  }
}
