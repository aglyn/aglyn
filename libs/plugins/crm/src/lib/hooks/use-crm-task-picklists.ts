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

import { CRM_TASK_PICKLIST_IDS, type CrmTaskPicklists } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { useCrmPicklist } from './use-crm-picklist'

/**
 * An org's Status, Priority and Type lists for tasks (AGL-3517), for every
 * surface that shows or writes a task's labels. Three document listens,
 * shared by the Firestore SDK with every other mount asking for the same
 * lists; `orgId` null reads nothing and answers the standard values.
 */
export function useCrmTaskPicklists(orgId: string | null | undefined): CrmTaskPicklists & {
  ready: boolean
} {
  const status = useCrmPicklist(CRM_TASK_PICKLIST_IDS.status, orgId)
  const priority = useCrmPicklist(CRM_TASK_PICKLIST_IDS.priority, orgId)
  const type = useCrmPicklist(CRM_TASK_PICKLIST_IDS.type, orgId)
  return useMemo(
    () => ({
      status: status.picklist,
      priority: priority.picklist,
      type: type.picklist,
      ready: status.ready && priority.ready && type.ready,
    }),
    [status.picklist, status.ready, priority.picklist, priority.ready, type.picklist, type.ready],
  )
}

export default useCrmTaskPicklists
