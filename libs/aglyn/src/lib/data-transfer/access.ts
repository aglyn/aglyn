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

import type { TransferImportRole, TransferResourceDescriptor } from './resource'
import { TRANSFER_PLAN_REQUIRED, type TransferApiRoute, type TransferPlanRequiredResponse } from './transfer-api'

/*==========================================
 * WHO MAY MOVE A RESOURCE'S RECORDS (AGL-3546)
 *
 * Two intents, answered the same way by the transfer routes' gate and by the
 * console's display of Import and Export, so a button is never offered that
 * the route refuses:
 *
 *  - IMPORT (upload, analyze, plan, apply, status, undo — and the job list
 *    and packages, which the gate asks with the same intent) writes records, and
 *    needs `data.manage` — on the named site, or on the workspace. A
 *    resource stricter than that names its `importRoles` (AGL-3554): the
 *    member's role where the records are must also be one of them (gift
 *    cards: a site's admins, which a workspace's owners and admins are).
 *  - EXPORT (export, and `fields`, which the export dialog opens with) only
 *    reads them, and asks what the resource declares: `readableByMembers`
 *    admits any member (a collaborator who reaches the named site), the
 *    way datasets are read; a `readPermission` admits whoever holds it; and
 *    a resource that declares neither keeps `data.manage`, because its
 *    records may be ones the rules let only managers read (CRM contacts).
 *    `data.manage` always admits. Which records a reader then sees is the
 *    resource's own business: `readPage` and `count` honor the reader's
 *    `scopeTokens`, as every other door onto the records does.
 *
 * And one question of the WORKSPACE, asked after the member's (AGL-3555):
 * a resource that declares a `featureFlag` is moved only by a workspace
 * whose plan carries that feature, for every intent but the ones it lists
 * in `featureFlagExempt`. {@link transferPlanFeature} names the feature an
 * intent needs; the gate refuses without it (403 `plan_required`, the
 * feature as `code`), staff included, and the console's `can` answers
 * `false`, so neither button is offered on a plan the route refuses.
 *==========================================*/

/** What a resource declares about who may read and import its records. */
export type TransferReadDeclaration = Pick<TransferResourceDescriptor, 'readPermission' | 'readableByMembers' | 'importRoles'>

/** What a resource declares about the plan that moves its records. */
export type TransferPlanDeclaration = Pick<TransferResourceDescriptor, 'featureFlag' | 'featureFlagExempt'>

/** What a member is doing with a resource's records. */
export type TransferAccessIntent = 'import' | 'export'

/** The permission every import asks for. */
export const TRANSFER_MANAGE_PERMISSION = 'data.manage'

/** The routes that only read records, and so ask for export access. */
export const TRANSFER_EXPORT_ROUTES: readonly TransferApiRoute[] = ['fields', 'export']

/** The intent a transfer route asks with. */
export function transferRouteIntent(route: TransferApiRoute): TransferAccessIntent {
  return TRANSFER_EXPORT_ROUTES.includes(route) ? 'export' : 'import'
}

/**
 * The permissions any ONE of which admits a member to `intent` on a
 * resource. Empty means membership is enough (and, for a collaborator,
 * reaching the named site).
 */
export function transferAccessPermissions(
  intent: TransferAccessIntent,
  descriptor: TransferReadDeclaration | null | undefined,
): readonly string[] {
  if (intent === 'import') return [TRANSFER_MANAGE_PERMISSION]
  if (descriptor?.readableByMembers === true) return []
  const read = descriptor?.readPermission?.trim()
  // Whoever may write the records may read them.
  return read && read !== TRANSFER_MANAGE_PERMISSION ? [read, TRANSFER_MANAGE_PERMISSION] : [TRANSFER_MANAGE_PERMISSION]
}

/** How one member's permissions resolve where the records are. */
export interface TransferMemberAxis {
  /** Whether the member holds `permission` on the named site, or on the workspace when none is named. */
  holds(permission: string): boolean
  /** Whether the member reaches the named site; `true` when none is named or the member is org-wide. */
  reachesSite: boolean
  /**
   * The member's role where the records are — on the named site
   * (`hostRoleFor`), or on the workspace (`transferWorkspaceRole`) — for a
   * resource that names `importRoles`; `null` for none.
   */
  role?: TransferImportRole | null
}

/** Whether a member may `intent` a resource's records: see the block above. */
export function transferAccessAllowed(
  intent: TransferAccessIntent,
  descriptor: TransferReadDeclaration | null | undefined,
  axis: TransferMemberAxis,
): boolean {
  if (!axis.reachesSite) return false
  if (!transferImportRoleAllowed(intent, descriptor, axis.role ?? null)) return false
  const needed = transferAccessPermissions(intent, descriptor)
  return !needed.length || needed.some((permission) => axis.holds(permission))
}

/**
 * Whether a member in `role` may `intent` the records, as far as the
 * resource's `importRoles` say: always for an export, or a resource that
 * names none (AGL-3554).
 */
export function transferImportRoleAllowed(
  intent: TransferAccessIntent,
  descriptor: Pick<TransferResourceDescriptor, 'importRoles'> | null | undefined,
  role: TransferImportRole | null,
): boolean {
  const roles = descriptor?.importRoles
  if (intent !== 'import' || !roles?.length) return true
  return role !== null && roles.includes(role)
}

/**
 * A workspace role as the site role it is on every site, for a workspace's
 * records: an owner or an admin is every site's admin (`hostRoleFor`), and
 * any other role is itself.
 */
export function transferWorkspaceRole(role: string | null | undefined): TransferImportRole | null {
  if (role === 'owner' || role === 'admin') return 'admin'
  return role === 'editor' || role === 'author' || role === 'viewer' ? role : null
}

/** The sentence refusing a member whose role is not among the resource's `importRoles`. */
export function transferImportRoleRefusal(
  descriptor: Pick<TransferResourceDescriptor, 'importRoles' | 'label' | 'scope'>,
): string {
  const roles = descriptor.importRoles ?? []
  const what = /^[A-Z][a-z]/.test(descriptor.label)
    ? descriptor.label.charAt(0).toLowerCase() + descriptor.label.slice(1)
    : descriptor.label
  if (roles.length === 1 && roles[0] === 'admin') {
    return descriptor.scope === 'host'
      ? `Only the workspace’s owners and admins, and the site’s admins, can import ${what}.`
      : `Only the workspace’s owners and admins can import ${what}.`
  }
  const named = roles.map((role) => role.charAt(0).toUpperCase() + role.slice(1)).join(', ')
  return `Importing ${what} needs one of these roles${descriptor.scope === 'host' ? ' on the site' : ''}: ${named}.`
}

/**
 * The plan feature a workspace needs to `intent` a resource's records, or
 * `null` when every plan may — no `featureFlag`, or an intent the resource
 * exempts. The entitlement itself is the caller's to resolve
 * (`checkEntitlement`), from the workspace document it already holds.
 */
export function transferPlanFeature(
  intent: TransferAccessIntent,
  descriptor: TransferPlanDeclaration | null | undefined,
): string | null {
  const feature = descriptor?.featureFlag?.trim()
  if (!feature) return null
  return descriptor?.featureFlagExempt?.includes(intent) ? null : feature
}

/** Whether a refusal's body is one for the workspace's plan. */
export function isTransferPlanRequired(body: unknown): body is TransferPlanRequiredResponse {
  return Boolean(body && typeof body === 'object' && (body as { reason?: unknown }).reason === TRANSFER_PLAN_REQUIRED)
}
