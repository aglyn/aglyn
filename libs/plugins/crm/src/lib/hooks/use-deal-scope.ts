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

import * as Aglyn from '@aglyn/aglyn'
import {
  type ConsentGroup,
  type ConsolePluginPageProps,
  crmScopeTokens,
} from '@aglyn/aglyn'
import { useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { useMemo } from 'react'

/**
 * The org document as a CRM surface receives it: the shell's typed billing
 * projection on a page, or the plain record a card was handed. Read as a
 * record at the one seam below, so no component casts it itself.
 */
export type CrmOrgDoc =
  | ConsolePluginPageProps['org']
  | Record<string, unknown>
  | null
  | undefined

export interface DealScope {
  /** The owning org, or null while the lookup runs or when there is none. */
  orgId: string | null
  /** Whether the org lookup has settled — `orgId` null after this means no org. */
  ready: boolean
  /** The group this console reads as: the sites declared one sender, or this one alone. */
  consentGroup: ConsentGroup
  /**
   * What every CRM listener filters by: `array-contains-any` over these is
   * the predicate the rules evaluate, and an unfiltered list is refused.
   */
  readTokens: string[]
  /** What every CRM document created here is stamped with. */
  createTokens: string[]
}

/**
 * The org and the scope a CRM surface reads and writes with (AGL-2598).
 *
 * Every deals surface — the board, the drawer, the detail page, the cards on
 * a contact's and a company's page — needs the same four answers before it
 * can issue a query or a write, and each of them computed separately is four
 * chances to filter by one set of tokens and stamp with another. This is
 * pure over the org document the shell already passed, so it costs no read;
 * only the org lookup behind `useOrgDataScope` is asynchronous.
 */
export function useDealScope(options: {
  hostId: string
  org: CrmOrgDoc
}): DealScope {
  const { hostId } = options
  const org = (options.org ?? null) as Record<string, unknown> | null
  const { orgId, ready } = useOrgDataScope({ hostId })
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org ?? null, hostId),
    [org, hostId],
  )
  const readTokens = useMemo(
    () =>
      [
        Aglyn.ORG_SCOPE_TOKEN,
        ...consentGroup.hostIds.map((id) => Aglyn.hostScopeToken(id)),
      ].slice(0, Aglyn.MAX_SCOPE_HOSTS),
    [consentGroup],
  )
  const createTokens = useMemo(
    () => [...crmScopeTokens(org, consentGroup)],
    [org, consentGroup],
  )
  return useMemo(
    () => ({ orgId, ready, consentGroup, readTokens, createTokens }),
    [orgId, ready, consentGroup, readTokens, createTokens],
  )
}

export default useDealScope
