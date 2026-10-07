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
  CRM_COLLECTIONS,
  CRM_LEAD_STATUS_PICKLIST,
  type CrmMemberOption,
  type CrmPicklist,
  crmMemberOption,
  effectiveCrmPicklist,
} from '@aglyn/aglyn/app-utils/crm'
import { useLiveDoc } from '@aglyn/mobile-core'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import {
  collection,
  documentId,
  type Firestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { activePipelines, defaultPipelineOf, type PipelineDoc } from '../lib/model/deal-board-model'

/*
 * The reads beside a CRM list or record (AGL-3622), each the console's own:
 * the team (`GET /api/orgs/members`, `useOrgMemberOptions`), the org's lead
 * status values (`crmPicklists/leadStatus`, `useLeadStatusPicklist`) and the
 * pipelines (`usePipeline`'s bounded, scoped read).
 */

export interface CrmRoster {
  options: CrmMemberOption[]
  ready: boolean
  /** How an owner reads: "You", a teammate's name, or nothing for none. */
  labelFor: (uid: unknown) => string
}

/** The team, by the route the console's owner pickers read. */
export function useCrmRoster(api: MobileApiClient, orgId: string | null, uid: string): CrmRoster {
  const [state, setState] = useState<{ orgId: string; options: CrmMemberOption[] } | null>(null)
  useEffect(() => {
    if (!orgId) return
    let active = true
    api
      .request<{ members?: Array<Record<string, unknown>> }>('/api/orgs/members', { query: { orgId } })
      .then((payload) => {
        const options = (Array.isArray(payload?.members) ? payload.members : [])
          .map((member) => crmMemberOption(member))
          .filter((option): option is CrmMemberOption => option !== null)
        if (active) setState({ orgId, options })
      })
      .catch(() => {
        if (active) setState({ orgId, options: [] })
      })
    return () => {
      active = false
    }
  }, [api, orgId])
  const options = useMemo(() => (state && state.orgId === orgId ? state.options : []), [state, orgId])
  const labelFor = useMemo(
    () => (ref: unknown) => {
      const value = typeof ref === 'string' ? ref.trim() : ''
      if (!value) return ''
      if (value === uid) return 'You'
      return options.find((option) => option.uid === value || option.email === value)?.label ?? 'A teammate'
    },
    [options, uid],
  )
  return { options, ready: Boolean(state && state.orgId === orgId), labelFor }
}

/** The org's lead status values: the labels the list and the status sheet use. */
export function useLeadStatusPicklist(firestore: unknown, orgId: string | null): { picklist: CrmPicklist; ready: boolean } {
  const stored = useLiveDoc<Record<string, unknown>>(
    firestore,
    orgId ? ['orgs', orgId, CRM_COLLECTIONS.picklists, CRM_LEAD_STATUS_PICKLIST] : null,
  )
  const picklist = useMemo(() => effectiveCrmPicklist(CRM_LEAD_STATUS_PICKLIST, stored.data), [stored.data])
  return { picklist, ready: stored.ready }
}

/** The console's ceiling on the pipelines read (`PIPELINE_READ_LIMIT`). */
export const CRM_PIPELINE_READ_LIMIT = 20

export interface CrmPipelines {
  pipelines: PipelineDoc[]
  active: PipelineDoc[]
  /** The default active pipeline, or null before the console has made one. */
  defaultPipeline: PipelineDoc | null
  ready: boolean
  byId: (id: unknown) => PipelineDoc | null
}

/** The org's pipelines, read as the Deals section reads them. `visibleTo` undefined holds the read. */
export function useCrmPipelines(
  firestore: unknown,
  orgId: string | null,
  visibleTo: readonly string[] | null | undefined,
): CrmPipelines {
  const [state, setState] = useState<{ rows: PipelineDoc[]; ready: boolean }>({ rows: [], ready: false })
  const tokensKey = visibleTo === undefined ? null : JSON.stringify(visibleTo)
  useEffect(() => {
    setState({ rows: [], ready: false })
    if (!orgId || tokensKey === null || !firestore) return
    const tokens = JSON.parse(tokensKey) as string[] | null
    if (tokens && !tokens.length) return
    return onSnapshot(
      query(
        collection(firestore as Firestore, 'orgs', orgId, CRM_COLLECTIONS.pipelines),
        ...(tokens ? [where('visibleTo', 'array-contains-any', tokens)] : []),
        orderBy(documentId()),
        limit(CRM_PIPELINE_READ_LIMIT),
      ),
      (snapshot) =>
        setState({
          rows: snapshot.docs.map((row) => ({ ...(row.data() as object), $id: row.id }) as PipelineDoc),
          ready: true,
        }),
      () => setState({ rows: [], ready: true }),
    )
  }, [firestore, orgId, tokensKey])
  return useMemo(() => {
    const active = activePipelines(state.rows)
    return {
      pipelines: state.rows,
      active,
      defaultPipeline: defaultPipelineOf(state.rows),
      ready: state.ready,
      byId: (id: unknown) => state.rows.find((row) => row.$id === id) ?? null,
    }
  }, [state])
}
