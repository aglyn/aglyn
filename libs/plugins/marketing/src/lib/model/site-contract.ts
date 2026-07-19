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
 * The marketing plugin's site wire contract (AGL-419): shapes its server
 * page-enricher writes into the page props and its client site-runtime
 * reads back. Pure types — shared by the /server graph and the client
 * runtime without pulling either's dependencies.
 */

import type { HostActionStep, SiteEventType } from '@aglyn/aglyn'
import type { ExperimentStatus } from './experiments'

export interface ClientAutomation {
  id: string
  event: SiteEventType
  selector?: string
  threshold?: number
  /** Fire at most once per visitor (AGL-266). */
  oncePerVisitor?: boolean
  /** Fire at most once per browser session (AGL-274). */
  oncePerSession?: boolean
  /** Minimum minutes between fires for the same visitor (AGL-274). */
  cooldownMinutes?: number
  /** Fire on every occurrence, not once per pageview (AGL-562). */
  everyTime?: boolean
  steps: HostActionStep[]
  hasServerSteps: boolean
}

export interface ScreenExperiment {
  id: string
  target: 'screen' | 'section'
  status: ExperimentStatus
  nodeId?: string
  winnerVariantId?: string
  /** Past this the client runner serves the default (AGL-273). */
  endAtMs?: number
  goal?: { event: string; filter?: string }
  variants: Array<{ id: string; weight?: number; versionId?: string }>
  payloads: Record<string, Record<string, any> | null>
}

export interface AnnouncementBarData {
  text: string
  href?: string
  backgroundColor?: string
  textColor?: string
  dismissible: boolean
  contentHash: string
  overlayId?: string
}

export interface PopupData {
  headline?: string
  body: string
  imageUrl?: string
  ctaLabel?: string
  ctaHref?: string
  trigger: string
  triggerValue: number
  frequencyDays: number
  collectEmail?: boolean
  startAtMs?: number
  endAtMs?: number
  contentHash: string
  overlayId?: string
}
