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

import type { OperatorAlertDefinition } from '@aglyn/aglyn/app-utils/operator-alerts'
import { BUNDLE_ID } from './bundle-common'

/**
 * The marketing plugin's operator alerts (AGL-3377), registered from
 * `declarations.server`. Its events webhook is where every provider bounce
 * and complaint becomes a suppression, so a webhook that is failing is
 * mail the platform keeps sending to addresses that already refused it.
 */
const DAY = 24 * 60

export const MARKETING_EMAIL_EVENTS_FAILED: OperatorAlertDefinition = {
  type: 'marketing.emailEventsFailed',
  pluginId: BUNDLE_ID,
  label: 'Email events webhook failed to apply an event',
  description:
    'The email provider’s event webhook threw while applying an event and answered 200 so the provider would not retry. A bounce or complaint in it was not suppressed, so the address keeps being mailed.',
  tier: 'must',
  category: 'deliverability',
  title: 'A {{eventType}} email event was not applied',
  body:
    'The email events webhook failed on a {{eventType}} event ({{error}}). The provider will not retry it, so a bounce or complaint it carried was not suppressed.',
  delivery: 'immediate',
  dedupeWindowMinutes: 6 * 60,
  defaultEnabled: true,
}

export const MARKETING_EMAIL_EVENTS_UNCONFIGURED: OperatorAlertDefinition = {
  type: 'marketing.emailEventsUnconfigured',
  pluginId: BUNDLE_ID,
  label: 'Email events webhook has no signing secret',
  description:
    'The email provider is posting events and the install has no RESEND_WEBHOOK_SECRET, so every bounce and complaint is refused and none is suppressed.',
  tier: 'must',
  category: 'deliverability',
  title: 'Email events are being refused: no signing secret',
  body:
    'The email provider posted an event and RESEND_WEBHOOK_SECRET is not set, so it was refused. Bounces and complaints are not being suppressed until it is.',
  delivery: 'immediate',
  dedupeWindowMinutes: DAY,
  defaultEnabled: true,
}

export const MARKETING_EMAIL_EVENTS_SIGNATURE_REJECTED: OperatorAlertDefinition = {
  type: 'marketing.emailEventsSignatureRejected',
  pluginId: BUNDLE_ID,
  label: 'Email events webhook failing its signature check',
  description:
    'Repeated signed deliveries to the email events webhook matched no secret. Usually a rotated signing secret: until it is fixed, no bounce or complaint is suppressed.',
  tier: 'must',
  category: 'deliverability',
  title: 'Email events webhook is refusing deliveries',
  body:
    'The email events webhook refused several signed deliveries within six hours because their signature did not match RESEND_WEBHOOK_SECRET. Bounces and complaints are not being suppressed.',
  delivery: 'immediate',
  dedupeWindowMinutes: 6 * 60,
  minOccurrences: 3,
  defaultEnabled: true,
}

export const MARKETING_REPUTATION_BREAKER: OperatorAlertDefinition = {
  type: 'marketing.reputationBreakerTripped',
  pluginId: BUNDLE_ID,
  label: 'Campaign sending blocked by the reputation breaker',
  description:
    'A workspace’s bounce or complaint rate tripped the circuit breaker, so its campaigns are refused. Check the list before reinstating it.',
  tier: 'should',
  category: 'deliverability',
  title: 'Campaigns blocked on workspace {{orgId}}',
  // Staff's copy, in numbers (AGL-3432). The merchant's refusal is written
  // to "you" and lists what the merchant must do; staff's own step is to
  // check the list before reinstating.
  body:
    'Campaign sending is blocked on workspace {{orgName}} ({{orgId}}) by the reputation breaker. Its campaign mail over the last {{windowDays}} days: {{detail}} Nothing was removed from its lists, and its transactional mail still sends. Check its list before you reinstate it.',
  link: '/admin/orgs/{{orgId}}',
  delivery: 'immediate',
  dedupeWindowMinutes: DAY,
  defaultEnabled: true,
}

export const MARKETING_OPERATOR_ALERTS: readonly OperatorAlertDefinition[] = [
  MARKETING_EMAIL_EVENTS_FAILED,
  MARKETING_EMAIL_EVENTS_UNCONFIGURED,
  MARKETING_EMAIL_EVENTS_SIGNATURE_REJECTED,
  MARKETING_REPUTATION_BREAKER,
]
