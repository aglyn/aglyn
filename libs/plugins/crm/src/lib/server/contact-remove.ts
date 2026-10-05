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
 * `POST /api/crm/contact-remove` — a holder lets contacts go, and a person's
 * "no" to marketing stays (AGL-3338).
 *
 * Body: `{ hostId, contactIds }` under a site, or `{ orgId, hostId?,
 * contactIds }` at the organization level. Answers `ContactRemoveResponse`:
 * one outcome per contact, in the order the ids were sent.
 *
 * ## Delete is a detach, and a refusal is not let go
 *
 * A contact is shared by every site that captured the person. Removing it
 * from one drops that holder's facet, consent grants, capture attribution
 * and scope tokens, and the document is deleted only when nobody else holds
 * it (`planContactDetach`). A refusal of marketing email is kept either way:
 * a detach leaves it on the document for the holders that remain, and the
 * last holder's delete copies every refusal into the organization's retained
 * store in the same transaction (`removeContactKeepingRefusals`). The list
 * gate reads both, so deleting a person is not a way to put somebody who
 * said no on a list.
 *
 * ## Why a route
 *
 * The decision has to be made against the document's consent map, which a
 * table row does not project, and it has to land in one commit with the
 * retained store, which no client may write. So the rules close a client's
 * update and delete of a contact, and the console's removals arrive here.
 *
 * ## Who may call it
 *
 * The CRM writer the other contact routes admit (`authorizeCrmWriter`),
 * whose access reaches the site under a site. Each contact must be one the
 * caller may read and, under a site, one the site's hub lists. Then, as the
 * rules asked before the route existed:
 *
 *  - a DELETE needs the caller's reach to cover every holder of the row, so
 *    a site collaborator cannot delete a person another site also holds;
 *  - a DETACH changes who a record is shared with, which only an org-wide
 *    member may do (`scopeUnchanged()` in the rules).
 *
 * ## The plan
 *
 * Letting a holder go is the CRM's "Remove from this site", included from
 * Starter (AGL-2851), so a detach is refused on a plan without the CRM. A
 * delete is not: removing a workspace's own record stays open on every plan.
 */

import {
  consentGroupForHost,
  CRM_COLLECTIONS,
  crmReadTokens,
  heldScopeTokens,
  isOrgWideMember,
  memberScopeTokens,
  planContactDetach,
  type PluginApiHandler,
  seenOnlyThroughGrant,
  visibleToTokens,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  removeContactKeepingRefusals,
  restampCrmListFieldsOf,
} from '@aglyn/tenant-data-admin'
import {
  type ContactRemoveOutcome,
  type ContactRemoveResponse,
  CRM_CONTACT_REMOVE_MAX,
} from '../model/contact-remove'
import { typed } from './contact-profile'
import { readCrmRouteScope } from './org-caller'
import { crmSuiteRefusal } from './suite-gate'
import { authorizeCrmWriter, canReach, type Writer } from './task-routes'
import { contactPrimaryGroup } from '../model/contact-holder'
import { sweepDealContactRoles } from './deal-contact-roles'
import { clearReportsToOf, contactFacetHolders } from './contact-reports-to'

/** What the suite gate names for a detach on a plan without the CRM. */
export const CONTACT_DETACH_SUITE_ACT = 'Removing a contact from one site'

/**
 * What a site is told for a contact it sees only because it was SHARED with
 * it (AGL-3336): it holds nothing there to let go of, and taking the share
 * away is a manager's unshare, not a removal.
 */
export const CONTACT_REMOVE_SHARED_REFUSAL =
  'This contact was shared with this site by another site. An owner or ' +
  'admin can stop sharing it from its Sharing card.'

/** A contact read at the organization level that no site has captured. */
export const CONTACT_REMOVE_NO_HOLDER =
  'No site holds this contact yet, so there is no site to remove it from.'

/** What a site collaborator is told for a person another site also holds. */
export const CONTACT_REMOVE_SCOPED_REFUSAL =
  'Other sites hold this contact too, and your access is limited to ' +
  'specific sites. Ask an organization administrator to remove it.'

/** How many contacts are removed at once — each in its own transaction. */
const CONCURRENCY = 20

const refused = (contactId: string, error: string): ContactRemoveOutcome => ({
  contactId,
  ok: false,
  error,
})

/** The ids a body names, deduplicated — or `null` when any is unreadable or there are too many. */
function readContactIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > CRM_CONTACT_REMOVE_MAX) {
    return null
  }
  const ids = value.map((id) => typed(id, 200))
  if (ids.some((id) => !id || id.includes('/'))) return null
  return [...new Set(ids)]
}

/** Under a site, whether the caller's access reaches it. */
function reachesSite(writer: Writer, hostId: string): boolean {
  return (
    writer.staff ||
    isOrgWideMember(writer.member) ||
    Boolean((writer.member?.hostAccess as Record<string, unknown> | undefined)?.[hostId])
  )
}

/** Whether the caller's reach is the whole organization. */
const orgWide = (writer: Writer): boolean =>
  writer.staff || writer.level === 'org' || isOrgWideMember(writer.member)

export const crmContactRemoveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const contactIds = readContactIds(body['contactIds'])
  if (!contactIds) {
    res.status(400).json({ error: `Name between 1 and ${CRM_CONTACT_REMOVE_MAX} contacts.` })
    return
  }

  try {
    const writer = await authorizeCrmWriter(req, scope, { suiteAct: null })
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    if (scope.level === 'site' && !reachesSite(writer, scope.hostId)) {
      res.status(403).json({ error: 'Your access to this organization does not reach this site.' })
      return
    }

    const firestore = firebaseAdmin.app().firestore()
    const contacts = firestore.collection('orgs').doc(writer.orgId).collection('contacts')
    const siteGroup =
      scope.level === 'site' ? consentGroupForHost(writer.org, scope.hostId) : null
    const siteTokens = siteGroup ? crmReadTokens(siteGroup) : null
    const suite = crmSuiteRefusal(writer.org, CONTACT_DETACH_SUITE_ACT)
    const callerTokens = new Set<string>(memberScopeTokens(writer.member))
    const nowMs = Date.now()

    /*
     * Decided inside each contact's transaction, against the document as it
     * was read there: the reach, the holder letting go, and what that means.
     */
    const decide = (contact: Record<string, unknown>) => {
      const visibleTo = contact['visibleTo'] as string[] | undefined
      if (!canReach(writer, visibleTo)) return { refused: 'That contact is not visible to you.' }
      if (siteTokens && !visibleToTokens(visibleTo, siteTokens)) {
        return { refused: 'That contact is not visible to this site.' }
      }
      if (siteGroup && siteGroup.hostIds.every((hostId) => seenOnlyThroughGrant(contact, hostId))) {
        return { refused: CONTACT_REMOVE_SHARED_REFUSAL }
      }
      const group = siteGroup ?? contactPrimaryGroup(contact, writer.org)
      if (!group.groupId || !group.hostIds.length) return { refused: CONTACT_REMOVE_NO_HOLDER }
      const plan = planContactDetach(contact, group)
      if (plan.action === 'delete') {
        // The HOLDERS: a site the contact was only shared with holds
        // nothing, so it never stands between a holder and its delete.
        const holders = heldScopeTokens(contact)
        if (!orgWide(writer) && !holders.every((token) => callerTokens.has(token))) {
          return { refused: CONTACT_REMOVE_SCOPED_REFUSAL }
        }
        return plan
      }
      if (!orgWide(writer)) return { refused: CONTACT_REMOVE_SCOPED_REFUSAL }
      if (suite) return { refused: suite.body.error }
      return plan
    }

    const outcomes = new Map<string, ContactRemoveOutcome>()
    const detached: FirebaseFirestore.DocumentReference[] = []
    /*
     * The holders whose facets may point at each removed contact as their
     * reports-to (AGL-3537), as decided: every holder of a deleted contact,
     * and the one letting go of a detached one — which no longer holds the
     * person it would point at.
     */
    const lettingGo = new Map<string, string[]>()
    const deciding = (contactId: string) => (contact: Record<string, unknown>) => {
      const decided = decide(contact)
      if (!('refused' in decided)) {
        lettingGo.set(
          contactId,
          decided.action === 'delete'
            ? contactFacetHolders(contact)
            : [(siteGroup ?? contactPrimaryGroup(contact, writer.org)).groupId],
        )
      }
      return decided
    }
    for (let at = 0; at < contactIds.length; at += CONCURRENCY) {
      await Promise.all(
        contactIds.slice(at, at + CONCURRENCY).map(async (contactId) => {
          const contactRef = contacts.doc(contactId)
          try {
            const removal = await removeContactKeepingRefusals({
              contactRef,
              decide: deciding(contactId),
              nowMs,
            })
            if (removal.outcome === 'missing') {
              outcomes.set(contactId, refused(contactId, 'That contact no longer exists.'))
            } else if (removal.outcome === 'refused') {
              outcomes.set(contactId, refused(contactId, removal.error))
            } else if (removal.outcome === 'detached') {
              detached.push(contactRef)
              outcomes.set(contactId, { contactId, ok: true, removed: 'detached' })
              // The holder letting go points at the person no more (AGL-3537).
              await clearReportsToOf(firestore, contacts, lettingGo.get(contactId) ?? [], contactId)
            } else {
              outcomes.set(contactId, { contactId, ok: true, removed: 'deleted' })
              // Nobody reports to a deleted person (AGL-3537)…
              await clearReportsToOf(firestore, contacts, lettingGo.get(contactId) ?? [], contactId)
              // …and they leave every deal's contact roles (AGL-3521).
              await sweepDealContactRoles(
                firestore,
                firestore.collection('orgs').doc(writer.orgId).collection(CRM_COLLECTIONS.deals),
                contactId,
                null,
                '[crm] contact-remove',
              )
            }
          } catch (error) {
            console.error('[crm] contact-remove could not remove a contact', contactId, error)
            outcomes.set(contactId, refused(contactId, 'The contact could not be removed.'))
          }
        }),
      )
    }
    // A detached row still carries the facet keys and scoped search tokens of
    // the holder that let it go, which the Contacts list filters by (AGL-3321).
    // Its own catch: the contacts are removed by now, and a list stamp that
    // could not move is not a removal that failed.
    if (detached.length) {
      await restampCrmListFieldsOf(detached, 'contacts').catch((error: unknown) => {
        console.error('[crm] contact-remove could not restamp list fields', error)
      })
    }

    const answer: ContactRemoveResponse = {
      ok: true,
      results: contactIds.map(
        (contactId) =>
          outcomes.get(contactId) ?? refused(contactId, 'The contact could not be removed.'),
      ),
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] contact-remove failed', error)
    res.status(500).json({ error: 'The contacts could not be removed.' })
  }
}
