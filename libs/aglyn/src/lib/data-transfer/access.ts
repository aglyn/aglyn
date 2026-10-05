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

import type { TransferResourceDescriptor } from './resource'
import type { TransferApiRoute } from './transfer-api'

/*==========================================
 * WHO MAY MOVE A RESOURCE'S RECORDS (AGL-3546)
 *
 * Two intents, answered the same way by the transfer routes' gate and by the
 * console's display of Import and Export, so a button is never offered that
 * the route refuses:
 *
 *  - IMPORT (upload, analyze, plan, apply, status, undo — and the job list
 *    and packages, which the gate asks with the same intent) writes records, and
 *    needs `data.manage` — on the named site, or on the workspace.
 *  - EXPORT (export, and `fields`, which the export dialog opens with) only
 *    reads them, and asks what the resource declares: `readableByMembers`
 *    admits any member (a collaborator who reaches the named site), the
 *    way datasets are read; a `readPermission` admits whoever holds it; and
 *    a resource that declares neither keeps `data.manage`, because its
 *    records may be ones the rules let only managers read (CRM contacts).
 *    `data.manage` always admits. Which records a reader then sees is the
 *    resource's own business: `readPage` and `count` honor the reader's
 *    `scopeTokens`, as every other door onto the records does.
 *==========================================*/

/** What a resource declares about who may read its records. */
export type TransferReadDeclaration = Pick<TransferResourceDescriptor, 'readPermission' | 'readableByMembers'>

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
}

/** Whether a member may `intent` a resource's records: see the block above. */
export function transferAccessAllowed(
  intent: TransferAccessIntent,
  descriptor: TransferReadDeclaration | null | undefined,
  axis: TransferMemberAxis,
): boolean {
  if (!axis.reachesSite) return false
  const needed = transferAccessPermissions(intent, descriptor)
  return !needed.length || needed.some((permission) => axis.holds(permission))
}
