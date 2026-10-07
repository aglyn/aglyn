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

import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * The zones the Funnels card hosts (AGL-3605), for the plugin that sells
 * generation to fill without either importing the other.
 */

/** What "Create with AI" may do: hand a description to the card. */
export interface FunnelsCreateZoneProps {
  hostId: string
  /** The workspace; `undefined` while it resolves. */
  orgId: string | undefined
  /**
   * Asks the funnels plugin for a draft from a description, through its own
   * `funnels/propose` door. Resolves to `null` when the editor opened on a
   * draft, or to a sentence saying why there is none. Writes nothing.
   */
  propose: (brief: string) => Promise<string | null>
}

/** What "Ask AI about this funnel" is handed: the funnel by name. */
export interface FunnelInsightZoneProps {
  hostId: string
  /** The workspace; `undefined` while it resolves. */
  orgId: string | undefined
  /** The funnel shown, as the card names it. */
  funnelName: string
  /** The range shown, in whole days. */
  days: number
}

export const FUNNELS_CREATE_ZONE = definePluginZone<FunnelsCreateZoneProps>('funnelsCreate')

export const FUNNEL_INSIGHT_ZONE = definePluginZone<FunnelInsightZoneProps>('funnelInsight')
