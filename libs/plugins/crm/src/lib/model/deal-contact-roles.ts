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

import {
  type CrmDealContactRole,
  type CrmPicklist,
  DEAL_CONTACT_ROLES_MAX,
  dealContactRoleFields,
  dealContactRolesOf,
  judgeDealContactRoles,
} from '@aglyn/aglyn'

/*
 * THE DEAL PAGE'S CONTACT ROLES CARD (AGL-3521), as pure functions: what
 * each edit makes of the list, and the fields one save writes.
 */

/** Why a contact cannot be added to the deal, or `null` when it can. */
export function dealContactRoleAddProblem(
  roles: readonly CrmDealContactRole[],
  contactId: string,
): string | null {
  if (!contactId) return 'Pick a contact.'
  if (roles.some((row) => row.contactId === contactId)) return 'That contact is already on this deal.'
  if (roles.length >= DEAL_CONTACT_ROLES_MAX) {
    return `A deal names at most ${DEAL_CONTACT_ROLES_MAX} contacts.`
  }
  return null
}

/** `roles` with one contact added — as the Primary, when asked, which every other row then is not. */
export function dealContactRolesAdded(
  roles: readonly CrmDealContactRole[],
  added: { contactId: string; role?: string; primary: boolean },
): CrmDealContactRole[] {
  const row: CrmDealContactRole = {
    contactId: added.contactId,
    ...(added.role ? { role: added.role } : {}),
    primary: added.primary,
  }
  return [...roles.map((entry) => (added.primary ? { ...entry, primary: false } : entry)), row]
}

/** `roles` with one contact's role set — `''` for none. */
export function dealContactRolesWithRole(
  roles: readonly CrmDealContactRole[],
  contactId: string,
  role: string,
): CrmDealContactRole[] {
  return roles.map((row) => {
    if (row.contactId !== contactId) return row
    return { contactId: row.contactId, ...(role ? { role } : {}), primary: row.primary }
  })
}

/**
 * What a save of the card writes: the roles judged against the org's list
 * (a contact's current role kept), `contactId` as their Primary — `null`
 * for a field the caller deletes — and whether the Primary changed, which
 * is when the name the drawer copied beside `contactId` goes stale.
 */
export function dealContactRolesSave(
  deal: { contactId?: unknown; contactRoles?: unknown },
  next: readonly CrmDealContactRole[],
  picklist: CrmPicklist,
):
  | {
      ok: true
      contactRoles: CrmDealContactRole[]
      contactId: string | null
      primaryChanged: boolean
    }
  | { ok: false; error: string } {
  const judged = judgeDealContactRoles(picklist, next, dealContactRolesOf(deal))
  if (judged.ok === false) return judged
  const fields = dealContactRoleFields(judged.roles)
  const before = typeof deal.contactId === 'string' && deal.contactId ? deal.contactId : null
  return { ok: true, ...fields, primaryChanged: fields.contactId !== before }
}
