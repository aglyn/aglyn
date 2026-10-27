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

import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/**
 * The register's finer permissions (AGL-4047), each a part of `managePos`
 * (Use the point of sale). Each REFINES it: never held without it, and,
 * where no custom role or override sets one, it follows `managePos` — so a
 * member keeps exactly the register they had until somebody narrows it.
 */
export type PosPermission =
  | 'posSell'
  | 'posRefund'
  | 'posDiscount'
  | 'posCashDrawer'
  | 'posDevices'
  | 'posBuyHardware'

/** The tier defaults `managePos` has, which every finer key mirrors. */
const POS_TIER_DEFAULTS = { admin: true, editor: true, viewer: false } as const

/**
 * Commerce's plugin-declared permissions (AGL-435) — the reference
 * adopter. Pure data: the client barrel and /server entry both register
 * it, so console gating and API-side resolution agree.
 */
export const COMMERCE_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: 'managePos',
    pluginId: 'commerce',
    label: 'Use the point of sale',
    description:
      'Open the point of sale. Each point of sale permission below follows this one unless a role or member sets it.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
  },
  {
    key: 'posSell',
    pluginId: 'commerce',
    label: 'Sell at the register',
    description: 'Ring up sales and take payment at the register, the kiosk and the point of sale apps.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
  {
    key: 'posRefund',
    pluginId: 'commerce',
    label: 'Refunds and returns',
    description: 'Refund point of sale orders at the register, up to its refund limit, and take returns and exchanges.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
  {
    key: 'posDiscount',
    pluginId: 'commerce',
    label: 'Give discounts at the register',
    description:
      'Take a discount off a sale at the register. A shopper’s discount code and the store’s own promotions apply without it.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
  {
    key: 'posCashDrawer',
    pluginId: 'commerce',
    label: 'Cash drawer and shifts',
    description: 'Open and close shifts, record cash in and out, print shift reports and open the drawer without a sale.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
  {
    key: 'posDevices',
    pluginId: 'commerce',
    label: 'Registers and devices',
    description: 'Add, change and remove card readers, receipt printers and customer displays, and set the reader screen.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
  {
    key: 'posBuyHardware',
    pluginId: 'commerce',
    label: 'Buy point of sale hardware',
    description: 'Order card readers and other hardware from the hardware shop.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    refines: 'managePos',
  },
]

/** One finer register key's label, for a refusal or a disabled control's reason. */
export function posPermissionLabel(permission: PosPermission): string {
  return COMMERCE_PERMISSIONS.find((entry) => entry.key === permission)?.label ?? permission
}

/**
 * Whether a resolved permission map allows one of the register's finer
 * actions (AGL-4047): `managePos`, and the finer key not refused. A map
 * that does not carry the finer key at all follows `managePos` — the
 * resolvers always carry it once commerce has registered, so an absent key
 * is a map built before that, which keeps the register it had.
 */
export function holdsPosPermission(
  permissions: Readonly<Record<string, boolean | undefined>> | null | undefined,
  permission: PosPermission,
): boolean {
  return permissions?.['managePos'] === true && permissions?.[permission] !== false
}

/** The refusal a register route answers when a finer key is not held. */
export function posPermissionRefusal(permission: PosPermission): string {
  return `Your role does not include "${posPermissionLabel(permission)}" — ask an organization admin`
}
