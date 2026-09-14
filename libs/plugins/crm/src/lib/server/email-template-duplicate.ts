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
 * Duplicating a CRM email template (AGL-2936).
 *
 * A template is a letter under a name — subject, body, merge fields — in
 * `crmEmailTemplates` under the organization, scoped to a site or shared
 * across the workspace by the tokens it carries. The copy keeps the letter,
 * the kind and the scope; it is filed under the person copying it, and a
 * personal template stays personal to THEM rather than to the original's
 * owner. The listing's ceiling refuses a copy the way the create drawer
 * refuses a new one.
 *
 * Reached from a site — the host role decides — or from the organization
 * hub, where an org-wide seat does. Both scopes land in the same
 * collection, so the copy is looked up where the source was found.
 */

import {
  DUPLICATE_BUSY_MESSAGE,
  duplicateDisplayName,
  uniqueDuplicateName,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import {
  CRM_EMAIL_TEMPLATES_LIMIT,
  CRM_EMAIL_TEMPLATE_NAME_MAX,
  normalizeCrmEmailTemplate,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import {
  claimAttempt,
  createResourceUid,
  hostRoleCanWrite,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  logResourceDuplicated,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { readCrmRouteScope } from './org-caller'

export const CRM_EMAIL_TEMPLATE_DUPLICATE_ROUTE = 'crm/email-template-duplicate'

export const crmEmailTemplateDuplicateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const scope = readCrmRouteScope(req.body as Record<string, unknown>)
  if (!scope) return res.status(400).json({ error: 'Missing hostId or orgId' })
  const templateId = String(req.body?.templateId ?? '').trim().slice(0, 64)
  if (!templateId) return res.status(400).json({ error: 'Missing templateId' })
  const requestedName = String(req.body?.name ?? '').trim().slice(0, CRM_EMAIL_TEMPLATE_NAME_MAX)
  const attemptKey = String(req.body?.attemptKey ?? '').trim().slice(0, 200)

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    let decoded: { uid: string; email?: string; staff?: unknown }
    try {
      decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    } catch (error) {
      if (isRefusedIdToken(error)) return res.status(401).json({ error: 'Unauthenticated' })
      throw error
    }
    const firestore = firebaseAdmin.app().firestore()
    const staff = decoded.staff === true

    // WHO MAY COPY: on a site, anyone who may write its content; from the
    // hub, an org-wide seat. The org is resolved from the site rather than
    // taken from the body, so a caller cannot name a workspace where their
    // seat is more generous than it is in the one that owns the site.
    let orgId = scope.orgId
    if (scope.level === 'site') {
      const host = await firestore.collection('hosts').doc(scope.hostId).get()
      if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
      const role = (host.get('memberRoles') ?? {})[decoded.uid]
      if (!staff && !hostRoleCanWrite(role)) {
        return res.status(403).json({ error: 'Editing requires the editor role' })
      }
      orgId = (await resolveOrgIdForHost(scope.hostId)) ?? ''
    } else if (!staff) {
      const membership = await resolveOrgPermissions(decoded.uid, { orgId }).catch(
        () => null,
      )
      if (!membership?.orgWide || membership.orgId !== orgId) {
        return res.status(403).json({ error: 'Not a member of this organization' })
      }
    }
    if (!orgId) return res.status(404).json({ error: 'Unknown organization' })

    const claimed = attemptKey
      ? await claimAttempt(firestore as never, {
          kind: 'duplicate-emailTemplate',
          scopeId: `${orgId}:${templateId}`,
          orgId,
          key: attemptKey,
          busyMessage: DUPLICATE_BUSY_MESSAGE,
        })
      : null
    if (claimed && 'replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    const claim = claimed && 'claim' in claimed ? claimed.claim : null

    const templates = firestore
      .collection('orgs')
      .doc(orgId)
      .collection(CRM_COLLECTIONS.emailTemplates)
    const id = createResourceUid()
    const outcome = await firestore.runTransaction(async (transaction) => {
      const [source, siblings] = await Promise.all([
        transaction.get(templates.doc(templateId)),
        transaction.get(templates.select('name')),
      ])
      if (!source.exists) {
        return { status: 404 as const, body: { error: 'Unknown template' } }
      }
      if (siblings.size >= CRM_EMAIL_TEMPLATES_LIMIT) {
        return {
          status: 403 as const,
          body: {
            error:
              `This workspace holds ${CRM_EMAIL_TEMPLATES_LIMIT} email templates — ` +
              'delete one to make room',
          },
        }
      }
      const template = normalizeCrmEmailTemplate(source.data() as Record<string, unknown>)
      const name = uniqueDuplicateName(
        requestedName || duplicateDisplayName(template.name),
        siblings.docs.map((row) => String(row.get('name') ?? '')),
      ).slice(0, CRM_EMAIL_TEMPLATE_NAME_MAX)
      const nowMs = Date.now()
      transaction.create(templates.doc(id), {
        name,
        subject: template.subject,
        body: template.body,
        kind: template.kind,
        visibility: template.visibility,
        ...(template.visibility === 'personal' ? { ownerUid: decoded.uid } : {}),
        createdByUid: decoded.uid,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        hostId: template.hostId,
        visibleTo: [...template.visibleTo],
        createdAt: new Date(nowMs),
        updatedAt: new Date(nowMs),
      })
      return {
        status: 200 as const,
        body: { templateId: id, name },
        sourceName: template.name,
        hostId: template.hostId,
      }
    })

    if (outcome.status !== 200) {
      await claim?.release()
      return res.status(outcome.status).json(outcome.body)
    }
    await logResourceDuplicated(
      'emailTemplate',
      { uid: decoded.uid, email: decoded.email ?? null },
      {
        orgId,
        hostId: outcome.hostId,
        source: { id: templateId, name: outcome.sourceName },
        target: { id, name: outcome.body.name },
      },
    )
    await claim?.record(200, outcome.body)
    return res.status(200).json(outcome.body)
  } catch (error) {
    console.error('[crm] the email template could not be duplicated', error)
    return res.status(500).json({ error: 'The template could not be duplicated.' })
  }
}
