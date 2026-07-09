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
  isReleaseFlagOn,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  type ReleaseFlagKey,
  type ReleaseFlagValue,
} from '@aglyn/aglyn'
import { useRemoteConfig, useUser } from '@aglyn/tenant-feature-instance'
import { fetchAndActivate, getValue } from 'firebase/remote-config'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import useTenantPermissions from './use-tenant-permissions'

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
 * subject. The rollout subject is the tenant the user acts in (owner uid,
 * AGL-127) so a whole workspace gets a feature together, falling back to
 * the uid pre-resolution. Until activation lands, registry defaults gate —
 * a flag that's default-off never flashes on.
 */
export function ReleaseFlagsProvider(props: ReleaseFlagsProviderProps) {
  const { children } = props
  const remoteConfig = useRemoteConfig()
  const { data: user } = useUser()
  const { ownerUid } = useTenantPermissions()
  const subjectId = ownerUid ?? user?.uid ?? null

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
    if (!remoteConfig || !activated) return registryDefaults()
    return Object.fromEntries(
      RELEASE_FLAGS.map((definition) => {
        const value = parseReleaseFlagValue(
          getValue(remoteConfig, definition.key).asString(),
          definition.defaultEnabled,
        )
        return [
          definition.key,
          { value, released: isReleaseFlagOn(definition.key, value, subjectId) },
        ]
      }),
    ) as Record<ReleaseFlagKey, ReleaseFlagState>
  }, [remoteConfig, activated, subjectId])

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
