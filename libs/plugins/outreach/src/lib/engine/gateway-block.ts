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
 * A GATEWAY BLOCK IS NOT AN UNKNOWN USER (AGL-3244).
 *
 * The reading is the platform's — `@aglyn/shared-util-email`'s
 * `mail-bounce` (AGL-3328), which reads a Resend bounce the same way a
 * Gmail DSN is read here. What stays is the sentence Sequences writes on
 * the enrollment when a block files the domain.
 *==========================================*/

import { isMailGatewayBlock, type MailBounceReading } from '@aglyn/shared-util-email/mail-bounce'

/** What a bounce says, as the classifier hands it over. */
export type OutreachBounceReading = MailBounceReading

/** Whether a hard bounce reads as the domain's gateway refusing the sender. */
export const isOutreachGatewayBlock = isMailGatewayBlock

/**
 * What the enrollment's stop detail says when its bounce was a gateway
 * block: that the domain was blocked and is on the list, then the
 * diagnostic — already scrubbed of the address — for the record.
 */
export function outreachGatewayBlockDetail(domain: string, diagnostic: string | null): string {
  const said = String(diagnostic ?? '').trim()
  return (
    `The mail gateway at ${domain} blocked the email, so ${domain} is on your organization's ` +
    `do-not-contact list and no address there will be emailed.${said ? ` The server said: ${said}` : ''}`
  )
}
