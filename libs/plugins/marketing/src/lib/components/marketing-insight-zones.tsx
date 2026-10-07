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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * The zone a marketing report hosts in its header (AGL-3603): the
 * Conversions section and one campaign's report.
 *
 * A widget here explains the figures the page shows, in words. It is handed
 * the site the figures are one site's — the site picked on the
 * organization's Conversions section, the site a campaign email was sent as —
 * and what the page is about, and nothing else: the figures it reads are the
 * ones this plugin publishes to other plugins as figure readers
 * (`server/marketing-figures.ts`), never this page's documents. There is
 * nothing to apply and nothing a widget may write.
 */

/** What the report a widget sits on is about. */
export type MarketingInsightSubject = 'conversions' | 'campaign'

/** What {@link MARKETING_INSIGHTS_ZONE} hands each widget. */
export interface MarketingInsightsZoneProps {
  /** The site the figures are one site's; `null` when the page has none to name yet. */
  hostId: string | null
  subject: MarketingInsightSubject
  /** One campaign's report: the subject line it is known by. `null` elsewhere. */
  campaign: string | null
}

export const MARKETING_INSIGHTS_ZONE =
  definePluginZone<MarketingInsightsZoneProps>('marketingInsights')

/** The report's zone, drawn through the shell's renderer, or nothing outside the shell. */
export function MarketingInsightsZone(props: MarketingInsightsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? <Slot slot={MARKETING_INSIGHTS_ZONE.id} {...props} /> : null
}
MarketingInsightsZone.displayName = 'MarketingInsightsZone'
