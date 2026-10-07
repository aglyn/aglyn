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

import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import { useCallback, useEffect, useState } from 'react'
import { refusalMessage } from '../shared/actions'
import { listInvites, listMembers, type OrgInvite, type OrgMember } from './team-api'

export interface TeamState {
  members: OrgMember[]
  invites: OrgInvite[]
  ready: boolean
  error: string | null
  /** Reads the roster (and the invites) again, after a write. */
  refresh: () => Promise<void>
}

/**
 * The roster and, for a reader who manages the team, the pending invites,
 * read the way the console's Members card reads them and again after each
 * change it makes.
 */
export function useTeam(api: MobileApiClient, orgId: string | null, canManage: boolean): TeamState {
  const [state, setState] = useState<Omit<TeamState, 'refresh'>>({
    members: [],
    invites: [],
    ready: false,
    error: null,
  })
  const refresh = useCallback(async () => {
    if (!orgId) return
    try {
      const [members, invites] = await Promise.all([
        listMembers(api, orgId),
        canManage ? listInvites(api, orgId) : Promise.resolve([] as OrgInvite[]),
      ])
      setState({ members, invites, ready: true, error: null })
    } catch (error) {
      setState((prior) => ({ ...prior, ready: true, error: refusalMessage(error, 'The team could not be loaded.') }))
    }
  }, [api, orgId, canManage])
  useEffect(() => {
    setState({ members: [], invites: [], ready: false, error: null })
    void refresh()
  }, [refresh])
  return { ...state, refresh }
}
