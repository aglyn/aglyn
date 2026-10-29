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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/**
 * The register's finer permissions (AGL-4047), each a part of `managePos`
 * (Use the point of sale). Each REFINES it: never held without it, and,
 * where no custom role or override sets one, it follows `managePos` — so a
 * member keeps exactly the register they had until somebody narrows it.
 */
export type PosRegisterPermission =
  | 'posSell'
  | 'posRefund'
  | 'posDiscount'
  | 'posCashDrawer'
  | 'posDevices'

/**
 * The register's keys and `posBuyHardware`, which stands on its own
 * (AGL-4047): it FOLLOWS `managePos` where no custom role or override sets
 * it, so every member keeps the hardware shop they had, but it may be
 * granted without the register — a bookkeeper who orders the store's readers
 * and never rings a sale.
 */
export type PosPermission = PosRegisterPermission | 'posBuyHardware'

/** The tier defaults `managePos` has, which every finer key mirrors. */
const POS_TIER_DEFAULTS = { admin: true, editor: true, viewer: false } as const

/*
 * The register is a site's own (AGL-4047): `managePos` and its five finer
 * keys are `narrowsPerSite`, so an editor of the whole workspace given Viewer
 * or Author access to one site does not work that site's register unless the
 * site grants it to them. `posBuyHardware` is not: the hardware shop spends
 * the workspace's money, and its verdict is the workspace's on every site.
 */

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
    narrowsPerSite: true,
  },
  {
    key: 'posSell',
    pluginId: 'commerce',
    label: 'Sell at the register',
    description: 'Ring up sales and take payment at the register, the kiosk and the point of sale apps.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    narrowsPerSite: true,
    refines: 'managePos',
  },
  {
    key: 'posRefund',
    pluginId: 'commerce',
    label: 'Refunds and returns',
    description: 'Refund point of sale orders at the register, up to its refund limit, and take returns and exchanges.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    narrowsPerSite: true,
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
    narrowsPerSite: true,
    refines: 'managePos',
  },
  {
    key: 'posCashDrawer',
    pluginId: 'commerce',
    label: 'Cash drawer and shifts',
    description: 'Open and close shifts, record cash in and out, print shift reports and open the drawer without a sale.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    narrowsPerSite: true,
    refines: 'managePos',
  },
  {
    key: 'posDevices',
    pluginId: 'commerce',
    label: 'Registers and devices',
    description: 'Add, change and remove card readers, receipt printers and customer displays, and set the reader screen.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    narrowsPerSite: true,
    refines: 'managePos',
  },
  {
    key: 'posBuyHardware',
    pluginId: 'commerce',
    label: 'Buy point of sale hardware',
    description:
      'Order card readers and other hardware from the hardware shop. Follows "Use the point of sale" unless a role or member sets it, and may be allowed without it.',
    defaults: { ...POS_TIER_DEFAULTS },
    groupLabel: 'Commerce',
    follows: 'managePos',
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
 *
 * `posBuyHardware` stands on its own: its own verdict when the map carries
 * one, granted with or without `managePos`, and `managePos`'s when it does
 * not.
 */
export function holdsPosPermission(
  permissions: Readonly<Record<string, boolean | undefined>> | null | undefined,
  permission: PosPermission,
): boolean {
  if (permission === 'posBuyHardware') {
    const own = permissions?.[permission]
    return typeof own === 'boolean' ? own : permissions?.['managePos'] === true
  }
  return permissions?.['managePos'] === true && permissions?.[permission] !== false
}

/**
 * Whether a member may open the hardware shop at all (AGL-4047): see what
 * it offers and what the store ordered. Whoever works the register, and
 * whoever may buy hardware without working it.
 */
export function mayVisitPosHardwareShop(
  permissions: Readonly<Record<string, boolean | undefined>> | null | undefined,
): boolean {
  return permissions?.['managePos'] === true || holdsPosPermission(permissions, 'posBuyHardware')
}

/** The refusal a register route answers when a finer key is not held. */
export function posPermissionRefusal(permission: PosPermission): string {
  return `Your role does not include "${posPermissionLabel(permission)}" — ask an organization admin`
}

/*
 * RESERVATIONS (AGL-4047).
 *
 * A site's stays and what they book were decided by the member's role ON THE
 * SITE: Admin, Editor and Author could book a walk-in, change a stay's guests
 * and edit or cancel stays, and a Viewer could not (`canWriteHostContent` in
 * the rules, the same three roles at the routes). Those are now keys whose
 * preset is that site role (`presetFromSiteRole`), so every member keeps
 * exactly the access they had, and a custom role, a member's own permissions
 * or a site's toggle can grant or refuse either one: the window's staff can
 * be allowed walk-ins without editing anyone's booking.
 */

/** The reservation keys. */
export type ReservationPermission = 'commerce.reservations' | 'commerce.walkIns'

/** Commerce's keys whose preset is the site role (AGL-4047). */
export type CommerceSitePermission =
  | ReservationPermission
  | 'commerce.orders'
  | 'commerce.quotes'
  | 'commerce.quotes.send'
  | 'commerce.giftCards'
  | 'commerce.paymentMethods'
  | 'commerce.shippingConnections'

/** Who held reservations on a site before they were keys: Admin, Editor and Author. */
export const RESERVATION_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: true,
  viewer: false,
}

/** The same, per workspace role: the answer with no site named. */
const RESERVATION_ORG_ROLE_PRESET = { owner: true, admin: true, editor: true, viewer: false } as const

/**
 * Who worked a site's orders and gift cards before they were keys: the site's
 * Admin and Editor (an Author edits the catalog and never touched an order).
 */
export const ORDERS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/**
 * Who changed a site's payment methods and its shipping app connections
 * before they were keys: the site's Admin alone (an Editor could see them, as
 * whoever works the orders still can).
 */
export const STORE_SETTINGS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: false,
  author: false,
  viewer: false,
}

/** The same, per workspace role: the answer with no site named. */
export const STORE_SETTINGS_ORG_ROLE_PRESET = { owner: true, admin: true, editor: false, viewer: false } as const

/**
 * The reservation keys as commerce declares them into the org permission
 * catalog (AGL-4047), registered beside `COMMERCE_PERMISSIONS`.
 */
export const COMMERCE_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'commerce.reservations',
    label: 'Manage reservations',
    description:
      'Edit, cancel and check out stays, and add, change and remove what can be booked. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...RESERVATION_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.walkIns',
    label: 'Book walk-ins and change guests',
    description:
      'Book a walk-in stay and change how many guests a stay is for. Follows "Manage reservations" unless a role or member sets it, and may be allowed without it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...RESERVATION_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
    follows: 'commerce.reservations',
  },
  {
    key: 'commerce.orders',
    label: 'Manage orders',
    description:
      'Fulfill, cancel and print orders, resend receipts, build draft orders, take returns and record shipments. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...ORDERS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.quotes',
    label: 'Create and edit quotes',
    description:
      'Create, edit and delete quotes for customers. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...ORDERS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.quotes.send',
    label: 'Send quotes and invoices to customers',
    description:
      'Copy a quote’s pay link to send to the customer, and replace it so the old link stops working. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...ORDERS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.giftCards',
    label: 'Issue gift cards',
    description: 'Issue, adjust and void the store’s gift cards. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...RESERVATION_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...ORDERS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.paymentMethods',
    label: 'Manage payment methods',
    description:
      'Turn the store’s payment methods on and off. Anyone with "Manage orders" sees them. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...STORE_SETTINGS_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...STORE_SETTINGS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
  {
    key: 'commerce.shippingConnections',
    label: 'Connect shipping apps',
    description:
      'Connect, sync and disconnect ShipStation and ShippingEasy, and show or replace their credentials. Anyone with "Manage orders" sees whether they are connected. Follows the site role unless a role or member sets it.',
    roleDefaults: { ...STORE_SETTINGS_ORG_ROLE_PRESET },
    hostRoleDefaults: { ...STORE_SETTINGS_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers when a commerce site key is not held: names the permission. */
export function commerceSitePermissionRefusal(key: CommerceSitePermission): string {
  const label = COMMERCE_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}

/** One reservation key's label, for a refusal. */
export function reservationPermissionLabel(permission: ReservationPermission): string {
  return COMMERCE_SITE_PERMISSIONS.find((entry) => entry.key === permission)?.label ?? permission
}

/** The refusal a reservation route answers when its key is not held; names the permission, never a role. */
export function reservationPermissionRefusal(permission: ReservationPermission): string {
  return commerceSitePermissionRefusal(permission)
}
