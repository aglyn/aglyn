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
 * `POST /api/crm/deal-stage` — the one writer of a deal's stage (AGL-2598).
 *
 * ## Why a route, when the rules would let the browser do it
 *
 * A deal's title, amount and owner are edited client-direct against the
 * Firestore rules, and nothing about a stage change needs a server to be
 * SAFE. What it needs a server for is to be HEARD: a move between stages, a
 * win and a loss are the three moments an automation wants — "when a deal is
 * won, email the owner", "when one reaches negotiation, file a task" — and a
 * workflow only fires on an event the tenant runtime emits. A stage written
 * by the browser would be a fact nothing could react to. So every surface
 * that moves a deal calls here, and this handler updates the document and
 * then emits `dealStageChanged`, `dealWon` or `dealLost` with a flat payload
 * a workflow filter can read.
 *
 * ## Who may call it
 *
 * Three gates, in the order the cheapest fails first:
 *
 *  1. A verified Firebase session — the console's `authorizedFetch` puts the
 *     id token on every call.
 *  2. An admin or editor role ON THIS SITE, resolved by `hostRoleFor` from
 *     the org member document, which is the same projection the rules read.
 *  3. The `data.manage` permission in the org — the key the whole CRM is
 *     gated on, resolved through the custom-role and per-member layers by
 *     `memberHasOrgPermission`, because a member document alone cannot say
 *     what a custom role took away.
 *
 * And then the deal has to be VISIBLE to the site: its `visibleTo` must
 * intersect the scope tokens a contact captured on this site would carry.
 * The Admin SDK evaluates no rules, so without this check an editor of one
 * site in an agency could move another client's deals by id.
 *
 * ## The organization variant (AGL-2634)
 *
 * `{ orgId, dealId, … }` instead of a site: the org-level hub's board. The
 * caller is authorized by the ORG — an org-wide member holding
 * `data.manage`, the org hub's own gate — and no visibility check is made,
 * because an org-wide member reads every row the org holds. The event
 * still goes to the deal's own capturing site, which is where the
 * automations that listen for it live; a deal no site captured has none to
 * tell. And the act is logged in the org's feed, since there is no one
 * site's feed it happened in.
 *
 * ## What it writes
 *
 * `stageId`, `status` (from the target stage's `kind`, never from the body),
 * `stageChangedAtMs`, `closedAtMs` (set on a close, cleared on a reopen) and
 * `lostReason` (kept on a loss, removed on anything else). A move to the
 * stage the deal is already in writes nothing and emits nothing — an
 * automation must not fire twice because a card was dropped where it was.
 */

import {
  CRM_COLLECTIONS,
  type CrmDeal,
  type CrmPipeline,
  dealStageById,
  hostRoleFor,
  hostScopeToken,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'
import {
  closingStage,
  dealEventName,
  dealEventPayload,
} from './model/deal-board-model'
import { authorizeOrgCaller, readCrmRouteScope } from './server/org-caller'

/** The most a lost reason may carry — a sentence or two, not a post-mortem. */
export const LOST_REASON_MAX = 500

export const crmDealStageHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const routeScope = readCrmRouteScope(req.body as Record<string, unknown>)
  const dealId = String(req.body?.dealId ?? '').trim()
  const stageId =
    typeof req.body?.stageId === 'string' ? req.body.stageId.trim() : ''
  const status = req.body?.status
  const closing = status === 'won' || status === 'lost' ? status : null
  const lostReason = String(req.body?.lostReason ?? '')
    .trim()
    .slice(0, LOST_REASON_MAX)
  if (!routeScope || !dealId) {
    return res.status(400).json({ error: 'Missing hostId or dealId' })
  }
  if (!stageId && !closing) {
    return res.status(400).json({
      error: 'Name a stageId to move to, or a status of won or lost.',
    })
  }

  /*
   * Who is calling, and the org whose deal it is. The site variant
   * resolves the org from the site and the caller's role on it; the org
   * variant is authorized by the org itself, and the site the body may
   * name beside it is not consulted — the deal's own site, read off the
   * document, is the one its event goes to.
   */
  let orgId: string
  let org: Record<string, unknown>
  let actor: { uid: string; email: string | null } | null = null
  if (routeScope.level === 'org') {
    const caller = await authorizeOrgCaller(req, routeScope.orgId, {
      needs: 'data.manage',
      refusal:
        'Moving a deal at the organization level requires the "Manage data" ' +
        'permission across the whole workspace.',
    })
    if (caller.ok === false) {
      return res.status(caller.status).json({ error: caller.error })
    }
    orgId = caller.orgId
    org = caller.org as Record<string, unknown>
    actor = { uid: caller.uid, email: caller.email }
  } else {
    const authorization = String(req.headers.authorization ?? '')
    const idToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthenticated' })
    }
    let uid: string
    try {
      uid = (await firebaseAdmin.app().auth().verifyIdToken(idToken)).uid
    } catch {
      return res.status(401).json({ error: 'Unauthenticated' })
    }

    const owner = await getOrgForHost(routeScope.hostId).catch(() => null)
    if (!owner) {
      return res.status(404).json({
        error: 'This site has no organization, so it has no deals.',
      })
    }
    const membership = await resolveOrgMembership(uid, owner.orgId).catch(
      () => null,
    )
    const member = membership?.member
    const hostRole = hostRoleFor(member, routeScope.hostId)
    if (!member || (hostRole !== 'admin' && hostRole !== 'editor')) {
      return res.status(403).json({
        error: 'Moving a deal needs an admin or editor role on this site.',
      })
    }
    if (!(await memberHasOrgPermission(owner.orgId, member, 'data.manage'))) {
      return res.status(403).json({
        error: 'Moving a deal requires the "Manage data" permission.',
      })
    }
    orgId = owner.orgId
    org = owner.org as Record<string, unknown>
  }

  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(orgId)
  const dealRef = orgRef.collection(CRM_COLLECTIONS.deals).doc(dealId)
  const dealSnapshot = await dealRef.get()
  if (!dealSnapshot.exists) {
    return res.status(404).json({ error: 'Unknown deal' })
  }
  const deal = dealSnapshot.data() as CrmDeal

  if (routeScope.level === 'site') {
    const group = await consentGroupForSite(routeScope.hostId, org)
    const readable = new Set<string>([
      ORG_SCOPE_TOKEN,
      ...group.hostIds.map(hostScopeToken),
    ])
    if (!(deal.visibleTo ?? []).some((token) => readable.has(token))) {
      return res.status(403).json({ error: 'This deal is not visible to this site.' })
    }
  }

  const pipelineSnapshot = await orgRef
    .collection(CRM_COLLECTIONS.pipelines)
    .doc(String(deal.pipelineId ?? ''))
    .get()
  if (!pipelineSnapshot.exists) {
    return res.status(409).json({
      error: "This deal's pipeline no longer exists, so it has no stages to move to.",
    })
  }
  const pipeline = pipelineSnapshot.data() as CrmPipeline
  const target = stageId
    ? dealStageById(pipeline, stageId)
    : closingStage(pipeline, closing as 'won' | 'lost')
  if (!target) {
    return res.status(400).json({
      error: stageId
        ? 'This pipeline has no such stage.'
        : `This pipeline has no ${closing} stage.`,
    })
  }

  const previousStageId = String(deal.stageId ?? '')
  const nextStatus = target.kind
  if (target.id === previousStageId && deal.status === nextStatus) {
    return res.status(200).json({
      ok: true,
      dealId,
      stageId: target.id,
      status: nextStatus,
      previousStageId,
      event: null,
    })
  }

  const nowMs = Date.now()
  await dealRef.update({
    stageId: target.id,
    status: nextStatus,
    stageChangedAtMs: nowMs,
    closedAtMs: nextStatus === 'open' ? null : nowMs,
    lostReason: nextStatus === 'lost' ? lostReason : FieldValue.delete(),
    updatedAt: new Date(),
  })

  const event = dealEventName(nextStatus)
  // The site whose automations hear the move: the mounted site, or at the
  // organization level the deal's own — a deal no site captured has none.
  const eventHostId =
    routeScope.level === 'site' ? routeScope.hostId : String(deal.hostId ?? '').trim()
  if (eventHostId) {
    await emitHostEvent(
      eventHostId,
      event,
      dealEventPayload(
        dealId,
        {
          ...deal,
          stageId: target.id,
          lostReason: nextStatus === 'lost' ? lostReason : undefined,
        },
        previousStageId,
      ),
    )
  }
  if (actor) {
    await logOrgActivity(
      orgId,
      actor,
      nextStatus === 'won'
        ? 'Marked deal won'
        : nextStatus === 'lost'
          ? 'Marked deal lost'
          : `Moved deal to ${target.name}`,
      { type: 'deal', id: dealId, name: String(deal.title ?? '') },
    )
  }

  return res.status(200).json({
    ok: true,
    dealId,
    stageId: target.id,
    status: nextStatus,
    previousStageId,
    event,
  })
}
