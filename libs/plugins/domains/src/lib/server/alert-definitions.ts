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

/*
 * What staff are told about bought domains (AGL-3962). Only what the sweep
 * cannot settle on its own: money taken that a refund did not return, an
 * order the registrar never finished, a name nobody is paying for. Every
 * other branch of the lifecycle ends without a person.
 */

const HOUR = 60
const DAY = 24 * HOUR

export const DOMAINS_OPERATOR_ALERTS: readonly OperatorAlertDefinition[] = [
  {
    type: 'domains.refundFailed',
    label: 'A domain refund did not go through',
    description:
      'A domain charge had to be refunded — its registration failed — and Stripe refused the refund. The customer has paid for a name they do not hold: refund the invoice from the staff org page.',
    tier: 'must',
    category: 'billing',
    title: 'Refund failed for {{domain}}',
    body: 'The charge for {{domain}} (workspace {{orgId}}) could not be refunded after {{reason}}. Refund it by hand.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.orderStuck',
    label: 'A domain order is stuck at the registrar',
    description:
      'A registrar order has been pending for over a day. The customer was charged; ask the registrar what became of it.',
    tier: 'must',
    category: 'ops',
    title: 'Domain order pending a day: {{domain}}',
    body: 'Order {{reason}} for {{domain}} (workspace {{orgId}}) is still pending. The sweep keeps reading it; ask the registrar if it does not finish.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.swapRollbackFailed',
    label: 'A domain swap could not be undone',
    description:
      'A workspace moved a domain onto a site, the connect did not finish, and putting the site’s previous domain (or the moved name) back failed (AGL-4040). A site may be on its free address. Reconnect the domain named in the reason from the staff site page, or ask the owner to from the Domains page.',
    tier: 'must',
    category: 'ops',
    title: 'Domain swap not undone: {{domain}}',
    body: 'Moving {{domain}} (workspace {{orgId}}) onto a site could not be undone ({{reason}}). A site may be left without its custom domain.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.transferStuck',
    label: 'A domain transfer in has not finished in two weeks',
    description:
      'A workspace paid to move a domain here from another registrar and the transfer is still pending after two weeks (AGL-4040). The sweep keeps reading it and refunds it if the registrar reports it failed; ask the registrar what it is waiting on.',
    tier: 'should',
    category: 'ops',
    title: 'Transfer in pending two weeks: {{domain}}',
    body: 'The transfer of {{domain}} (workspace {{orgId}}) is still pending at the registrar ({{reason}}).',
    delivery: 'digest',
    dedupeWindowMinutes: 7 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.renewalFailedAtRegistrar',
    label: 'A paid domain renewal was refused by the registrar',
    description:
      'The customer paid for a renewal and the registrar would not renew. The charge was refunded and the sweep will try again; if the name is near expiry, renew it by hand.',
    tier: 'must',
    category: 'ops',
    title: 'Renewal refused for {{domain}}',
    body: 'The registrar refused the renewal of {{domain}} (workspace {{orgId}}): {{reason}}. The charge was refunded.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.renewalUnpaid',
    label: 'A domain renewed without a payment',
    description:
      'The registrar renewed a name on its own (the backstop) and the customer’s card refused the charge for it. Decide whether to collect or let it go.',
    tier: 'should',
    category: 'billing',
    title: '{{domain}} renewed unpaid',
    body: 'The registrar renewed {{domain}} (workspace {{orgId}}) and the charge for it was declined ({{reason}}).',
    delivery: 'digest',
    dedupeWindowMinutes: 7 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.orphanRegistration',
    label: 'A domain in the registrar account has no owner here',
    description:
      'The daily reconcile found a name in the registrar account that no registration accounts for — usually a workspace erased while it held one. Its auto-renew was turned off.',
    tier: 'should',
    category: 'billing',
    title: 'Unowned domain: {{domain}}',
    body: '{{domain}} is registered in the platform’s registrar account with no registration here. Auto-renew was turned off for it.',
    delivery: 'digest',
    dedupeWindowMinutes: 30 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'domains.disputed',
    label: 'A domain charge was disputed',
    description:
      'A cardholder disputed a domain charge. Renewals for the name stopped and its auto-renew was turned off; nothing else changed.',
    tier: 'should',
    category: 'payments',
    title: 'Dispute on a domain charge: {{domain}}',
    body: 'A charge for {{domain}} (workspace {{orgId}}) was disputed. Its renewals are paused.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
]
