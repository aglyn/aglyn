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
  isReleaseFlagOnForOrg,
  parseOrgReleaseFlagOverrides,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  resolveEffectivePlan,
  type OrgPlan,
  type ReleaseFlagKey,
  type ReleaseFlagValue,
} from '@aglyn/aglyn'
import { useRemoteConfig, useUser } from '@aglyn/tenant-feature-instance'
import useCurrentOrg from './use-current-org'
import { useUrlNamesOrg } from './use-url-names-org'
import { fetchAndActivate, getValue } from 'firebase/remote-config'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ReleaseFlagState {
  value: ReleaseFlagValue
  /** Rollout verdict for the current subject — staff bypass NOT applied. */
  released: boolean
}

export interface ReleaseFlagsContextValue {
  /** True once Remote Config activation settled (either way). */
  ready: boolean
  isStaff: boolean
  flags: Record<ReleaseFlagKey, ReleaseFlagState>
}

const registryDefaults = (): Record<ReleaseFlagKey, ReleaseFlagState> =>
  Object.fromEntries(
    RELEASE_FLAGS.map((definition) => [
      definition.key,
      {
        value: { enabled: definition.defaultEnabled },
        released: definition.defaultEnabled,
      },
    ]),
  ) as Record<ReleaseFlagKey, ReleaseFlagState>

const ReleaseFlagsContext = createContext<ReleaseFlagsContextValue>({
  ready: false,
  isStaff: false,
  flags: registryDefaults(),
})

export interface ReleaseFlagsProviderProps {
  children?: ReactNode
}

/**
 * Release-flag delivery (AGL-229): activates the Remote Config template
 * once per session and resolves every registered flag for the current
 * subject. The rollout subject is the org workspace the user acts in
 * (AGL-238) so a whole organization gets a feature together, falling back
 * to the uid pre-resolution. Until activation lands, registry defaults
 * gate — a flag that's default-off never flashes on.
 */
export function ReleaseFlagsProvider(props: ReleaseFlagsProviderProps) {
  const { children } = props
  const remoteConfig = useRemoteConfig()
  const { data: user } = useUser()
  // The org DOC, not just its id (AGL-1635): it carries the per-org
  // release-flag overrides staff set from /admin/orgs, and the console has
  // to apply the same ones the tenant runtime and the API dispatchers do or
  // a granted feature is visible on one surface and missing on another.
  //
  // `orgReady` gates the DOC only. `orgId` comes from the org scope rather
  // than this listener, so the rollout subject is unaffected and keeps
  // resolving during the window.
  //
  // Until the doc is trustworthy we resolve as though no override were set
  // (AGL-1047/1061/1064/1380: `org` during the loading window conflates
  // "none" with "not read yet"). That deliberately matches how this
  // provider already treats Remote Config before activation — inherit, so a
  // default-off flag never flashes ON. The residual window is a force-OFF
  // override on a globally-enabled flag, which can show a nav tab for a
  // moment before it disappears; it is cosmetic, because every server gate
  // (tenant runtime, both API dispatchers, the edit-bar routes) applies the
  // override unconditionally and refuses the work regardless.
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  // Whether the URL names a workspace at all (AGL-1935). `useCurrentOrg`
  // deliberately falls back to a remembered selection and then to the user's
  // FIRST org, because org-less pages still need an org to ACT on — but a
  // rollout bucket is not an action, it is an answer about a workspace, and
  // on the picker, `/manage/*` and `/admin/*` there is no workspace to answer
  // about. Derived from the URL alone, so it has no loading window: false
  // means "this route names none", never "not read yet".
  const namesOrg = useUrlNamesOrg()
  // The rollout subject is the ORG, and nothing else (AGL-1656). This used
  // to fall back to `user.uid`, which bucketed two teammates in one
  // workspace into different halves of the same percentage — and disagreed
  // with the server, which fell back to a hostId. Three subjects for one
  // question. Outside an org scope there is no workspace to roll out to, so
  // a null subject resolves fully-enabled flags only.
  //
  // That last sentence used to describe a branch nothing could reach
  // (AGL-1935): `orgId` is undefined only for a user who belongs to no org at
  // all, never merely because the route is org-less. `namesOrg` is what makes
  // the documented behaviour true — and it is the same predicate the chrome
  // (AGL-1130) and the plugin gate (AGL-1937) gate on, so one route cannot
  // disagree with another about which workspace it is in.
  const subjectId = namesOrg ? (orgId ?? null) : null
  const releaseFlagOverrides = namesOrg ? org?.releaseFlags : undefined
  const overrides = useMemo(
    () =>
      orgReady && namesOrg
        ? parseOrgReleaseFlagOverrides(releaseFlagOverrides)
        : {},
    [orgReady, namesOrg, releaseFlagOverrides],
  )
  // The tier a plan-targeted flag is evaluated against (AGL-2486), on the
  // same terms as the overrides above: only once the org doc is trustworthy,
  // and null otherwise.
  //
  // Null rather than `resolveEffectivePlan(undefined)` on purpose — that
  // answers `'free'`, so during the loading window a Free-targeted flag would
  // switch ON for a Business workspace and then off again a moment later.
  // Unknown-means-off keeps the direction the rest of this provider already
  // takes: a flag never flashes on before it is known to apply.
  const plan: OrgPlan | null = useMemo(
    () => (orgReady && namesOrg && org ? resolveEffectivePlan(org as any) : null),
    [orgReady, namesOrg, org],
  )

  const [activated, setActivated] = useState(false)
  const [isStaff, setIsStaff] = useState(false)

  useEffect(() => {
    if (!remoteConfig) {
      setActivated(true)
      return
    }
    // Code-side defaults double as offline behavior; the published
    // template overrides them after activation.
    remoteConfig.defaultConfig = Object.fromEntries(
      RELEASE_FLAGS.map((definition) => [
        definition.key,
        JSON.stringify({ enabled: definition.defaultEnabled }),
      ]),
    )
    let active = true
    fetchAndActivate(remoteConfig)
      .catch((error) => {
        console.error('Remote Config activation failed', error)
      })
      .finally(() => {
        if (active) setActivated(true)
      })
    return () => {
      active = false
    }
  }, [remoteConfig])

  useEffect(() => {
    let active = true
    if (!user) {
      setIsStaff(false)
      return undefined
    }
    void user
      .getIdTokenResult()
      .then((result) => {
        if (active) setIsStaff(result.claims['staff'] === true)
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

  const flags = useMemo(() => {
    // Registry defaults are the pre-activation gate, but a per-org override
    // is a staff DECISION and does not depend on Remote Config having
    // landed — applying it here too stops a granted feature flashing off on
    // first paint and then on again a moment later.
    if (!remoteConfig || !activated) {
      const defaults = registryDefaults()
      return Object.fromEntries(
        RELEASE_FLAGS.map((definition) => {
          const state = defaults[definition.key]
          const override = overrides[definition.key]
          return [
            definition.key,
            typeof override === 'boolean'
              ? { value: state.value, released: override }
              : state,
          ]
        }),
      ) as Record<ReleaseFlagKey, ReleaseFlagState>
    }
    return Object.fromEntries(
      RELEASE_FLAGS.map((definition) => {
        const value = parseReleaseFlagValue(
          getValue(remoteConfig, definition.key).asString(),
          definition.defaultEnabled,
        )
        return [
          definition.key,
          {
            value,
            released: isReleaseFlagOnForOrg(
              definition.key,
              value,
              subjectId,
              overrides,
              plan,
            ),
          },
        ]
      }),
    ) as Record<ReleaseFlagKey, ReleaseFlagState>
  }, [remoteConfig, activated, subjectId, overrides, plan])

  const context = useMemo(
    () => ({ ready: activated, isStaff, flags }),
    [activated, isStaff, flags],
  )

  return (
    <ReleaseFlagsContext.Provider value={context}>
      {children}
    </ReleaseFlagsContext.Provider>
  )
}
ReleaseFlagsProvider.displayName = 'ReleaseFlagsProvider'

export function useReleaseFlags(): ReleaseFlagsContextValue {
  return useContext(ReleaseFlagsContext)
}

export interface ReleaseFlagVerdict extends ReleaseFlagState {
  /** Whether the current user may see the feature (staff bypass applied). */
  visible: boolean
  /** True when only the staff bypass makes it visible — show a warning. */
  staffPreview: boolean
  isStaff: boolean
  ready: boolean
}

export function useReleaseFlag(key: ReleaseFlagKey): ReleaseFlagVerdict {
  const { ready, isStaff, flags } = useReleaseFlags()
  const state = flags[key]
  return {
    ...state,
    visible: state.released || isStaff,
    staffPreview: isStaff && !state.released,
    isStaff,
    ready,
  }
}

export default useReleaseFlags
