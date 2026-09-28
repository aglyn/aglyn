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
  type ConsentGroupSiteHold,
  consentGroupSiteHold,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { holdsDedicatedSendingDomain } from '@aglyn/aglyn/app-utils/dedicated-sending-domain'
import type { HostTransferHold, HostTransferPlan } from '@aglyn/aglyn/app-utils/host-transfer'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { listPluginOrgCollections } from '@aglyn/aglyn/plugin-manager/plugin-host-collections'
import { normalizeSendingDomain } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import {
  deleteHostProjectionForAllMembers,
  syncHostProjectionForMembers,
} from './host-memberships'
import { syncOrgAuthProjections } from './organizations'
import { SENDING_LABELS_COLLECTION } from './host-sending-domain'
import { SENDING_DOMAINS_COLLECTION } from './sending-domains'
import { TRACKING_HOSTS_COLLECTION } from './tracking-hosts'

/*
 * MOVING A SITE TO ANOTHER ORGANIZATION (AGL-3381).
 *
 * A site's CONTENT lives under `hosts/{hostId}` and goes wherever the site
 * goes: pages, layouts, versions, forms and their submissions, its members,
 * collections, orders. What ties it to its organization is a handful of
 * pointers and projections, and those are what a transfer rewrites:
 *
 *   hosts/{hostId}           orgId, and memberRoles / memberPermissions
 *                            recomputed from the NEW roster (replaced whole,
 *                            so the old organization's people drop out)
 *   hostIndex/{hostId}       orgId — how routing resolves the owner
 *   orgs/{from}              hosts[hostId], and the site's paid seat pools
 *                            (registerAllocations, collaboratorAllocations)
 *                            released back to the old organization
 *   orgs/{from}/members/*    hostAccess[hostId], hostPermissions[hostId]
 *   users/{uid}/hostMemberships/{hostId}
 *                            the old members' rows deleted, the new ones'
 *                            written
 *   orgs/{to}                hosts[hostId]
 *
 * The dedicated sending domain moves with it, because the reputation a
 * domain has earned is the site's: its record and its click-tracking host
 * move from `orgs/{from}` to `orgs/{to}`, and the label claim names the new
 * organization. It moves only to an organization whose plan may hold one.
 *
 * ## What stays with the old organization, and why
 *
 *   Media        `orgs/{from}/media`, stored under that organization's own
 *                object prefix. Published pages reference it by address, so
 *                the site keeps showing it; moving it would mean copying
 *                objects and rewriting every page version that names them.
 *                The plan counts it so staff can say so.
 *   Records the site filed for its organization — CRM, datasets, lists —
 *                are that organization's customer data.
 *   Plugin documents a site OWNS on the organization (a declared
 *                `siteField`, e.g. sends made as the site) stay as the old
 *                organization's history: they name its lists, its
 *                containers and the consent it relied on. A plugin that has
 *                work still in flight on them (`holdsTransferWhile`) holds
 *                the transfer until it lands or is cancelled.
 *
 * ## What refuses a transfer
 *
 *   the site or either organization is missing, or it is already there;
 *   the site is in a consent group, or a group change naming it is running
 *     (its refusals are read by its siblings — it leaves the group first);
 *   the destination is at its site limit, unless staff override it;
 *   the site holds a dedicated sending domain the destination's plan
 *     cannot hold (release it first);
 *   a plugin reports work in flight on documents the site owns.
 */

const firestore = () => firebaseAdmin.app().firestore()

export type { HostTransferHold, HostTransferPlan } from '@aglyn/aglyn/app-utils/host-transfer'

export interface PlanHostTransferInput {
  hostId: string
  toOrgId: string
  /** Staff may place a site past the destination's site limit. */
  overrideSiteLimit?: boolean
}

const count = async (query: FirebaseFirestore.Query): Promise<number> =>
  (await query.count().get()).data().count

const consentHoldMessage = (hold: ConsentGroupSiteHold): string =>
  hold.reason === 'grouped'
    ? `The site is in the consent group "${hold.name}". Remove it from the group first — its opt-outs are read by the other sites in it.`
    : 'A consent group change naming this site has not finished. Wait for it, then transfer.'

/** How many sites an organization holds: its directory or its query, whichever is larger. */
async function sitesHeld(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  org: Record<string, unknown>,
): Promise<number> {
  const directory = org['hosts']
  const mapped =
    directory && typeof directory === 'object'
      ? Object.values(directory as Record<string, unknown>).filter(Boolean).length
      : 0
  const queried = await count(db.collection('hosts').where('orgId', '==', orgId))
  return Math.max(mapped, queried)
}

/**
 * The transfer, worked out and not performed. Read only: safe to call for a
 * confirmation dialog, and called again by {@link transferHost} so what runs
 * is what was decided a moment ago, not what was true when the dialog opened.
 */
export async function planHostTransfer(input: PlanHostTransferInput): Promise<HostTransferPlan> {
  const db = firestore()
  const hostId = String(input.hostId ?? '').trim()
  const toOrgId = String(input.toOrgId ?? '').trim()
  const holds: HostTransferHold[] = []
  const warnings: string[] = []
  const host = hostId ? await db.collection('hosts').doc(hostId).get() : null
  const hostData = (host?.exists ? host.data() : null) ?? null
  const fromOrgId = typeof hostData?.['orgId'] === 'string' ? (hostData['orgId'] as string) : null
  const [fromOrg, toOrg] = await Promise.all([
    fromOrgId ? db.collection('orgs').doc(fromOrgId).get() : Promise.resolve(null),
    toOrgId ? db.collection('orgs').doc(toOrgId).get() : Promise.resolve(null),
  ])
  const fromData = (fromOrg?.exists ? fromOrg.data() : null) ?? null
  const toData = (toOrg?.exists ? toOrg.data() : null) ?? null

  const plan: HostTransferPlan = {
    hostId,
    siteName: (hostData?.['displayName'] as string | undefined) ?? null,
    fromOrgId,
    fromOrgName: (fromData?.['name'] as string | undefined) ?? null,
    toOrgId,
    toOrgName: (toData?.['name'] as string | undefined) ?? null,
    holds,
    warnings,
    facts: {
      mediaStaying: 0,
      ownedDocumentsStaying: [],
      collaboratorsLosingAccess: 0,
      sendingDomain: null,
      pluginsLost: [],
      siteLimit: { used: 0, limit: 0, allowed: true },
    },
  }

  if (!hostData) {
    holds.push({ code: 'no-site', message: 'There is no such site.' })
    return plan
  }
  if (!toData) {
    holds.push({ code: 'no-destination', message: 'There is no such destination organization.' })
    return plan
  }
  if (fromOrgId === toOrgId) {
    holds.push({ code: 'same-organization', message: 'The site already belongs to that organization.' })
    return plan
  }

  // Consent: the site's refusals are its siblings' too.
  const consentHold = fromData ? consentGroupSiteHold(fromData, hostId) : null
  if (consentHold) holds.push({ code: 'consent-group', message: consentHoldMessage(consentHold) })

  // The destination's site limit, counted the way site creation counts it.
  const used = await sitesHeld(db, toOrgId, toData)
  const quota = checkQuota(toData as never, 'hostLimit', used)
  plan.facts.siteLimit = { used, limit: quota.limit, allowed: quota.allowed }
  if (!quota.allowed) {
    if (input.overrideSiteLimit) {
      warnings.push(
        `The destination is at its site limit (${used} of ${quota.limit}); the transfer places this site past it.`,
      )
    } else {
      holds.push({
        code: 'site-limit',
        message: `The destination holds ${used} of its ${quota.limit} sites. Raise its limit, or override it.`,
      })
    }
  }

  // The dedicated sending domain moves only to a plan that may hold one.
  const sendingDomain = normalizeSendingDomain(String(hostData['sendingDomain'] ?? '')) || null
  const sendingLabel = String(hostData['sendingLabel'] ?? '').trim()
  if (sendingLabel || sendingDomain) {
    plan.facts.sendingDomain = sendingDomain ?? sendingLabel
    if (!holdsDedicatedSendingDomain(toData as never)) {
      holds.push({
        code: 'sending-domain',
        message:
          `The site sends as ${plan.facts.sendingDomain}, and the destination's plan cannot hold a ` +
          'dedicated sending domain. Release it from the site first, or raise the destination’s plan.',
      })
    } else {
      warnings.push(`The dedicated sending domain ${plan.facts.sendingDomain} moves with the site.`)
    }
  }

  if (fromOrgId) {
    // Plugin documents the site owns on the old organization, and any still
    // in flight — each plugin's own declaration says which field and which
    // states, so no collection is named here.
    for (const declared of listPluginOrgCollections()) {
      if (!declared.siteField) continue
      const owned = db
        .collection('orgs')
        .doc(fromOrgId)
        .collection(declared.name)
        .where(declared.siteField, '==', hostId)
      const held = await count(owned).catch(() => 0)
      if (held) plan.facts.ownedDocumentsStaying.push({ collection: declared.name, count: held })
      const hold = declared.holdsTransferWhile
      if (held && hold) {
        const moving = await count(owned.where(hold.field, 'in', hold.values)).catch(() => 0)
        if (moving) {
          holds.push({
            code: 'in-flight',
            message:
              `${moving} ${declared.label ?? declared.name} of this site ${moving === 1 ? 'is' : 'are'} ` +
              `still ${hold.values.join(' or ')}. Let ${moving === 1 ? 'it' : 'them'} finish or cancel ` +
              `${moving === 1 ? 'it' : 'them'} first.`,
          })
        }
      }
    }
    if (plan.facts.ownedDocumentsStaying.length) {
      warnings.push(
        'Records the site made for its old organization (' +
          plan.facts.ownedDocumentsStaying.map((row) => `${row.count} ${row.collection}`).join(', ') +
          ') stay there as its history.',
      )
    }

    plan.facts.mediaStaying = await count(
      db
        .collection('orgs')
        .doc(fromOrgId)
        .collection('media')
        .where('visibleTo', 'array-contains', hostScopeToken(hostId)),
    ).catch(() => 0)
    if (plan.facts.mediaStaying) {
      warnings.push(
        `${plan.facts.mediaStaying} media file(s) stay in the old organization's library. The site keeps ` +
          'showing them, but only the old organization can manage them — deleting them there removes them from this site.',
      )
    }

    // Collaborators: old members who reached this site only through a grant.
    const members = await db.collection('orgs').doc(fromOrgId).collection('members').get()
    plan.facts.collaboratorsLosingAccess = members.docs.filter(
      (member) =>
        member.get('allHosts') !== true &&
        member.get('role') !== 'owner' &&
        Boolean((member.get('hostAccess') ?? {})[hostId]),
    ).length
    if (plan.facts.collaboratorsLosingAccess) {
      warnings.push(
        `${plan.facts.collaboratorsLosingAccess} collaborator(s) of the old organization lose access to the site.`,
      )
    }

    const before = resolveHostEnabledPlugins(fromData as never, hostData as never)
    const after = new Set(resolveHostEnabledPlugins(toData as never, hostData as never))
    plan.facts.pluginsLost = before.filter((id) => !after.has(id))
    if (plan.facts.pluginsLost.length) {
      warnings.push(
        `The destination does not enable ${plan.facts.pluginsLost.join(', ')}; what they draw on the site stops rendering.`,
      )
    }
  }

  if (toData['suspendedAt']) {
    warnings.push('The destination organization is suspended, so the site goes offline with it.')
  }
  return plan
}

/** A transfer refused by its plan: nothing was written. */
export class HostTransferRefusedError extends Error {
  readonly plan: HostTransferPlan

  constructor(plan: HostTransferPlan) {
    super(plan.holds.map((hold) => hold.message).join(' '))
    this.name = 'HostTransferRefusedError'
    this.plan = plan
  }
}

/** Move one document from one path to another, deleting the original. */
async function moveDocument(
  from: FirebaseFirestore.DocumentReference,
  to: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const snapshot = await from.get()
  if (!snapshot.exists) return false
  await to.set(snapshot.data() ?? {})
  await from.delete()
  return true
}

/**
 * Move a site to another organization (AGL-3381). Re-plans first and refuses
 * — writing nothing — when the plan holds; see the header for what moves,
 * what stays, and why.
 *
 * The ownership flip is one transaction over the site and both organization
 * documents, re-reading the site's organization inside it, so two transfers
 * of one site cannot both land. Everything after it is a projection of that
 * flip, recomputed from the documents rather than carried from the plan, so
 * a failure part-way is finished by running the transfer's projections
 * again ({@link syncOrgAuthProjections} and the membership sync).
 */
export async function transferHost(input: PlanHostTransferInput): Promise<HostTransferPlan> {
  const plan = await planHostTransfer(input)
  if (plan.holds.length || !plan.fromOrgId) throw new HostTransferRefusedError(plan)
  const db = firestore()
  const { hostId, toOrgId } = plan
  const fromOrgId = plan.fromOrgId
  const hostRef = db.collection('hosts').doc(hostId)
  const fromRef = db.collection('orgs').doc(fromOrgId)
  const toRef = db.collection('orgs').doc(toOrgId)

  await db.runTransaction(async (tx) => {
    const current = await tx.get(hostRef)
    if (current.get('orgId') !== fromOrgId) {
      throw new HostTransferRefusedError({
        ...plan,
        holds: [{ code: 'same-organization', message: 'The site changed organization while this ran.' }],
      })
    }
    tx.set(
      fromRef,
      {
        hosts: { [hostId]: FieldValue.delete() },
        registerAllocations: { [hostId]: FieldValue.delete() },
        collaboratorAllocations: { [hostId]: FieldValue.delete() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    tx.set(
      toRef,
      { hosts: { [hostId]: true }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    tx.update(hostRef, { orgId: toOrgId, updatedAt: FieldValue.serverTimestamp() })
  })

  // Routing names the new owner.
  await db.collection('hostIndex').doc(hostId).set({ orgId: toOrgId }, { merge: true })

  // The old roster's per-site grants on this site, then its projections.
  const grants = await fromRef.collection('members').get()
  for (let at = 0; at < grants.docs.length; at += 400) {
    const batch = db.batch()
    for (const member of grants.docs.slice(at, at + 400)) {
      const access = member.get('hostAccess') ?? {}
      const permissions = member.get('hostPermissions') ?? {}
      if (!(hostId in access) && !(hostId in permissions)) continue
      batch.update(member.ref, {
        [`hostAccess.${hostId}`]: FieldValue.delete(),
        [`hostPermissions.${hostId}`]: FieldValue.delete(),
      })
    }
    await batch.commit()
  }
  await deleteHostProjectionForAllMembers(fromOrgId, hostId)
  await syncOrgAuthProjections(fromOrgId)
  // The site's access list, rebuilt whole from the new roster.
  await syncOrgAuthProjections(toOrgId, hostId)
  await syncHostProjectionForMembers(toOrgId, hostId)

  // The dedicated sending domain and its click-tracking host.
  const current = await hostRef.get()
  const domain = normalizeSendingDomain(String(current.get('sendingDomain') ?? '')) || null
  const label = String(current.get('sendingLabel') ?? '').trim()
  if (domain) {
    for (const collection of [SENDING_DOMAINS_COLLECTION, TRACKING_HOSTS_COLLECTION]) {
      await moveDocument(
        fromRef.collection(collection).doc(domain),
        toRef.collection(collection).doc(domain),
      )
    }
  }
  if (label) {
    const claim = db.collection(SENDING_LABELS_COLLECTION).doc(label)
    if ((await claim.get()).exists) await claim.update({ orgId: toOrgId })
  }

  return plan
}
