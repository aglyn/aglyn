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
  hostPermissionKeys,
  hostRoleFor,
  hostRolePermissionDefaults,
  isOrgWideMember,
  orgPermissionLabel,
  pluginPermissionChanges,
  pluginRequestFromWeb,
  resolveCollaboratorHostPermissions,
  resolveMemberHostPermissions,
  runPluginEventHandlers,
  siteNarrowedPermissionKeys,
  siteNarrowingFor,
  type AglynOrgCustomRole,
  type AglynOrgMember,
} from '@aglyn/aglyn/server'
import {
  overrideWriteRefusal,
  parsePermissionOverrides,
} from '@aglyn/aglyn/app-utils/org-permission-editor'
import { runPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
  setHostPermissionOverrides,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * A site collaborator's per-site permissions (AGL-4047): every key a plugin
 * declared per site, each allowed, denied or left to the host role.
 *
 * `GET ?hostId&memberId` answers what the collaborators card's Permissions
 * dialog draws: the host role, the toggles stored, the host role's defaults
 * and the verdict. `PATCH { hostId, memberId, permissions }` sets keys to
 * `true` / `false` or clears them with `null`.
 *
 * The door is the collaborators card's own, as the role change beside it: a
 * site admin, or an org member who manages people, on a site whose
 * organization is not locked. A member who reaches the whole workspace is
 * decided by the org catalog, so their row is refused here and set on their
 * Team page, except on a site that narrows them (AGL-4047): an editor of the
 * workspace given Viewer or Author access here, whose register and waivers
 * keys this site decides, and whose row here sets exactly those. Nobody but
 * staff changes their own toggles, and nobody but staff and the owner grants
 * a key they do not hold on this site.
 *
 * Recorded like every collaborator change: a sentence per key in the site's
 * feed, one `org.permissions.changed` per key that moved, and one
 * `host.member.permissions.changed` with the verdict, for a plugin that keeps
 * a display copy on the roster row.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  if (method !== 'GET' && method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const source = method === 'GET' ? query : body
  const hostId = String(source?.['hostId'] ?? '')
  const memberId = String(source?.['memberId'] ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (!memberId) return Response.json({ error: 'Missing member' }, { status: 400 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const host = (await hostRef.get()).data()
    const memberRole = (host?.['memberRoles'] ?? {})[decoded.uid]
    const actorPermissions = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!host || (memberRole !== 'admin' && !actorPermissions.permissions.manageMembers && !isStaff)) {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      return Response.json({ error: 'This site has no organization yet' }, { status: 409 })
    }
    const { orgId, org } = resolved
    const locked = await lockdownRefusal({ request, staff: isStaff, uid: decoded.uid, org, host })
    if (locked) return locked

    const rosterRef = hostRef.collection('members').doc(memberId)
    const roster = (await rosterRef.get()).data()
    if (!roster) return Response.json({ error: 'Member not found' }, { status: 404 })
    const uid = typeof roster['uid'] === 'string' ? roster['uid'] : ''
    if (!uid) {
      return Response.json({ error: 'Permissions are set once the invite is accepted' }, { status: 409 })
    }
    const membersRef = firestore.collection('orgs').doc(orgId).collection('members')
    const memberSnapshot = await membersRef.doc(uid).get()
    if (!memberSnapshot.exists) return Response.json({ error: 'Member not found' }, { status: 404 })
    const member = { $id: uid, ...memberSnapshot.data() } as AglynOrgMember
    const orgWide = isOrgWideMember(member)
    const role = hostRoleFor(member, hostId)
    // A workspace-wide member this site narrows (AGL-4047): set here, for
    // the keys such a site narrows, and nothing else.
    const narrowing = siteNarrowingFor(member, hostId)
    /** A member's custom role, or null: one read, and none without a `roleId`. */
    const customRoleOf = async (roleId: string | undefined): Promise<AglynOrgCustomRole | null> => {
      if (!roleId) return null
      const roleSnapshot = await firestore.collection('orgs').doc(orgId).collection('roles').doc(roleId).get()
      return roleSnapshot.exists ? (roleSnapshot.data() as AglynOrgCustomRole) : null
    }

    if (method === 'GET') {
      const stored = member.hostPermissions?.[hostId] ?? {}
      if (narrowing) {
        const keys = siteNarrowedPermissionKeys()
        const customRole = await customRoleOf(member.roleId)
        const verdicts = resolveMemberHostPermissions({ member, customRole, hostId })
        // Inherit: what the narrower access leaves them here, the site's own
        // verdicts set aside.
        const inherited = resolveMemberHostPermissions({
          member: { ...member, hostPermissions: { ...member.hostPermissions, [hostId]: {} } },
          customRole,
          hostId,
        })
        const pick = (map: Record<string, boolean>) => Object.fromEntries(keys.map((key) => [key, map[key] === true]))
        return Response.json(
          {
            orgWide,
            narrowed: true,
            role,
            keys,
            stored: Object.fromEntries(
              keys.filter((key) => typeof stored[key] === 'boolean').map((key) => [key, stored[key]]),
            ),
            defaults: pick(inherited),
            effective: pick(verdicts),
          },
          { status: 200 },
        )
      }
      const keys = hostPermissionKeys()
      return Response.json(
        {
          orgWide,
          role,
          keys,
          stored: Object.fromEntries(
            keys.filter((key) => typeof stored[key] === 'boolean').map((key) => [key, stored[key]]),
          ),
          defaults: role ? hostRolePermissionDefaults(role) : {},
          effective: orgWide
            ? resolveMemberHostPermissions({ member, hostId })
            : (resolveCollaboratorHostPermissions(member, hostId) ?? {}),
        },
        { status: 200 },
      )
    }

    if (orgWide && !narrowing) {
      return Response.json(
        { error: "This member works across the workspace; set their permissions on the Team page" },
        { status: 409 },
      )
    }
    if (!role) return Response.json({ error: 'This member has no access to this site' }, { status: 409 })
    const allowedKeys = () => (narrowing ? siteNarrowedPermissionKeys() : hostPermissionKeys())
    let parsed = parsePermissionOverrides(body?.permissions, allowedKeys())
    if (parsed.error && (await runPluginDeclarationsRepair().catch(() => false))) {
      parsed = parsePermissionOverrides(body?.permissions, allowedKeys())
    }
    if (parsed.error || !parsed.changes) return Response.json({ error: parsed.error }, { status: 400 })

    // The actor's own verdict on THIS site, on whichever axis they stand.
    const actorMemberSnapshot = await membersRef.doc(decoded.uid).get()
    const actorMember = actorMemberSnapshot.exists
      ? ({ $id: decoded.uid, ...actorMemberSnapshot.data() } as AglynOrgMember)
      : null
    const actorCustomRole = await customRoleOf(actorMember?.roleId)
    // The keys a site narrows, as the server decides them for the actor on
    // this site (AGL-4047): a site admin who works only here holds the
    // register by their site role, which the per-site map does not carry.
    const actorSiteKeys: Record<string, boolean> = {}
    for (const key of siteNarrowedPermissionKeys()) {
      const value = (actorPermissions.permissions as Record<string, unknown> | undefined)?.[key]
      if (typeof value === 'boolean') actorSiteKeys[key] = value
    }
    const refusal = overrideWriteRefusal({
      targetUid: uid,
      targetIsOwner: member.role === 'owner' || org?.['ownerUid'] === uid,
      actorUid: decoded.uid,
      isStaff,
      actorIsOwner: org?.['ownerUid'] === decoded.uid,
      actorGranted: {
        ...resolveMemberHostPermissions({ member: actorMember, customRole: actorCustomRole, hostId }),
        ...actorSiteKeys,
      },
      changes: parsed.changes,
      labelOf: orgPermissionLabel,
    })
    if (refusal) return Response.json({ error: refusal.error }, { status: refusal.status })

    const { before, after } = await setHostPermissionOverrides({
      orgId,
      uid,
      hostId,
      changes: parsed.changes,
    })
    const actor = { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null }
    const memberName = typeof roster['email'] === 'string' ? roster['email'] : undefined
    for (const [key, value] of Object.entries(parsed.changes)) {
      const label = orgPermissionLabel(key)
      await logHostActivity(
        hostId,
        actor,
        value === null
          ? `Reset member's "${label}" to their site role`
          : `${value ? 'Allowed' : 'Denied'} "${label}" for a member`,
        { type: 'member', id: memberId, ...(memberName ? { name: memberName } : {}) },
      )
    }
    const subjectName = [host['displayName'], memberName]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join(' · ')
    for (const change of pluginPermissionChanges(before, after)) {
      await runPluginEventHandlers('org.permissions.changed', {
        orgId,
        actor,
        subject: { type: 'host', id: hostId, name: subjectName },
        permission: change.permission,
        granted: change.granted,
      })
    }
    await runPluginEventHandlers('host.member.permissions.changed', {
      orgId,
      hostId,
      memberId,
      uid,
      permissions: after,
    })
    return Response.json({ ok: true, effective: after }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Permission update failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PATCH }
