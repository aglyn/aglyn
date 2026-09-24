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
 * WRITING AN ORG AUTOMATION, and pausing one on a site (AGL-3302).
 *
 * `orgs/{orgId}/automations` is closed to every client write, the way the
 * outreach collections are: an org automation runs on every site it is
 * placed on, as that site, so its trigger, its steps and its placement are
 * decisions the server checks — the vocabulary, the organization's sites, the
 * plan — and nothing a browser may write around.
 *
 * ## Two doors
 *
 * `automations/manage` is the organization's: it creates, edits, switches on
 * and off, and deletes. It names the org and NO site, so it declares a
 * subject resolver for the dispatchers' release gate and asks the org's
 * plugin switch itself; the caller must be an org-wide owner, admin or
 * editor.
 *
 * `automations/pause` is the SITE's — the host level control. It names the
 * site, so the dispatcher applies that site's plugin switch as for any site
 * request, and it changes one thing: whether this automation is paused on
 * THIS site. The site's own admins and editors may use it, and so may an
 * org-wide editor; nobody may pause a site through it but the one named.
 */

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { hostIdsFromScope, visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  type AglynOrgMember,
  checkEntitlement,
  isOrgWideMember,
  type PluginApiHandler,
  type PluginApiRequestSubject,
  planLabelGrantingFeature,
} from '@aglyn/aglyn/server'
/*
 * The MODULES, not the barrel: `@aglyn/tenant-data-admin`'s index reaches the
 * Next render cache, and everything these doors need is the Admin SDK handle,
 * the id predicate and the org reads.
 */
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  getOrgDoc,
  logHostActivity,
  logOrgActivity,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  ORG_AUTOMATION_ACTIVITY_TARGET,
  ORG_AUTOMATION_API_ROUTES,
  ORG_AUTOMATIONS_COLLECTION,
  ORG_AUTOMATIONS_MAX,
  orgAutomationPausedHostIds,
  prunePausedHostIds,
  readOrgAutomation,
} from '../model/org-automations'

export { ORG_AUTOMATION_API_ROUTES }

/** What `automations/manage` may be asked to do. */
export const ORG_AUTOMATION_MANAGE_ACTIONS = [
  'create',
  'update',
  'setEnabled',
  'delete',
] as const

type ManageAction = (typeof ORG_AUTOMATION_MANAGE_ACTIONS)[number]

/** The org roles that may write the organization's automations. */
const ORG_MANAGE_ROLES = ['owner', 'admin', 'editor'] as const

/** The site roles that may pause an org automation on their own site. */
const SITE_PAUSE_ROLES = ['admin', 'editor'] as const

/** What the doors reach outside this module; specs hand in their own. */
export interface OrgAutomationRouteDeps {
  firestore(): FirebaseFirestore.Firestore
  verifyIdToken(token: string): Promise<{ uid: string; email?: string | null }>
  resolveOrgMembership(
    uid: string,
    orgId: string,
  ): Promise<{ orgId: string; member: Partial<AglynOrgMember> } | null>
  getOrgDoc(orgId: string): Promise<Record<string, unknown> | null>
  resolveOrgIdForHost(hostId: string): Promise<string | null>
  logOrgActivity(
    orgId: string,
    actor: { uid: string; email?: string | null },
    action: string,
    target: { type: typeof ORG_AUTOMATION_ACTIVITY_TARGET; id: string; name?: string },
  ): Promise<void>
  logHostActivity(
    hostId: string,
    actor: { uid: string; email?: string | null },
    action: string,
    target: { type: 'workflow'; id: string; name?: string },
  ): Promise<void>
  newId(): string
}

function defaultDeps(): OrgAutomationRouteDeps {
  return {
    firestore: () =>
      firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore,
    verifyIdToken: async (token) => {
      const decoded = await firebaseAdmin.app().auth().verifyIdToken(token)
      return { uid: decoded.uid, email: decoded.email ?? null }
    },
    resolveOrgMembership: async (uid, orgId) =>
      (await resolveOrgMembership(uid, orgId)) as never,
    getOrgDoc: async (orgId) =>
      ((await getOrgDoc(orgId)) as Record<string, unknown> | null) ?? null,
    resolveOrgIdForHost,
    logOrgActivity: (orgId, actor, action, target) =>
      logOrgActivity(orgId, actor, action, target),
    logHostActivity: (hostId, actor, action, target) =>
      logHostActivity(hostId, actor, action, target),
    newId: createResourceUid,
  }
}

/** The bearer token a request carries, or null. */
function bearerToken(headers: Partial<Record<string, string | string[]>>): string | null {
  const authorization = String(headers['authorization'] ?? '')
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length) || null
    : null
}

function automationsOf(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(ORG_AUTOMATIONS_COLLECTION)
}

/**
 * Whether every site a placement names belongs to this organization — asked
 * of `hostIndex`, the mirror `resolveOrgIdForHost` reads, in one round trip.
 * `['org']` names no site and always answers yes.
 */
async function placementIsTheOrgs(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  visibleTo: readonly string[],
): Promise<boolean> {
  const hostIds = hostIdsFromScope(visibleTo)
  if (!hostIds.length) return true
  if (!hostIds.every(isDocumentId)) return false
  const entries = await firestore.getAll(
    ...hostIds.map((hostId) => firestore.collection('hostIndex').doc(hostId)),
  )
  return entries.every((entry) => entry.exists && entry.get('orgId') === orgId)
}

/**
 * The organization a `automations/manage` request is for, read off its JSON
 * body, so the dispatchers' release gate asks about the right organization.
 * Consulted only for a request that names no site. Unverified, exactly as a
 * `hostId` is: the handler refuses anyone who is not an org-wide member.
 */
export async function orgAutomationsManageSubject(
  request: Request,
): Promise<PluginApiRequestSubject | null> {
  if (request.method !== 'POST') return null
  const body = (await request.json().catch(() => null)) as {
    orgId?: unknown
  } | null
  const orgId = typeof body?.orgId === 'string' ? body.orgId : ''
  return isDocumentId(orgId) ? { orgId } : null
}

/**
 * `automations/manage`: create, edit, switch on or off, and delete one of the
 * organization's automations.
 *
 * A DELETE is soft — `deletedAt` stamped and the automation switched off —
 * because the id is what every run history row and every waiting person
 * names: the rows keep a name to show, and the people waiting inside it are
 * stopped by the resume's kill switch on their next beat. Deleting and
 * switching off are never refused for want of a plan, so an organization
 * that downgraded can always stop what it built.
 */
export function createOrgAutomationsManageHandler(
  overrides: Partial<OrgAutomationRouteDeps> = {},
): PluginApiHandler {
  return async (req, res) => {
    const deps = { ...defaultDeps(), ...overrides }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const orgId = String(req.body?.orgId ?? '')
    const action = String(req.body?.action ?? '') as ManageAction
    if (!isDocumentId(orgId)) {
      return res.status(400).json({ error: 'Invalid orgId' })
    }
    if (!(ORG_AUTOMATION_MANAGE_ACTIONS as readonly string[]).includes(action)) {
      return res.status(400).json({ error: 'Unknown action' })
    }
    const automationId = String(req.body?.automationId ?? '')
    if (action !== 'create' && !isDocumentId(automationId)) {
      return res.status(400).json({ error: 'Invalid automationId' })
    }
    const token = bearerToken(req.headers)
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })

    try {
      const caller = await deps.verifyIdToken(token).catch(() => null)
      if (!caller) return res.status(401).json({ error: 'Unauthenticated' })
      const membership = await deps.resolveOrgMembership(caller.uid, orgId)
      const member = membership?.member
      if (
        !member ||
        !isOrgWideMember(member) ||
        !(ORG_MANAGE_ROLES as readonly string[]).includes(String(member.role ?? ''))
      ) {
        return res
          .status(403)
          .json({ error: 'Not an organization owner, admin or editor' })
      }
      /*
       * A request naming no site reaches here past only the release gate —
       * the dispatcher's per-site switch needs a site — so the organization's
       * own switch is asked here.
       */
      const org = await deps.getOrgDoc(orgId)
      if (!org || !isPluginEnabled(org as never, BUNDLE_ID)) {
        return res.status(404).json({ error: 'Not found' })
      }
      const enabling =
        action === 'create' ||
        action === 'update' ||
        (action === 'setEnabled' && req.body?.enabled === true)
      if (enabling && !checkEntitlement(org as never, 'actions')) {
        return res.status(403).json({
          error: `Org automations need the ${planLabelGrantingFeature('actions') ?? 'Pro'} plan`,
        })
      }

      const firestore = deps.firestore()
      const collection = automationsOf(firestore, orgId)
      const actor = { uid: caller.uid, email: caller.email ?? null }
      const logged = (verb: string, id: string, name: string) =>
        deps.logOrgActivity(orgId, actor, verb, {
          type: ORG_AUTOMATION_ACTIVITY_TARGET,
          id,
          name,
        })

      if (action === 'create' || action === 'update') {
        const read = readOrgAutomation(req.body?.automation)
        if (read.ok === false) {
          return res.status(400).json({ error: read.problem })
        }
        const fields = read.value
        if (!(await placementIsTheOrgs(firestore, orgId, fields.visibleTo))) {
          return res
            .status(400)
            .json({ error: 'A site you chose is not in this organization' })
        }
        if (action === 'create') {
          /*
           * Counted before the write rather than inside a transaction. The
           * cap bounds storage, not money, so the overshoot two simultaneous
           * saves can buy is one document — the trade the site actions cap
           * makes for the same reason.
           */
          const live = (
            await collection.where('deletedAt', '==', null).count().get()
          ).data().count
          if (live >= ORG_AUTOMATIONS_MAX) {
            return res.status(409).json({
              error:
                `An organization holds at most ${ORG_AUTOMATIONS_MAX} org ` +
                'automations — delete one you no longer use first',
            })
          }
          const id = deps.newId()
          await collection.doc(id).create({
            ...fields,
            pausedHostIds: [],
            deletedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: caller.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: caller.uid,
          })
          await logged('Created an org automation', id, fields.name)
          return res.status(200).json({ automationId: id })
        }
        const outcome = await firestore.runTransaction(async (transaction) => {
          const ref = collection.doc(automationId)
          const current = await transaction.get(ref)
          if (!current.exists || current.get('deletedAt')) return 'missing'
          transaction.update(ref, {
            ...fields,
            // A site the automation no longer runs on has nothing left to
            // pause: its entry goes, so a later placement starts unpaused.
            pausedHostIds: prunePausedHostIds(
              orgAutomationPausedHostIds(current.data()),
              fields.visibleTo,
            ),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: caller.uid,
          })
          return 'updated'
        })
        if (outcome === 'missing') {
          return res.status(404).json({ error: 'Unknown org automation' })
        }
        await logged('Edited an org automation', automationId, fields.name)
        return res.status(200).json({ automationId })
      }

      if (action === 'setEnabled') {
        if (typeof req.body?.enabled !== 'boolean') {
          return res.status(400).json({ error: 'Say whether it is enabled' })
        }
        const enabled = req.body.enabled as boolean
        const name = await firestore.runTransaction(async (transaction) => {
          const ref = collection.doc(automationId)
          const current = await transaction.get(ref)
          if (!current.exists || current.get('deletedAt')) return null
          transaction.update(ref, {
            enabled,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: caller.uid,
          })
          return String(current.get('name') ?? '')
        })
        if (name === null) {
          return res.status(404).json({ error: 'Unknown org automation' })
        }
        await logged(
          enabled ? 'Switched on an org automation' : 'Switched off an org automation',
          automationId,
          name,
        )
        return res.status(200).json({ automationId, enabled })
      }

      // delete
      const deleted = await firestore.runTransaction(async (transaction) => {
        const ref = collection.doc(automationId)
        const current = await transaction.get(ref)
        if (!current.exists) return null
        // Deleting twice is the same request answered again.
        if (current.get('deletedAt')) return { name: '', again: true }
        transaction.update(ref, {
          deletedAt: FieldValue.serverTimestamp(),
          deletedBy: caller.uid,
          // Off as well, so the engine's query — which asks for switched-on
          // automations only — never spends one of its places on it.
          enabled: false,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
        })
        return { name: String(current.get('name') ?? ''), again: false }
      })
      if (!deleted) {
        return res.status(404).json({ error: 'Unknown org automation' })
      }
      if (!deleted.again) {
        await logged('Deleted an org automation', automationId, deleted.name)
      }
      return res.status(200).json({ automationId, deleted: true })
    } catch (error) {
      console.error('[org automations] manage failed', orgId, action, error)
      return res
        .status(500)
        .json({ error: 'The request could not be completed' })
    }
  }
}

/**
 * `automations/pause`: pause or resume one org automation on ONE site.
 *
 * `pausedHostIds` is changed with `arrayUnion`/`arrayRemove` of the named
 * site alone, inside a transaction that first confirms the automation runs
 * there — so a site's editor can take their own site out of an org
 * automation and put it back, and can never touch another site's entry or
 * the automation itself. Pausing stops the people already waiting inside it
 * on this site as well, on their next beat: the resume reads a pause as the
 * kill switch.
 *
 * Never refused for want of a plan: a pause is how a site stops something,
 * and stopping is always allowed.
 */
export function createOrgAutomationPauseHandler(
  overrides: Partial<OrgAutomationRouteDeps> = {},
): PluginApiHandler {
  return async (req, res) => {
    const deps = { ...defaultDeps(), ...overrides }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const hostId = String(req.body?.hostId ?? '')
    const automationId = String(req.body?.automationId ?? '')
    const paused = req.body?.paused
    if (!isDocumentId(hostId)) {
      return res.status(400).json({ error: 'Invalid hostId' })
    }
    if (!isDocumentId(automationId)) {
      return res.status(400).json({ error: 'Invalid automationId' })
    }
    if (typeof paused !== 'boolean') {
      return res.status(400).json({ error: 'Say whether it is paused' })
    }
    const token = bearerToken(req.headers)
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })

    try {
      const caller = await deps.verifyIdToken(token).catch(() => null)
      if (!caller) return res.status(401).json({ error: 'Unauthenticated' })
      const firestore = deps.firestore()
      const host = await firestore.collection('hosts').doc(hostId).get()
      if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
      const orgId = await deps.resolveOrgIdForHost(hostId)
      if (!orgId) {
        return res.status(409).json({
          error: 'This site is not part of an organization, so it runs no org automations.',
        })
      }
      const requestedOrgId = String(req.body?.orgId ?? '')
      if (requestedOrgId && requestedOrgId !== orgId) {
        return res.status(400).json({ error: 'That site is not in this organization' })
      }
      /*
       * The site's own admins and editors, read off the host's `memberRoles`
       * projection — the same answer every site door asks — or an org-wide
       * editor, asked of the membership itself so a projection that has not
       * caught up cannot refuse the organization's own managers.
       */
      const siteRole = String((host.get('memberRoles') ?? {})[caller.uid] ?? '')
      let allowed = (SITE_PAUSE_ROLES as readonly string[]).includes(siteRole)
      if (!allowed) {
        const membership = await deps.resolveOrgMembership(caller.uid, orgId)
        const member = membership?.member
        allowed =
          Boolean(member) &&
          isOrgWideMember(member) &&
          (ORG_MANAGE_ROLES as readonly string[]).includes(String(member?.role ?? ''))
      }
      if (!allowed) {
        return res
          .status(403)
          .json({ error: 'Not an admin or editor of this site' })
      }

      const name = await firestore.runTransaction(async (transaction) => {
        const ref = automationsOf(firestore, orgId).doc(automationId)
        const current = await transaction.get(ref)
        if (
          !current.exists ||
          current.get('deletedAt') ||
          !visibleToHost(current.get('visibleTo') as string[] | undefined, hostId)
        ) {
          return null
        }
        transaction.update(ref, {
          pausedHostIds: paused
            ? FieldValue.arrayUnion(hostId)
            : FieldValue.arrayRemove(hostId),
        })
        return String(current.get('name') ?? '')
      })
      if (name === null) {
        return res
          .status(404)
          .json({ error: 'No org automation by that id runs on this site' })
      }
      await deps.logHostActivity(
        hostId,
        { uid: caller.uid, email: caller.email ?? null },
        paused
          ? 'Paused an org automation on this site'
          : 'Resumed an org automation on this site',
        { type: 'workflow', id: automationId, name },
      )
      return res.status(200).json({ automationId, hostId, paused })
    } catch (error) {
      console.error('[org automations] pause failed', hostId, automationId, error)
      return res
        .status(500)
        .json({ error: 'The request could not be completed' })
    }
  }
}

export const orgAutomationsManageHandler = createOrgAutomationsManageHandler()
export const orgAutomationPauseHandler = createOrgAutomationPauseHandler()
