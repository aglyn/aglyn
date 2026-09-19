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
 * Outreach's console API routes, as the dispatcher keys them (AGL-2974).
 *
 * One table both halves import, because the server registers the path and the
 * client fetches it, and a route spelled twice is a route that 404s the day
 * one spelling changes. Every path sits under the `outreach` prefix that
 * `plugins.config.json` gives this plugin, which is what lets the console's
 * `/api/[...pluginApi]` dispatcher gate a request on the plugin being enabled
 * and released before the handler runs. Client-safe: constants only.
 */
export const OUTREACH_API_ROUTES = {
  /** `GET` — proves the server bundle loaded and registered; see `server.ts`. */
  ping: 'outreach/ping',
  // Settings, sequences and enrollments (AGL-2980). Every one names its org
  // (`orgId`, query or body); the contract is `model/outreach-api.ts`.
  /** `GET ?orgId` — the compliance settings; `POST` — save them. */
  settings: 'outreach/settings',
  /** `POST` — create a sequence, or save an edit to one. */
  sequencesSave: 'outreach/sequences/save',
  /** `POST` — activate, pause or archive a sequence. */
  sequencesStatus: 'outreach/sequences/status',
  /** `POST` — delete a draft nobody was enrolled in. */
  sequencesDelete: 'outreach/sequences/delete',
  /** `POST` — who a saved view or a search would enroll, and where each stands. */
  enrollPreview: 'outreach/enroll/preview',
  /** `POST` — enroll them, every gate checked again. */
  enroll: 'outreach/enroll',
  /** `POST` — pause, resume, stop, or mark do-not-contact. */
  enrollmentsAction: 'outreach/enrollments/action',
  /** `POST` — one email of a saved sequence, for a contact or a sample person. */
  preview: 'outreach/preview',
} as const
