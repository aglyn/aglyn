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
 * The disposable-mailbox services: an inbox that expires within minutes.
 *
 * Its own leaf (AGL-4230) because two readers need it. The deliverability
 * check refuses such an address at sign-up, and the CRM's company rules
 * never make a company from one. The CRM's helpers are shared with the
 * native apps, which may read only proven-pure modules, so the list sits
 * here with nothing beside it but the host normalizer.
 */

import { normalizeMailHost } from './mail-gateway'

/**
 * Domains that hand out a mailbox that expires. Not a complete list — no
 * list is — but the ones a signup form actually meets.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.net',
])

/** Whether a domain is a disposable-mailbox provider. */
export function isDisposableEmailDomain(domain: unknown): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(normalizeMailHost(domain))
}
