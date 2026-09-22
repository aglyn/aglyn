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
 * Two hard bounces look alike to the delivery report — `failed`, a `5.x.x`
 * status — and mean different things. `550 5.1.1 no such user` is a verdict
 * on ONE ADDRESS: the person left, or the address was never right. `550
 * 5.7.1 ... :blocked` from a Barracuda, a Proofpoint or a Mimecast is a
 * verdict on THE SENDER by the whole recipient organization: its gateway
 * refused the mail on policy or reputation, and the next address at that
 * company will bounce the same way and count against the same bounce rule.
 *
 * So a hard bounce is read once more, for which of the two it is. The words
 * that name a gateway or a policy make it a block, and so does a bare
 * `5.7.0` / `5.7.1` (RFC 3463's "delivery not authorized" and "message
 * refused"); any wording that says the ADDRESS is the problem — user
 * unknown, mailbox not found, a `5.1.x` or `5.2.x` status — outranks them,
 * because a server that names the address is talking about the address.
 * The tie goes to the address: only the block is filed against the domain.
 *==========================================*/

/** What a bounce says, as the classifier hands it over. */
export interface OutreachBounceReading {
  /** The enhanced status code, `5.7.1`, when the report carried one. */
  status: string | null
  /** The server's diagnostic line, when it gave one. */
  diagnostic: string | null
}

/** The words a gateway or a policy refusal is written in. */
const GATEWAY_WORDS =
  /barracuda|proofpoint|mimecast|:blocked\b|blocked using|\bpolicy\b|spamhaus|reputation|\bblock ?list|\bblacklist|\bdenylist|\bbanned\b|\brbl\b|\bdnsbl\b/i

/** The words, and the status classes, that say one address is the problem. */
const ADDRESS_WORDS =
  /no such (user|mailbox|recipient|address|person)|unknown (user|recipient|address|mailbox|account)|(user|mailbox|recipient|address|account|email)\b[^.;\n]{0,40}\b(unknown|not found|does ?n[o']?t exist|doesn't exist|invalid|disabled|unavailable|inactive)|recipient ?not ?found|does not exist|doesn't exist|invalid (recipient|mailbox|address)|mailbox (unavailable|full|disabled)|address rejected|\b5\.[12]\.\d{1,3}\b/i

/** Whether a hard bounce reads as the domain's gateway refusing the sender — see the module note. */
export function isOutreachGatewayBlock(bounce: OutreachBounceReading | null | undefined): boolean {
  if (!bounce) return false
  const text = `${bounce.status ?? ''} ${bounce.diagnostic ?? ''}`.trim()
  if (!text) return false
  if (ADDRESS_WORDS.test(text)) return false
  if (GATEWAY_WORDS.test(text)) return true
  return /\b5\.7\.[01]\b/.test(text)
}

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
