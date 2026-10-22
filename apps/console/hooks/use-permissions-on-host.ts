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

import { pluginOrgPermissionKeys } from '@aglyn/aglyn'
import { useMemo } from 'react'
import useHostRole from './use-host-role'
import useOrgPermissions from './use-org-permissions'

export interface PermissionsOnHost {
  /**
   * True ONLY once every read the answer depends on has answered. False
   * while loading and after a failed read — the hold every gate is written
   * to respect, so a surface that reads `granted` without consulting this
   * sees every key refused until the answer is in.
   */
  loaded: boolean
  /** The verdict for every key a plugin declared into the catalog; an absent key is refused. */
  granted: Readonly<Record<string, boolean>>
}

const HELD: PermissionsOnHost = { loaded: false, granted: {} }

/**
 * The reader's verdict for every catalog key a plugin declared, on
 * whichever membership axis they are on (AGL-2927, AGL-2984) — the console
 * half of `memberHasPermissionOnHost`, which is what the doors enforce with.
 * The shell resolves it once and hands it to the plugins' providers and the
 * assistant dock, so a plugin control holds on the same answer its door
 * gives.
 *
 * An org-wide member is decided by the org catalog: `useOrgPermissions`
 * already resolves every declared key with the custom role and the
 * overrides applied, and the answer is the same on every site. A site
 * collaborator is decided on the site in view, by the host role they hold
 * there refined by the per-site toggles on their member document — which is
 * what `useHostRole` reads, for the site whose id is passed.
 *
 * Off a host route there is no site to decide a collaborator against, so
 * the org verdict stands alone; the server refuses a collaborator's request
 * that names no site regardless, so the display gate cannot over-grant by
 * answering from the org role there.
 *
 * Both reads fail CLOSED here, and differently from `useOrgPermissions`'
 * own contract: that hook answers as an admin while loading so that pages
 * do not flash a refusal at an owner, and it exposes `loaded` so gates can
 * hold instead. A plugin control can be a button that spends the
 * workspace's money, and the cost of a briefly inert button is nothing, so
 * this hook reports every key refused until it knows and `loaded` says
 * which.
 */
export function usePermissionsOnHost(hostId?: string | null): PermissionsOnHost {
  const org = useOrgPermissions()
  const host = useHostRole(hostId || undefined)
  const keys = pluginOrgPermissionKeys()
  let answer = HELD
  if (org.loaded) {
    const onCollaboratorAxis = Boolean(hostId) && !(host.loaded && host.orgWide)
    if (!onCollaboratorAxis) {
      answer = {
        loaded: true,
        granted: Object.fromEntries(keys.map((key) => [key, org.can(key) === true])),
      }
    } else if (host.loaded) {
      answer = {
        loaded: true,
        granted: Object.fromEntries(
          keys.map((key) => [key, host.hostPermissions?.[key] === true]),
        ),
      }
    }
  }
  // One object per verdict, not per render: a provider keys its callbacks
  // on this answer, and a fresh object each paint would rebuild them all.
  const signature = answer.loaded
    ? keys.map((key) => `${key}=${answer.granted[key] ? 1 : 0}`).join('&')
    : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => answer, [answer.loaded, signature])
}

export default usePermissionsOnHost
