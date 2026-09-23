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

import type { AccountAcquisition } from '@aglyn/aglyn/app-utils/account-acquisition'
import type { PluginPersonMatch } from '@aglyn/aglyn/plugin-manager/plugin-person-matches'

/**
 * What `/api/admin/acquisition` answers for the staff Acquisition card
 * (AGL-3289) — shared by the route that builds it and the card that draws it.
 */
export interface StaffAcquisitionView {
  /** Whose record this is: an account, or a workspace (its creator's copy). */
  scope: 'user' | 'org'
  /** The account the record is about. */
  subject: {
    uid: string | null
    email: string | null
    name: string | null
    createdAtMs: number | null
    provider: string | null
  }
  /** The stored record; null when nothing is stored yet. */
  acquisition: AccountAcquisition | null
  /** Whether this reader sees city-level geography; others see the country. */
  cityLevel: boolean
  /** The newest sign-in the device registry holds. */
  latestSignIn: { location: string | null; atMs: number | null } | null
  /** Whether the sales workspace already knew this person. */
  matches: {
    /**
     * `checked` — every matcher answered or failed by name; `unconfigured` —
     * the install names no sales workspace; `no-matchers` — no plugin keeps
     * people here to ask.
     */
    status: 'checked' | 'unconfigured' | 'no-matchers'
    workspace: { orgId: string; slug: string | null; name: string | null } | null
    items: Array<PluginPersonMatch & { pluginId: string }>
    failed: string[]
  }
}
