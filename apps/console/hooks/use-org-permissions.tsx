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
  pluginPermissionsVersion,
  resolveOrgPermissions,
  resolveRolePermissions,
  subscribePluginEntitlements,
  subscribePluginPermissions,
  toLegacyPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type OrgPermission,
  type OrgRole,
  type OrgPermissions,
} from '@aglyn/aglyn'
import { doc, getDoc } from 'firebase/firestore'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
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
    ...toLegacyPermissions(ALL_DENIED(), 'viewer'),
  } as OrgPermissions & Record<string, boolean>
}

/**
 * An owner's map, resolved per use: the catalog grows when a plugin's
 * declarations register, which can be after this module loads.
 */
const ALL_GRANTED = () => resolveOrgPermissions(OWNER_OF_NOTHING)

/** The member a reader is before any organization is chosen. */
const OWNER_OF_NOTHING: Partial<AglynOrgMember> = { role: 'owner' }

/** Every dotted permission false, resolved per use for the same reason. */
const ALL_DENIED = () => resolveOrgPermissions(null)

/**
 * Both registries a resolved map reads, as one external store (AGL-3228):
 * the plugin permission keys and the org catalog's plugin-declared keys.
 */
function subscribeRegistries(listener: () => void): () => void {
  const stopPermissions = subscribePluginPermissions(listener)
  const stopEntitlements = subscribePluginEntitlements(listener)
  return () => {
    stopPermissions()
    stopEntitlements()
  }
}
let entitlementsVersion = 0
subscribePluginEntitlements(() => {
  entitlementsVersion += 1
})
function registriesVersion(): number {
  return pluginPermissionsVersion() * 1_000_003 + entitlementsVersion
}

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
export interface OrgPermissionsValue {
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
  /**
   * True ONLY when the read for THIS reader in THIS org answered. False
   * while loading, while the only answer held is another org's or another
   * reader's, AND on failure.
   */
  loaded: boolean
  /** The member read failed. `granted`/`permissions` are all false. */
  errored: boolean
  status: OrgPermissionsStatus
}

/**
 * The value a mounted `OrgPermissionsProvider` shares, or `null` where none
 * is mounted.
 *
 * `null` and NOT an inert default, which is the one difference from
 * `DashboardWidgetPrefsContext` next door — and the difference matters.
 * A missing widget-preference provider can answer "no preferences", because
 * that context can only ever SUBTRACT cards; every value it could take is a
 * safe one. A permission context has no such value: an inert default is an
 * authorization answer, and whichever way it leaned it would be wrong for
 * somebody. So the absence is representable, and the hook below resolves for
 * itself rather than reading a made-up answer out of a constant.
 */
export const OrgPermissionsContext = createContext<OrgPermissionsValue | null>(
  null,
)

/**
 * One resolution, before the maps are drawn from it: which of the three
 * states the reader is in and, when `ready`, the member it was resolved for.
 */
interface Resolution {
  member: Partial<AglynOrgMember> | null
  customRole: AglynOrgCustomRole | null
  isOwner: boolean
  orgId: string | undefined
  role: OrgRole | undefined
  /**
   * The member doc's raw override map (AGL-2474). Kept because the dotted
   * `granted` map cannot represent a plugin-declared key, so the only way
   * the console can honor a revoked `managePos` is to read the overrides the
   * server reads.
   */
  overrides: Record<string, boolean> | undefined
  status: OrgPermissionsStatus
}

/** Nothing is known about this reader in this org yet. */
const UNANSWERED: Resolution = {
  member: null,
  customRole: null,
  isOwner: true,
  orgId: undefined,
  role: undefined,
  overrides: undefined,
  status: 'loading',
}

/**
 * A signed-in reader the SERVER says belongs to no organization: a fresh
 * account, which acts as the owner of the org it is about to create.
 */
const OWNER_OF_A_FUTURE_ORG: Resolution = {
  member: OWNER_OF_NOTHING,
  customRole: null,
  isOwner: true,
  orgId: undefined,
  role: undefined,
  overrides: undefined,
  status: 'ready',
}

/**
 * The membership listen gave up, so which org the reader is in is unknown,
 * and so is what they may do in it. Fails closed like a failed member read.
 */
const MEMBERSHIPS_UNREADABLE: Resolution = {
  member: null,
  customRole: null,
  isOwner: false,
  orgId: undefined,
  role: undefined,
  overrides: undefined,
  status: 'error',
}

/** The question a member read answers: this reader, in this org. */
function memberReadKey(uid: string, orgId: string): string {
  return `${uid}\u0000${orgId}`
}

/**
 * The member read itself — TWO `getDoc`s, and the reason the provider exists.
 *
 * `enabled: false` makes it completely inert: the effect returns before it
 * touches Firestore, so an instance whose answer is coming from the context
 * costs nothing. It is a parameter rather than two hooks because hooks cannot
 * be called conditionally, and `useOrgPermissions` has to decide at render
 * time whether a provider is above it.
 *
 * NOT exported. A second caller is a second pair of reads, which is the whole
 * defect; the only legitimate one is `OrgPermissionsProvider`.
 *
 * ## An answer belongs to the question it was read for (AGL-3337)
 *
 * A landed read is stored with the (reader, org) pair it answered, and the
 * render publishes it only while that is still the pair being asked about.
 * Everything else is chosen at render time from the inputs as they stand,
 * never written into state by an effect, because an effect's write outlives
 * the inputs it was computed from. The render where auth restores is the
 * sharp case: the org scope still reports the signed-out "not loading, no
 * orgs", and this provider's effects run before the scope's (a child's run
 * before its parent's), so an effect deciding "no org, so act as an owner"
 * there would publish `loaded: true` for a question nobody had asked, and
 * keep publishing it until the member read for the org that then arrives
 * lands — seconds, on a slow session.
 *
 * So:
 *
 * - An org in scope is answered by ITS member read and nothing else. Moving
 *   to another org, or another reader, reads `loading` until that read
 *   lands; a re-read of the same pair keeps the last answer meanwhile.
 * - No org in scope is "a fresh account" only once the server has confirmed
 *   the membership list is empty. An empty first snapshot from the cache,
 *   or a list not yet asked for, is `loading`; a listen that gave up is
 *   `error`.
 */
function useOrgPermissionsResolution(enabled: boolean): OrgPermissionsValue {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const {
    currentOrg,
    loading: orgsLoading,
    confirmed: orgsConfirmed,
    error: orgsError,
  } = useOrgScope()
  const uid = (user as any)?.uid as string | undefined
  const orgId = currentOrg?.$id
  /*
   * Re-render when a plugin registers a permission or an org-catalog key
   * (AGL-3228). The maps below are resolved per render against the LIVE
   * registries, and this provider renders only when its own state changes —
   * so a plugin whose chunk registered after the member document arrived
   * left every reader holding a map without its keys, and an absent key is
   * a refusal. A cold load of a plugin deep link is exactly that order.
   */
  useSyncExternalStore(subscribeRegistries, registriesVersion, registriesVersion)
  /** The last member read to land, with the (reader, org) pair it answered. */
  const [memberRead, setMemberRead] = useState<
    (Resolution & { key: string }) | null
  >(null)

  useEffect(() => {
    // FIRST, before any state is touched. A disabled instance must not read,
    // must not publish, and must not race the provider's own resolution.
    if (!enabled) return
    // No org in scope reads nothing; the render answers that case.
    if (!uid || !orgId) return
    const key = memberReadKey(uid, orgId)
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
        setMemberRead({
          key,
          member,
          customRole,
          isOwner: role === 'owner' || role === 'admin',
          orgId,
          role,
          overrides: member.permissions as Record<string, boolean>,
          status: 'ready',
        })
      } catch {
        // FAIL CLOSED, AND SAY SO (AGL-243 residual). `status: 'error'` keeps
        // `loaded` false so the gates HOLD rather than accuse a legitimate
        // admin, and drops `granted` to all-false so the callers that never
        // look at `loaded` hide rather than grant. `isOwner` goes with it:
        // it is read as an authorization answer.
        if (active)
          setMemberRead({
            key,
            member: null,
            customRole: null,
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
  }, [enabled, uid, firestore, orgId])

  const resolution: Resolution = !uid
    ? UNANSWERED
    : orgId
      ? memberRead?.key === memberReadKey(uid, orgId)
        ? memberRead
        : UNANSWERED
      : orgsLoading
        ? UNANSWERED
        : orgsConfirmed === true
          ? OWNER_OF_A_FUTURE_ORG
          : orgsError === true
            ? MEMBERSHIPS_UNREADABLE
            : UNANSWERED

  // Resolved per render, against the registries as they stand now.
  const granted =
    resolution.status === 'ready'
      ? resolveOrgPermissions(
          resolution.member ?? OWNER_OF_NOTHING,
          resolution.customRole,
        )
      : resolution.status === 'error'
        ? ALL_DENIED()
        : ALL_GRANTED()
  return {
    // PLUGIN KEYS RIDE ALONG (AGL-2474), in the server resolver's own order:
    // tier defaults first, then the dotted catalog's projection over them.
    // `toLegacyPermissions` returns a fixed SIX-KEY literal, so returning it
    // alone would sever the client half of the plugin permission registry.
    //
    // The tier is the MEMBER's role, the record `granted` resolved, so the
    // two halves cannot disagree about who is reading. A reader with no org
    // acts as an owner in both; the exported `role` is unset for that
    // reader, and a tier taken from it is the viewer's, which refuses every
    // plugin key the catalog half grants.
    //
    // THREE BRANCHES, NOT A TERNARY ON `loaded`. `error` is not `ready`, so
    // branching on `loaded` alone would fall into the loading branch and hand
    // back the ADMIN map — a deny in `granted` with a grant in `permissions`.
    permissions:
      resolution.status === 'ready'
        ? {
            ...resolveRolePermissions(
              orgRoleTier(resolution.member?.role),
              resolution.overrides,
            ),
            ...toLegacyPermissions(granted, resolution.role),
          }
        : resolution.status === 'error'
          ? deniedOnReadFailure()
          : allTrueWhileLoading(),
    can: (permission) => granted[permission],
    granted,
    isOwner: resolution.isOwner,
    orgId: resolution.orgId,
    role: resolution.role,
    loaded: resolution.status === 'ready',
    errored: resolution.status === 'error',
    status: resolution.status,
  }
}

/**
 * Resolves the reader's permissions ONCE for the whole console and shares
 * them with every consumer.
 *
 * Mounted inside `OrgScopeProvider` in `firebase-app.layout.tsx`, above both
 * route groups, so every surface reads the same answer from the same pair of
 * document reads. Before this, `useOrgPermissions` did its own two `getDoc`s
 * per call site: the host dashboard alone mounts four widget slots and a
 * customize dialog, and gating those slots on permission — which they were
 * not — would have made a five-instance page a ten-read page.
 *
 * This is the shape `DashboardWidgetPrefsProvider` already uses one file over
 * for the identical problem on the identical surface, for the identical
 * reason. The one thing it does differently is the missing-provider case:
 * see `OrgPermissionsContext`.
 *
 * Sharing rather than DEFERRING is the deliberate part. The standing rule is
 * that an expensive read needs an ask and not a mount — but a permission is
 * an input to rendering correctly, not a payload some surface happens to
 * want, so there is nothing to defer it behind. The read was always going to
 * happen on every console page; what it must not do is happen once per
 * consumer.
 */
export function OrgPermissionsProvider(props: { children?: ReactNode }) {
  const value = useOrgPermissionsResolution(true)
  return (
    <OrgPermissionsContext.Provider value={value}>
      {props.children}
    </OrgPermissionsContext.Provider>
  )
}
OrgPermissionsProvider.displayName = 'OrgPermissionsProvider'

/**
 * The reader's permissions in the current org workspace.
 *
 * Unchanged as an API and unchanged in what it answers — the doc block above
 * `useOrgPermissionsResolution` is still the contract. What changed is WHERE
 * the answer comes from: under the provider it is read from context and costs
 * nothing, and the local resolution is inert.
 *
 * Off the provider it resolves for itself, exactly as it always did. That
 * fallback is not a hedge, it is the correct answer to a real case: this hook
 * is rendered in unit tests, in error boundaries above the provider, and
 * potentially in a subtree some future layout mounts outside it. The
 * alternative — throwing, or handing back a made-up default — trades a shared
 * read for either a crash or a wrong authorization answer, and the fallback
 * costs a reader nothing they were not already paying before this change.
 *
 * The saving therefore rests on the provider actually being mounted above the
 * console, which `plugin-widget-slot-permission-gate.spec.tsx` asserts against
 * the layout source rather than trusting.
 */
export function useOrgPermissions(): OrgPermissionsValue {
  const shared = useContext(OrgPermissionsContext)
  // Called unconditionally, as hooks must be, and told whether to do anything.
  const own = useOrgPermissionsResolution(shared === null)
  return shared ?? own
}

export default useOrgPermissions
