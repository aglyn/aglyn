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

import useHostRole from './use-host-role'
import useOrgPermissions from './use-org-permissions'

export interface AiPermissionsState {
  /**
   * True ONLY once every read the answer depends on has answered. False
   * while loading and after a failed read — the hold every gate is written
   * to respect, so a surface that reads `use` or `generate` without
   * consulting this sees `false` for both until the answer is in.
   */
  loaded: boolean
  /** May the reader ask the assistant, rewrite copy, generate a section? */
  use: boolean
  /** May the reader run an AI generation job or an AI edit? */
  generate: boolean
}

const HELD: AiPermissionsState = { loaded: false, use: false, generate: false }

/**
 * The reader's AI permissions, on whichever membership axis they are on
 * (AGL-2927) — the console half of `memberHasAiPermission`, which is what
 * the doors enforce with.
 *
 * An org-wide member is decided by the org catalog: `useOrgPermissions`
 * already resolves `ai.use` and `ai.generate` with the custom role and the
 * overrides applied, and the answer is the same on every site. A site
 * collaborator is decided on the site in view, by the host role they hold
 * there refined by the per-site toggle on their member document — which is
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
 * hold instead. An AI control is a button that spends the workspace's
 * credits, and the cost of a briefly inert button is nothing, so this hook
 * reports `false` until it knows and `loaded` says which.
 */
export function useAiPermissions(
  hostId?: string | null,
): AiPermissionsState {
  const org = useOrgPermissions()
  const host = useHostRole(hostId || undefined)
  if (!org.loaded) return HELD
  const fromOrg: AiPermissionsState = {
    loaded: true,
    use: org.can('ai.use'),
    generate: org.can('ai.generate'),
  }
  if (!hostId) return fromOrg
  if (!host.loaded) return HELD
  if (host.orgWide) return fromOrg
  return {
    loaded: true,
    use: host.aiPermissions?.['ai.use'] ?? false,
    generate: host.aiPermissions?.['ai.generate'] ?? false,
  }
}

export default useAiPermissions
