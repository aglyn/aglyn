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
 * `POST /api/crm/company-delete` — unlink the contacts that name a company,
 * then delete it (AGL-2804).
 *
 * Body: `{ hostId, companyId }` under a site, or `{ orgId, companyId }` at
 * the organization level. Answers `CompanyDeleteResponse`.
 *
 * ## Why a route
 *
 * Firestore does not cascade. A company deleted on its own leaves every
 * contact at it naming a record that no longer exists: their page links to
 * nothing and the `companyIds` mirror the company list queries keeps
 * matching a ghost. So a delete is a detach pass and then a delete, and the
 * detach clears each holder's facet that named the company — which the rules
 * refuse a client, because they cannot tell a company link inside a facet
 * from an owner or a stage beside it.
 *
 * ## Bounded, and honest past the bound
 *
 * One pass unlinks at most `COMPANY_DETACH_LIMIT` contacts, a batch's worth.
 * A company past that is left standing with a pass's worth unlinked, and the
 * answer says more remain, so the next delete continues where this one
 * stopped. A company is never deleted with a link still on a contact.
 *
 * ## Who may call it
 *
 * A CRM writer (`authorizeCrmWriter`) whose reach is the whole organization.
 * The contacts are found by the mirror, and that query cannot carry a scope
 * clause beside its `array-contains`: a member scoped to particular sites
 * could not read them in the browser either, and the route does not unlink
 * people on behalf of someone who may not see them.
 *
 * ## Every plan
 *
 * Deleting is not the CRM suite's. A workspace removes its own records on
 * any plan, as the rules let it (AGL-2801), so no plan is asked here.
 */

import {
  CONTACT_COMPANY_IDS_FIELD,
  contactFacetPath,
  contactGroupsNamingCompany,
  CRM_COLLECTIONS,
  isOrgWideMember,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  COMPANY_DETACH_LIMIT,
  type CompanyDeleteResponse,
} from '../model/company-delete-route'
import { typed } from './contact-profile'
import { readCrmRouteScope } from './org-caller'
import { authorizeCrmWriter, canReach } from './task-routes'

/** What a member scoped to particular sites is told. */
export const COMPANY_DELETE_SCOPED_REFUSAL =
  'Your access is limited to specific sites, so the contacts at this company ' +
  'could not be read to unlink them. Ask an organization administrator to delete it.'

/**
 * A contact's update when a company it names is deleted: the id out of the
 * mirror, and out of every holder's facet that named it. Another holder's
 * link to a different company is not read or written.
 */
function companyDetachFields(
  contact: Record<string, unknown>,
  companyId: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    [CONTACT_COMPANY_IDS_FIELD]: FieldValue.arrayRemove(companyId),
    updatedAt: FieldValue.serverTimestamp(),
  }
  for (const groupId of contactGroupsNamingCompany(contact, companyId)) {
    update[contactFacetPath(groupId, 'companyId')] = FieldValue.delete()
  }
  return update
}

export const crmCompanyDeleteHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  const companyId = typed(body['companyId'], 200)
  if (!scope || !companyId || companyId.includes('/')) {
    res.status(400).json({ error: 'Missing hostId or companyId' })
    return
  }

  try {
    const writer = await authorizeCrmWriter(req, scope, { suiteAct: null })
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    if (!(writer.staff || writer.level === 'org' || isOrgWideMember(writer.member))) {
      res.status(403).json({ error: COMPANY_DELETE_SCOPED_REFUSAL })
      return
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(writer.orgId)
    const companyRef = orgRef.collection(CRM_COLLECTIONS.companies).doc(companyId)
    const company = await companyRef.get()
    if (!company.exists || !canReach(writer, company.get('visibleTo'))) {
      res.status(404).json({ error: 'That company no longer exists.' })
      return
    }

    // One past the bound, so "more remain" is a fact from the probe row
    // rather than a guess from a full page.
    const probe = await orgRef
      .collection('contacts')
      .where(CONTACT_COMPANY_IDS_FIELD, 'array-contains', companyId)
      .limit(COMPANY_DETACH_LIMIT + 1)
      .get()
    const linked = probe.docs.slice(0, COMPANY_DETACH_LIMIT)
    const moreRemain = probe.docs.length > COMPANY_DETACH_LIMIT
    if (linked.length) {
      const batch = firestore.batch()
      for (const snapshot of linked) {
        batch.update(
          snapshot.ref,
          companyDetachFields(snapshot.data() as Record<string, unknown>, companyId),
        )
      }
      await batch.commit()
    }
    if (!moreRemain) await companyRef.delete()

    const answer: CompanyDeleteResponse = {
      ok: true,
      deleted: !moreRemain,
      detached: linked.length,
      moreRemain,
    }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] company-delete failed', companyId, error)
    res.status(500).json({ error: 'The company could not be deleted.' })
  }
}
