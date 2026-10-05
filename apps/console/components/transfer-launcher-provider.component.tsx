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
  hostRoleFor,
  isOrgWideMembership,
  resolveCollaboratorHostPermissions,
  TransferLauncherContext,
  type AglynOrgMember,
  type TransferAccessTarget,
  type TransferAction,
  type TransferExportLaunch,
  type TransferImportLaunch,
  type TransferLauncher,
} from '@aglyn/aglyn'
import {
  parseTransferResourceKey,
  transferAccessAllowed,
  transferPlanFeature,
  type TransferMemberAxis,
} from '@aglyn/aglyn/data-transfer'
import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { resolveIdToken } from '@aglyn/shared-util-http/authorized-token'
import { doc, getDoc } from 'firebase/firestore'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgPermissions from '../hooks/use-org-permissions'
import { useUrlNamedOrg } from '../hooks/use-url-names-org'
import { resolveExtensionEntitlement } from '../utils/extension-entitlement'
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

/** What the launcher has open. */
export type TransferLaunchState =
  | { kind: 'import'; launch: TransferImportLaunch }
  | { kind: 'export'; launch: TransferExportLaunch }

/**
 * The wizard, the dialog, the kit and the HTTP client, in a chunk the
 * browser fetches when a plugin first opens one: the provider sits in the
 * shell of every console page, and the kit is a large graph none of them
 * needs until then. `ssr: false` because nothing is open on a first paint.
 */
const TransferLauncherSurface = dynamic(
  () => import('./transfer-launcher-surface.component'),
  { ssr: false },
)

/** Every plan feature a declared resource is moved under, sorted. */
const PLAN_FEATURES: readonly string[] = [
  ...new Set(
    PLUGIN_TRANSFER_RESOURCES_DECLARED.map((one) => one.featureFlag).filter((feature): feature is string => Boolean(feature)),
  ),
].sort()

/** What the person's permissions are, as {@link transferAccessVerdict} reads them. */
export interface TransferAccessInputs {
  /** Whether the workspace permissions have answered for this person. */
  permissionsLoaded: boolean
  /** The workspace verdict for one permission. */
  can(permission: string): boolean
  /** Whether the person reaches every site of the workspace. */
  orgWide: boolean
  /** A collaborator's member document; `undefined` while it is read, `null` when it could not be. */
  member: Partial<AglynOrgMember> | null | undefined
  /**
   * Whether the workspace's plan carries a feature — the verdict the shell
   * locks a plugin's surfaces with (`resolveExtensionEntitlement`), `false`
   * until the workspace document has answered.
   */
  entitled(feature: string): boolean
}

/**
 * Whether the person may `action` the target's records — the transfer
 * gate's own rule (`data-transfer/access.ts`, AGL-3546), on the axis the
 * gate decides it: the workspace, or the named site, where a collaborator is
 * decided by what they hold there — on a workspace whose plan carries the
 * resource's `featureFlag` for that action (AGL-3555). `false` until every
 * read the answer needs is in.
 */
export function transferAccessVerdict(
  inputs: TransferAccessInputs,
  action: TransferAction,
  target: TransferAccessTarget,
): boolean {
  if (!inputs.permissionsLoaded) return false
  const resourceKey = parseTransferResourceKey(target.resource).key
  const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find((one) => one.key === resourceKey) ?? null
  // The workspace's plan first (AGL-3555): no button the route would refuse
  // for the plan, whatever the person holds.
  const feature = transferPlanFeature(action, declared)
  if (feature && !inputs.entitled(feature)) return false
  const hostId = target.hostId?.trim() || null
  let axis: TransferMemberAxis
  if (inputs.orgWide || !hostId) {
    axis = { holds: (permission) => inputs.can(permission), reachesSite: true }
  } else if (inputs.member === undefined) {
    return false
  } else {
    const onSite = resolveCollaboratorHostPermissions(inputs.member, hostId as never) as Record<string, boolean> | null
    axis = {
      holds: (permission) => onSite?.[permission] === true,
      reachesSite: hostRoleFor(inputs.member, hostId as never) !== null,
    }
  }
  return transferAccessAllowed(action, declared, axis)
}

/**
 * A collaborator's own member document, for their per-site verdicts; never
 * read for an org-wide member, whose verdict is the workspace's.
 */
function useCollaboratorMember(orgId: string | null, uid: string | undefined, enabled: boolean) {
  const firestore = useFirestore()
  const [state, setState] = useState<{ key: string; member: Partial<AglynOrgMember> | null } | null>(null)
  const key = enabled && orgId && uid ? `${orgId}/${uid}` : null
  useEffect(() => {
    if (!key || !orgId || !uid) return undefined
    let active = true
    firestoreOneShotRetry(() => getDoc(doc(firestore, 'orgs', orgId, 'members', uid)), 'orgs/members')
      .then((snapshot) => {
        if (active) setState({ key, member: (snapshot.data() ?? null) as Partial<AglynOrgMember> | null })
      })
      // Fail closed: a member we could not read is offered nothing on a site.
      .catch(() => active && setState({ key, member: null }))
    return () => {
      active = false
    }
  }, [firestore, key, orgId, uid])
  return state && state.key === key ? state.member : undefined
}

/**
 * The console's {@link TransferLauncher} (AGL-3539): a plugin calls
 * `useTransferLauncher()?.openImport(...)` or `.openExport(...)`, and the
 * shell opens the UI kit's wizard or dialog over the page, bound to the
 * workspace the URL names. Outside a workspace there is nothing to import
 * into, so nothing opens. `can` tells the plugin which of the two to offer.
 */
export function TransferLauncherProvider({ children }: { children?: JSX.Children }) {
  const org = useUrlNamedOrg()
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [open, setOpen] = useState<TransferLaunchState | null>(null)
  const getIdToken = useCallback(() => resolveIdToken(userRef.current), [])
  const orgId = org?.$id ?? null

  // Who may import and export what (AGL-3546): read from the permissions
  // the shell already holds, so `can` costs a button nothing.
  const permissions = useOrgPermissions()
  // The plan, from the one document the shell judges entitlements from — as
  // the features it carries, so the launcher moves only when one does.
  const billing = useCurrentOrg()
  const planReady = billing.ready && Boolean(orgId) && billing.orgId === orgId
  const entitledFeatures = planReady
    ? PLAN_FEATURES.filter((feature) => resolveExtensionEntitlement(feature as never, billing.org, true) === 'entitled').join(',')
    : null
  const orgWide = isOrgWideMembership(org)
  const member = useCollaboratorMember(orgId, user?.uid, Boolean(org) && !orgWide)
  const permissionsLoaded = Boolean(orgId) && permissions.loaded && permissions.orgId === orgId
  // The verdicts, not the resolution object: the launcher is a context value,
  // rebuilt (and every list re-rendered) only when an answer moves.
  // `permissions` carries the plugin-declared keys beside the catalog's.
  const granted = Object.entries({ ...(permissions.permissions ?? {}), ...(permissions.granted ?? {}) })
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort()
    .join(',')

  const launcher = useMemo<TransferLauncher>(() => {
    const held = new Set(granted ? granted.split(',') : [])
    const entitled = new Set(entitledFeatures ? entitledFeatures.split(',') : [])
    const inputs: TransferAccessInputs = {
      permissionsLoaded,
      can: (key) => held.has(key),
      orgWide,
      member,
      entitled: (feature) => entitled.has(feature),
    }
    // One verdict per action and target for as long as the answers stand.
    const answers = new Map<string, boolean>()
    return {
      openImport: (launch) => setOpen({ kind: 'import', launch }),
      openExport: (launch) => setOpen({ kind: 'export', launch }),
      close: () => setOpen(null),
      can: (action, target) => {
        const key = [action, target.resource, target.scope, target.hostId ?? ''].join('\u0000')
        let answer = answers.get(key)
        if (answer === undefined) {
          answer = transferAccessVerdict(inputs, action, target)
          answers.set(key, answer)
        }
        return answer
      },
    }
  }, [permissionsLoaded, granted, orgWide, member, entitledFeatures])

  return (
    <TransferLauncherContext.Provider value={launcher}>
      {children}
      {open && orgId ? (
        <TransferLauncherSurface
          state={open}
          orgId={orgId}
          getIdToken={getIdToken}
          onClose={launcher.close}
        />
      ) : null}
    </TransferLauncherContext.Provider>
  )
}

export default TransferLauncherProvider
