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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { useMobileListQuery } from '@aglyn/mobile-core'
import { useMemo } from 'react'
import { crmListNotices, type CrmListSpec } from './crm-lists'

/** A CRM row as a listener hands it back: the document and its id. */
export type CrmRow = Record<string, unknown> & { $id: string }

export interface CrmListState {
  rows: CrmRow[]
  ready: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => void
  /** The plan's notices and refusals, in the console's words. */
  notices: string[]
}

/**
 * One CRM list, live (AGL-3622): the spec's query through
 * `useMobileListQuery` — the console's plan, constraints and indexes — with
 * the name-search normalizers the CRM's search tokens were written with.
 */
export function useCrmList(firestore: unknown, spec: CrmListSpec | null): CrmListState {
  const result = useMobileListQuery<CrmRow>({
    firestore,
    path: spec?.path ?? null,
    declaration: spec?.ask.reader ?? EMPTY_DECLARATION,
    request: spec?.ask.request ?? EMPTY_REQUEST,
    normalizers: nameSearchNormalizers,
    enabled: Boolean(spec?.enabled),
  })
  const notices = useMemo(
    () => (spec && result.plan ? crmListNotices(spec, result.plan) : []),
    [spec, result.plan],
  )
  return {
    rows: result.rows,
    ready: result.ready,
    error: result.error,
    hasMore: result.hasMore,
    loadMore: result.loadMore,
    notices,
  }
}

const EMPTY_DECLARATION = { fields: [], sorts: [{ path: 'updatedAt', direction: 'desc' as const }] }
const EMPTY_REQUEST = { clauses: [], search: [], sort: null, base: [] }
