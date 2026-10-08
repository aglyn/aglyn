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
 * Loyalty's console API routes, as the dispatcher keys them (AGL-3640). One
 * table both halves import. Every path sits under the `loyalty` prefix
 * `plugins.config.json` gives this plugin, so the dispatcher gates it on the
 * plugin being on for the site. Client-safe.
 */
export const LOYALTY_API_ROUTES = {
  /** `GET ?hostId` — the store's program and its totals; `POST {hostId, program}` — change it. */
  program: 'loyalty/program',
  /** `GET ?hostId&sort|q&after` — the store's members, a page at a time. */
  members: 'loyalty/members',
  /** `GET ?hostId&memberId` — one member and their history; `POST` — adjust, issue credit, enroll. */
  member: 'loyalty/member',
  /** `GET ?hostId&orderId` — what one order earned, spent and gave back. */
  order: 'loyalty/order',
} as const
