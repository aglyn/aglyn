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

import type { CrmNextActivityLink } from '@aglyn/aglyn'
import type { CrmTaskRouteScope } from './task-routes'

/**
 * The contract between the console and the plugin's next-activity route
 * (AGL-2661), the door a CLIENT-DIRECT task write uses to keep the records'
 * `nextTaskAtMs` honest.
 *
 * The two task routes recompute it themselves. Every other task write —
 * reopening, snoozing, deleting, the bulk bar's reassign — is a Firestore
 * write from the browser, and a browser cannot recompute a denormalized
 * figure it is not allowed to write consistently. So after such a write the
 * surface tells this route which records the task named, and the route
 * reads the tasks back and stores the answer. Best effort by design: the
 * task write already happened, and a figure that did not move is what the
 * Fields section's recompute exists for. The browser's side is
 * `next-activity-api.ts`; this module is the contract both halves import.
 *
 * `all: true` is that recompute — the whole organization, every open task
 * once — and is the Fields section's maintenance action.
 */
export const CRM_NEXT_ACTIVITY_ROUTE = 'crm/next-activity' as const

export const crmNextActivityRouteUrl = (): string => `/api/${CRM_NEXT_ACTIVITY_ROUTE}`

/** The most records one request recomputes — the bulk bar's own window. */
export const CRM_NEXT_ACTIVITY_LINKS_MAX = 200

export type CrmNextActivityRequest = CrmTaskRouteScope &
  ({ links: CrmNextActivityLink[]; all?: false } | { all: true; links?: undefined })

export interface CrmNextActivityResponse {
  ok: true
  /** Records written. */
  records: number
  /** Records a task named that no longer exist. */
  missing: number
  /** The whole-org form only: how many open tasks it read, and whether it read them all. */
  tasks?: number
  cleared?: number
  truncated?: boolean
}

/** The links a task row carries, as the request names them. */
export function nextActivityRequestLinks(
  tasks: readonly { contactId?: string | null; companyId?: string | null; dealId?: string | null }[],
): CrmNextActivityLink[] {
  return tasks.map((task) => ({
    ...(task.contactId ? { contactId: task.contactId } : {}),
    ...(task.companyId ? { companyId: task.companyId } : {}),
    ...(task.dealId ? { dealId: task.dealId } : {}),
  }))
}
