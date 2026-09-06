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
 * The CRM plugin's console API routes, as the dispatcher keys them.
 *
 * One file both halves import, because the server registers the path and
 * the client fetches it, and a route spelled twice is a route that 404s
 * the day one spelling changes. Client-safe: constants only.
 */
export const CRM_API_ROUTES = {
  ping: 'crm/ping',
  /** `POST` — moves one contact to a lifecycle stage; see `server.ts`. */
  contactStage: 'crm/contact-stage',
  /** `POST` — one email to one person from a record; see `server/email-send.ts`. */
  emailSend: 'crm/email-send',
  /**
   * `POST` — one line in the ORGANIZATION's activity feed for an act the
   * org-level hub performed client-direct (AGL-2634); see
   * `server/org-activity.ts`.
   */
  orgActivity: 'crm/org-activity',
} as const

/**
 * What an organization-level activity line may point at: the CRM's record
 * kinds, and nothing the org feed holds for its own reasons (a member, a
 * subscription). The route refuses any other type, so a bulk bar cannot
 * write a line the feed's presenter would render as a workspace event.
 */
export const CRM_ORG_ACTIVITY_KINDS = [
  'contact',
  'company',
  'deal',
  'lead',
  'task',
] as const

export type CrmOrgActivityKind = (typeof CRM_ORG_ACTIVITY_KINDS)[number]

/** The most an activity line may say — a sentence, not a report. */
export const CRM_ORG_ACTIVITY_ACTION_MAX = 160

/** The browser-side URL for a route key. */
export function crmApiUrl(route: keyof typeof CRM_API_ROUTES): string {
  return `/api/${CRM_API_ROUTES[route]}`
}
