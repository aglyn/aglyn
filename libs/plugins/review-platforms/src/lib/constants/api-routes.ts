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
 * Review platforms' console API routes, as the dispatcher keys them
 * (AGL-3699). Every path sits under the `review-platforms` prefix
 * `plugins.config.json` gives this plugin, so the dispatcher gates it on the
 * plugin being on for the site. Client-safe.
 */
export const REVIEW_PLATFORMS_API_ROUTES = {
  /** `GET ?hostId` — the site's settings, never a credential; `POST` — change one service. */
  settings: 'review-platforms/settings',
  /** `GET ?hostId&recordId` — whether each service was asked to invite one order's buyer. */
  order: 'review-platforms/order',
} as const
