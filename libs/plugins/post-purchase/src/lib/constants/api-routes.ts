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
 * Post-purchase's console API routes, as the dispatcher keys them
 * (AGL-3635). One table both halves import. Every path sits under the
 * `post-purchase` prefix `plugins.config.json` gives this plugin, so the
 * dispatcher gates it on the plugin being on for the site. Client-safe.
 */
export const POST_PURCHASE_API_ROUTES = {
  /** `GET ?hostId` — which services this deployment offers the site. */
  availability: 'post-purchase/availability',
  /** `GET ?hostId` — the site's switches, never a credential; `POST` — change one service. */
  settings: 'post-purchase/settings',
  /** `GET ?hostId&recordId` — what each service was told about one order. */
  order: 'post-purchase/order',
  /** `POST ?hostId` — AfterShip's tracking webhook; verified by its signature. */
  webhookAftership: 'post-purchase/webhooks/aftership',
} as const
