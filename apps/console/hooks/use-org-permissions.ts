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
'use client'

import {
  orgRoleTier,
  resolveOrgPermissions,
  resolveRolePermissions,
  toLegacyPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type OrgPermission,
  type OrgRole,
  type OrgPermissions,
} from '@aglyn/aglyn'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import useOrgScope from './use-org-scope'
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

export type { OrgPermissions }

/**
 * The permissive map used WHILE LOADING — and ONLY while loading.
 *
 * Built through `resolveRolePermissions('admin')` since AGL-2474 rather than
 * written out as the six literals: a hardcoded six left every plugin-declared
 * key `undefined` until the member doc arrived, so a POS page gated on
 * `managePos` flashed "not permitted" at an admin on every navigation — a
 * loading default that answered the question instead of deferring it. A
 * function, not a const, because plugins register at module scope and this
 * module can be evaluated first.
 *
 * It is paired with `loaded: false`, which is the signal every gate is
 * required to hold on. It is NOT a fallback for a failed read — see
 * `deniedOnReadFailure` below.
 */
const allTrueWhileLoading = (): OrgPermissions & Record<string, boolean> =>
  resolveRolePermissions('admin')

/**
 * The map used when the member read FAILED (AGL-243 residual).
 *
 * Every key false, including the plugin-declared ones — the same reason
 * `allTrueWhileLoading` resolves a real role map rather than six literals: a
 * key that is missing reads as `undefined`, and `strictNullChecks` is off
 * repo-wide, so `undefined` slips through `!== false` gates as permission.
 * `toLegacyPermissions(NO_PERMISSIONS, 'viewer')` supplies the legacy six
 * (`editHosts` is role-derived and `'viewer'` makes it false too).
 */
const deniedOnReadFailure = (): OrgPermissions & Record<string, boolean> => {
  const shape = resolveRolePermissions('admin')
  const denied: Record<string, boolean> = {}
  for (const key of Object.keys(shape)) denied[key] = false
  return {
    ...denied,
    ...toLegacyPermissions(ALL_DENIED, 'viewer'),
  } as OrgPermissions & Record<string, boolean>
}

const ALL_GRANTED = resolveOrgPermissions({ role: 'owner' })

/** Every dotted permission false. `resolveOrgPermissions(null)` is the catalog's own. */
const ALL_DENIED = resolveOrgPermissions(null)

/**
 * Loading, answered, or failed — three states, never two (AGL-243 residual).
 *
 * `error` exists because folding it into either of the other two is a bug in
 * one direction or the other: folded into `ready` a hiccup grants, folded into
 * `loading` a hiccup spins forever with no way for a caller to say so.
 */
export type OrgPermissionsStatus = 'loading' | 'ready' | 'error'


/**
 * Signed-in user's permissions in the current org workspace: the org role
 * decides the defaults; a custom role (`orgs/{orgId}/roles`, AGL-243) and
 * per-member overrides refine them. Accounts without an org yet act as
 * owners (the org is created on first need).
 *
 * ## The contract, and why it changed (AGL-243 residual)
 *
 * It used to read: "defaults to full access while loading AND ON FAILURE —
 * the server APIs are the enforcement point, this hook only hides/disables
 * surfaces." The second half of that was wrong, and it was wrong in the way
 * that costs the most: the `catch` set `loaded: true` while `granted` was
 * still `ALL_GRANTED`, so a transient Firestore denial did not merely fail to
 * refuse — it answered "owner", with the `loaded` flag asserting that the
 * answer had ARRIVED. Every gate AGL-243 fixed holds on `loaded`, and every
 * one of them would have painted in full: billing's ledger, the settings hub
 * with the API-key and SSO cards, marketplace payouts, the team audit log, the
 * commerce register with checked-in guests by name. "The network hiccupped, so
 * you are an owner" is not a defensible default, and unlike the loading window
 * it needs nobody to do anything unusual to fire.
 *
 * "The server still enforces" is true and is not the point. What leaked in the
 * loading window was never a server leak either: it was the browser painting,
 * for a reader not entitled to READ it, data it was entitled to FETCH. A
 * failed read reproduces exactly that, permanently rather than for 200ms.
 *
 * So: **loading and failure are now different states.**
 *
 * - `loading` — `permissions` is the permissive admin map and `loaded` is
 *   false. Unchanged. A gate that holds sees no flash of refusal (AGL-2474).
 * - `error` — `permissions` and `granted` are ALL FALSE, `loaded` stays false,
 *   and `errored` is true.
 *
 * `loaded` staying false on error is deliberate: every gate in the console is
 * already written to HOLD on `!loaded`, so a failed read makes them hold
 * rather than accuse a legitimate admin of having no access — the mirrored
 * defect (AGL-2474), which is a real support ticket, not a hypothetical. The
 * deny map underneath is for the callers that read `permissions`/`can()`
 * WITHOUT consulting `loaded` — `hosts/page.tsx`, `host-members-card`,
 * the two marketplace detail pages — where the only two options are grant or
 * hide, and hiding an affordance is the cheap failure.
 *
 * Callers that would otherwise spin forever should read `errored` and say so.
 */
export function useOrgPermissions(): {
  /** The legacy six PLUS every registered plugin key (AGL-2474). */
  permissions: OrgPermissions & Record<string, boolean>
  /** Granular permission check (AGL-243). */
  can: (permission: OrgPermission) => boolean
  /** The full resolved permission map. */
  granted: Record<OrgPermission, boolean>
  isOwner: boolean
  /** Org the permissions were resolved in (undefined pre-first-org). */
  orgId: string | undefined
  role: OrgRole | undefined
  /** True ONLY when the read answered. False while loading AND on failure. */
  loaded: boolean
  /** The member read failed. `granted`/`permissions` are all false. */
  errored: boolean
  status: OrgPermissionsStatus
} {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  const orgId = currentOrg?.$id
  const [state, setState] = useState<{
    granted: Record<OrgPermission, boolean>
    isOwner: boolean
    orgId: string | undefined
    role: OrgRole | undefined
    /**
     * The member doc's raw override map (AGL-2474). Kept because the dotted
     * `granted` map above cannot represent a plugin-declared key, so the only
     * way the console can honour a revoked `managePos` is to read the
     * overrides the server reads.
     */
    overrides: Record<string, boolean> | undefined
    status: OrgPermissionsStatus
  }>({
    granted: ALL_GRANTED,
    isOwner: true,
    orgId: undefined,
    role: undefined,
    overrides: undefined,
    status: 'loading',
  })

  useEffect(() => {
    const uid = (user as any)?.uid as string | undefined
    if (orgsLoading || !uid) return
    if (!orgId) {
      // No org yet — fresh account, full access (owner of its future org).
      setState({
        granted: ALL_GRANTED,
        isOwner: true,
        orgId: undefined,
        role: undefined,
        overrides: undefined,
        status: 'ready',
      })
      return
    }
    let active = true
    void (async () => {
      try {
        // Retried, and named for the session-health verdict (AGL-1063): a
        // member reading their OWN member doc is always allowed, so a
        // denial that survives the retries is about the session, not about
        // authorization. This read happens on every console page, which is
        // what makes it a useful second collection alongside whatever the
        // page itself reads.
        const snapshot = await firestoreOneShotRetry(
          () => getDoc(doc(firestore, 'orgs', orgId, 'members', uid)),
          'orgs/members',
        )
        const member = (snapshot.data() ?? {}) as Partial<AglynOrgMember>
        const role = (member.role ?? 'viewer') as OrgRole
        // Custom role layer (AGL-243): one extra read, only when assigned.
        let customRole: AglynOrgCustomRole | null = null
        if (member.roleId) {
          try {
            const roleSnapshot = await getDoc(
              doc(firestore, 'orgs', orgId, 'roles', member.roleId),
            )
            if (roleSnapshot.exists()) {
              customRole = roleSnapshot.data() as AglynOrgCustomRole
            }
          } catch {
            // Dangling roleId — fall back to the role defaults.
          }
        }
        if (!active) return
        setState({
          granted: resolveOrgPermissions(member, customRole),
          isOwner: role === 'owner' || role === 'admin',
          orgId,
          role,
          overrides: member.permissions as Record<string, boolean>,
          status: 'ready',
        })
      } catch {
        // FAIL CLOSED, AND SAY SO (AGL-243 residual). This was
        // `{ ...prev, orgId, loaded: true }` — `prev.granted` is still
        // `ALL_GRANTED` at this point, so the spread published an OWNER map
        // under a flag that claims the read answered. A transient denial
        // therefore rendered every gated page in full, in production, with
        // nobody doing anything unusual.
        //
        // `status: 'error'` keeps `loaded` false so the gates HOLD, and drops
        // `granted` to all-false so the callers that never look at `loaded`
        // hide rather than grant. `isOwner` goes with it — it is read as an
        // authorization answer, and it was seeded `true`.
        if (active)
          setState({
            granted: ALL_DENIED,
            isOwner: false,
            orgId,
            role: undefined,
            overrides: undefined,
            status: 'error',
          })
      }
    })()
    return () => {
      active = false
    }
  }, [user, firestore, orgId, orgsLoading])

  return {
    // PLUGIN KEYS RIDE ALONG (AGL-2474), in the server resolver's own order:
    // tier defaults first, then the dotted catalog's projection over them.
    // `toLegacyPermissions` returns a fixed SIX-KEY literal, so returning it
    // alone is what severed the client half of the plugin permission registry
    // — `ConsolePluginPageProps.permissions` could never carry `managePos`
    // however the org was configured, while the API resolved it correctly.
    //
    // THREE BRANCHES, NOT A TERNARY ON `loaded`. Branching on `loaded` alone
    // is what made the failure path permissive: `error` is not `ready`, so it
    // fell into the loading branch and handed back the ADMIN map — a deny in
    // `granted` with a grant in `permissions` would have left the plugin
    // shell, and therefore the POS register, wide open.
    permissions:
      state.status === 'ready'
        ? {
            ...resolveRolePermissions(orgRoleTier(state.role), state.overrides),
            ...toLegacyPermissions(state.granted, state.role),
          }
        : state.status === 'error'
          ? deniedOnReadFailure()
          : allTrueWhileLoading(),
    can: (permission) => state.granted[permission],
    granted: state.granted,
    isOwner: state.isOwner,
    orgId: state.orgId,
    role: state.role,
    loaded: state.status === 'ready',
    errored: state.status === 'error',
    status: state.status,
  }
}

export default useOrgPermissions
