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

/*==========================================
 * THE RISK NOTICES, AS SYSTEM EMAILS (AGL-3368).
 *
 * Every kind in the risk notice catalog sends its owner email under its own
 * key (`risk-<kind>`), so staff can redesign what, say, a lock notice looks
 * like on the System emails page without touching a held-email notice. Two
 * more keys carry the burst digest and the acknowledgment an owner gets when
 * they request a review.
 *
 * Generated from the catalog rather than written out 40-odd times: the
 * content is the same shape for every kind — the title, what happened, what
 * it means, the numbered steps and the actions — and the catalog is where
 * the words live. The merge tokens below are what `notifyRiskEvent` fills.
 *=========================================*/

import {
  RISK_EVENT_KINDS,
  RISK_NOTICE_CATALOG,
  RISK_NOTICE_DIGEST_EMAIL_KEY,
  riskNoticeEmailKey,
} from './risk-notice-catalog'
import type {
  SystemEmailDefaultBlock,
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

/** The key an owner's review-request acknowledgment is designed under. */
export const RISK_REVIEW_REQUESTED_EMAIL_KEY = 'risk-review-requested'

/** The tokens every risk notice email is rendered with. */
export const RISK_NOTICE_EMAIL_TOKENS: readonly SystemEmailMergeToken[] = [
  {
    name: 'notice.title',
    description: 'The notice, in one line (also the subject)',
    sample: 'An email is on hold for review',
  },
  {
    name: 'notice.summary',
    description: 'What happened, on what, and when',
    sample:
      'Our automated safety review held the campaign "Spring sale" from Test Org on Sep 28, 2026, 16:31 UTC before it was sent.',
  },
  {
    name: 'notice.meaning',
    description: 'What it means for the reader',
    sample: 'This email was not sent. Nobody on your list received it.',
  },
  {
    name: 'notice.steps',
    description: 'What to do next, as a numbered list',
    sample: '1. Open the email and check it.\n2. If you think this is a mistake, choose Request a review.',
  },
  {
    name: 'notice.actions',
    description: 'Every action, one per line, as label and link',
    sample: 'Request a review: https://app.example.com/test-org/settings/holds',
  },
  {
    name: 'notice.primaryActionLabel',
    description: 'The main action’s label',
    sample: 'Request a review',
  },
  {
    name: 'notice.primaryActionUrl',
    description: 'The main action’s link',
    sample: 'https://app.example.com/test-org/settings/holds',
  },
  {
    name: 'workspace.name',
    description: 'The workspace the notice is about',
    sample: 'Test Org',
  },
  {
    name: 'lock.message',
    description: 'The message staff wrote with a lock, when there is one',
    sample: 'Access is temporarily disabled while we investigate a security concern.',
  },
  {
    name: 'reference',
    description: 'The case reference support knows it by',
    sample: 'HS-0A1B2C3D4E',
  },
  {
    name: 'holds.url',
    description: 'The workspace’s Holds & reviews page',
    sample: 'https://app.example.com/test-org/settings/holds',
  },
  {
    name: 'help.url',
    description: 'The help page explaining holds and reviews',
    sample: 'https://docs.example.com/help/holds-and-reviews',
  },
]

/** The content every risk notice email starts from. */
export const RISK_NOTICE_DEFAULT_BODY: readonly SystemEmailDefaultBlock[] = [
  { block: 'text', text: '{{notice.title}}', variant: 'heading' },
  { block: 'text', text: '{{notice.summary}}', variant: 'body' },
  { block: 'text', text: '{{notice.meaning}}', variant: 'body' },
  { block: 'text', text: 'What to do next', variant: 'subheading' },
  { block: 'text', text: '{{notice.steps}}', variant: 'body' },
  { block: 'button', label: '{{notice.primaryActionLabel}}', href: '{{notice.primaryActionUrl}}' },
  { block: 'text', text: '{{notice.actions}}', variant: 'caption' },
  {
    block: 'text',
    text: 'Reference {{reference}}. Why was something held or flagged? {{help.url}}',
    variant: 'caption',
  },
]

const FOOTER_REASON =
  'You’re receiving this because it concerns your {{brand.productName}} account or ' +
  'a workspace you own or manage. It is sent even if notification email is off.'

const SOURCE = 'libs/tenant/data/admin/src/lib/server/risk-notice.ts'

/** One System emails entry per risk kind, plus the digest and the review acknowledgment. */
export const RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] = [
  ...RISK_EVENT_KINDS.map((kind): SystemEmailTemplateDefinition => {
    const definition = RISK_NOTICE_CATALOG[kind]
    return {
      key: riskNoticeEmailKey(kind),
      name: `Risk notice: ${definition.owner.title.replace(/\{\{[^}]*\}\}/g, '…')}`,
      description:
        `Sent to the owners and admins when this happens (${kind}). ` +
        'Transactional: it ignores notification settings and reaches a locked workspace.',
      deliveredBy: 'resend',
      defaultSubject: '{{notice.title}}',
      mergeTokens: [...RISK_NOTICE_EMAIL_TOKENS],
      defaultBody: RISK_NOTICE_DEFAULT_BODY,
      footerReason: FOOTER_REASON,
      source: SOURCE,
    }
  }),
  {
    key: RISK_NOTICE_DIGEST_EMAIL_KEY,
    name: 'Risk notice: summary of held or flagged items',
    description:
      'Sent instead of one email per item when many items on a workspace are held or ' +
      'flagged within an hour.',
    deliveredBy: 'resend',
    defaultSubject: '{{notice.title}}',
    mergeTokens: [...RISK_NOTICE_EMAIL_TOKENS],
    defaultBody: RISK_NOTICE_DEFAULT_BODY,
    footerReason: FOOTER_REASON,
    source: SOURCE,
  },
  {
    key: RISK_REVIEW_REQUESTED_EMAIL_KEY,
    name: 'Risk notice: review request received',
    description:
      'Sent to an owner or admin who asked for a review of a held or flagged item, ' +
      'confirming the request reached the review team.',
    deliveredBy: 'resend',
    defaultSubject: '{{notice.title}}',
    mergeTokens: [...RISK_NOTICE_EMAIL_TOKENS],
    defaultBody: RISK_NOTICE_DEFAULT_BODY,
    footerReason: FOOTER_REASON,
    source: SOURCE,
  },
]
