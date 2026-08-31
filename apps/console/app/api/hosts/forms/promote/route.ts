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

import { hostRoleCanPublish, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgForHost,
  isImpersonationSession,
  lockdownJsonResponse,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  isFormPromotionRefusal,
  resolveFormPromotion,
} from '../../../../../utils/promote-form-version'

/**
 * PROMOTING A FORM: make one version the one the site serves.
 *
 * ## What promotion means, and why a form cannot borrow the component answer
 *
 * A reusable component's parent document IS the published copy — the tenant
 * reads every component's tree in one collection query on each render, which
 * is what keeps composing a page to a single read — so promoting a component
 * is a copy of the version's tree onto the parent plus a move of the
 * `versionId` pointer. A form is stored the same way for the same reason, so
 * the mechanics look identical: copy `nodes`, carry `rootId`, move the
 * pointer.
 *
 * They are not identical, and the difference is the whole reason this is a
 * server route rather than one more `updateDoc` in a card. A component is only
 * ever DRAWN: the worst a bad promotion does is make a page ugly, and the page
 * still renders. A form is drawn AND it is a contract — `/api/forms/submit`
 * keys submissions on the id the form node carries, reads marketing consent
 * out of a field the document NAMES, and creates a lead from an address it
 * expects to find. Every one of those couplings is resolved by NAME at submit
 * time, so a design can break them, and breaking them is silent in every
 * case: the form still renders, the visitor still submits, the row still
 * lands, and the thing the merchant believed they were collecting is not
 * there.
 *
 * So promotion RUNS `checkFormContract` against the tree it is about to write,
 * and a violation refuses the write with the violations in the body. The
 * besigner's own Save & publish runs the same check for the same reason; this
 * route exists because promotion must also be reachable from the form's page,
 * where an author picks a version out of history and never opens the canvas
 * at all — and a second promotion path that skipped the check would make the
 * check optional.
 *
 * ## Why the check runs HERE and not only in the browser
 *
 * The rules can express "only a publisher may move `versionId`". They cannot
 * express "and only if the tree you are moving it to still names its own
 * fields", because that is a walk of a compressed node map. A console-side
 * check is advice; this is the enforcement, and it is the reason the route
 * reads the version document itself rather than accepting a tree from the
 * caller. Nothing about the design crosses the wire inbound — a client that
 * could send its own `nodes` could send a tree that passes the check and
 * publish a different one.
 *
 * Body: `{ hostId, formId, versionId }`.
 * 422 with `{ violations }` when the contract would break; the shape is the
 * pure module's own, so the console renders the same sentences the besigner
 * does without either side parsing prose.
 */

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const formId = String(body?.formId ?? '')
  const versionId = String(body?.versionId ?? '')
  if (!hostId || !formId || !versionId) {
    return Response.json(
      { error: 'Missing hostId, formId or versionId' },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // PUBLISH, not write. The `author` role edits content and may not make it
    // live — the same line the rules draw at `canPublishHostContent`, and the
    // reason this is `hostRoleCanPublish` rather than the `hostRoleCanWrite`
    // the version-create route next door uses: creating a draft version
    // changes nothing a visitor sees, and moving the pointer is the act that
    // does.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!hostRoleCanPublish(memberRole)) {
      return Response.json(
        { error: 'Publishing requires the editor or admin role' },
        { status: 403 },
      )
    }

    const ownerOrg = await getOrgForHost(hostId)
    const org = (ownerOrg?.org ?? {}) as any
    const lockdown = await getLockdownVerdict({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (lockdown) return lockdownJsonResponse(lockdown)

    const formRef = hostRef.collection('forms').doc(formId)
    const [formSnapshot, versionSnapshot] = await Promise.all([
      formRef.get(),
      formRef.collection('versions').doc(versionId).get(),
    ])
    if (!formSnapshot.exists) {
      return Response.json({ error: 'Unknown form' }, { status: 404 })
    }
    if (!versionSnapshot.exists) {
      return Response.json({ error: 'Unknown version' }, { status: 404 })
    }

    /*
     * THE CHECK, BEFORE THE WRITE — and it is the same decision the besigner's
     * publish makes, in one shared module, so the two promotion paths cannot
     * disagree about which designs may ship.
     */
    const resolved = resolveFormPromotion({
      formId,
      form: formSnapshot.data() as Record<string, unknown>,
      storedNodes: versionSnapshot.get('nodes'),
    })
    if (isFormPromotionRefusal(resolved)) {
      return Response.json(resolved.body, { status: resolved.status })
    }

    await formRef.update({
      nodes: resolved.nodes,
      ...(resolved.rootId ? { rootId: resolved.rootId } : {}),
      fields: resolved.fields,
      versionId,
      updatedAt: Timestamp.now(),
    })
    // A form files under `content`: `HostActivityTarget['type']` is a
    // PERSISTED value `activity-presenter.ts` branches on, and a member no
    // presenter knows renders as an unlinked row.
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
      'Published a version of the form',
      {
        type: 'content',
        id: formId,
        versionId,
        ...(formSnapshot.get('displayName')
          ? { name: String(formSnapshot.get('displayName')) }
          : {}),
      },
    )
    return Response.json({ ok: true, versionId }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Publish failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
