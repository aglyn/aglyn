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

import {
  CAMPAIGN_CONVERSION_KINDS,
  type CampaignConversionKind,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-conversions'
import ConversionAttribution from './conversion-attribution.component'

/**
 * The widget this plugin draws in another plugin's record-attribution zone.
 *
 * The CRM and the Inbox each host a zone on a record and hand it
 * `{ hostId, recordKind, recordId }` in their own words. Those words are the
 * identify moments this plugin credits a conversion at, so the widget reads
 * the kind as one — and draws nothing for a kind it never credits, rather
 * than reading a document that cannot exist.
 */
export interface RecordAttributionWidgetProps {
  hostId?: string | null
  recordKind?: string
  recordId?: string
}

const isConversionKind = (kind: unknown): kind is CampaignConversionKind =>
  (CAMPAIGN_CONVERSION_KINDS as readonly unknown[]).includes(kind)

export function RecordAttributionWidget(props: RecordAttributionWidgetProps) {
  const { hostId, recordKind, recordId } = props
  if (!hostId || !recordId || !isConversionKind(recordKind)) return null
  return <ConversionAttribution hostId={hostId} kind={recordKind} refId={recordId} />
}
RecordAttributionWidget.displayName = 'RecordAttributionWidget'

export default RecordAttributionWidget
