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

/**
 * A site's forms and one form, live (AGL-3622), on the console's own query:
 * `hosts/{hostId}/forms` planned from the Forms list's declaration
 * (`FORM_LIST_QUERY`, `formListRequest`), so Status and the search are
 * predicates on one Firestore query served by the console's indexes.
 */

import { searchWords, useLiveDoc, useMobileListQuery } from '@aglyn/mobile-core'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { ListQueryRequest } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { useMemo } from 'react'
import { FORM_LIST_QUERY, formListRequest } from '../lib/constants/form-list-query'

/** A form row as the list and the detail read it. */
export interface FormRow {
  $id: string
  displayName?: string
  slug?: string
  retired?: boolean
  routing?: { lead?: boolean }
  stats?: {
    submissions?: number | null
    leads?: number | null
    views?: number | null
    lastSubmissionAtMs?: number | null
  }
}

/** Status, as the console's Status filter picks the stored `retired`. */
export type FormStatusFilter = 'false' | 'true'

/** The console's request for a Status pick and the search text. */
export function formsRequest(status: FormStatusFilter, text: string): ListQueryRequest {
  return formListRequest([{ field: 'status', op: 'equals', value: status }], searchWords(text))
}

export function useFormList(firestore: unknown, hostId: string | null, status: FormStatusFilter, search: string) {
  const request = useMemo(() => formsRequest(status, search), [status, search])
  return useMobileListQuery<FormRow>({
    firestore,
    path: hostId ? ['hosts', hostId, 'forms'] : null,
    declaration: FORM_LIST_QUERY,
    request,
    normalizers: nameSearchNormalizers,
  })
}

export function useForm(firestore: unknown, hostId: string | null, formId: string | null) {
  return useLiveDoc<Omit<FormRow, '$id'>>(firestore, hostId && formId ? ['hosts', hostId, 'forms', formId] : null)
}

/** A counter as the console's figures read it: a number, or not recorded. */
export function recorded(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
