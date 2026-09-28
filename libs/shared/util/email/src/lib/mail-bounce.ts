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
 * A GATEWAY BLOCK IS NOT AN UNKNOWN USER (AGL-3244, AGL-3328).
 *
 * Two hard bounces look alike to a delivery report — failed, a `5.x.x`
 * status — and mean different things. `550 5.1.1 no such user` is a verdict
 * on ONE ADDRESS: the person left, or the address was never right. `550
 * 5.7.1 ... :blocked` from a Barracuda, a Proofpoint or a Mimecast is a
 * verdict on THE SENDER by the whole recipient organization: its gateway
 * refused the mail on policy or reputation, and the next address at that
 * company will bounce the same way.
 *
 * So a hard bounce is read once more, for which of the two it is. The words
 * that name a gateway or a policy make it a block, and so does a bare
 * `5.7.0` / `5.7.1` (RFC 3463's "delivery not authorized" and "message
 * refused"); any wording that says the ADDRESS is the problem — user
 * unknown, mailbox not found, a `5.1.x` or `5.2.x` status — outranks them,
 * because a server that names the address is talking about the address.
 * The tie goes to the address.
 *
 * Both transports read their bounces here: a Gmail DSN's structured fields
 * (Sequences) and a provider's free-text bounce message (Resend), which
 * {@link readBounceText} pulls the same three facts out of.
 *==========================================*/

import { mailGatewayOfHost, type MailGateway } from './mail-gateway'

/** What a bounce says, as the classifier reads it. */
export interface MailBounceReading {
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
export function isMailGatewayBlock(bounce: MailBounceReading | null | undefined): boolean {
  if (!bounce) return false
  const text = `${bounce.status ?? ''} ${bounce.diagnostic ?? ''}`.trim()
  if (!text) return false
  if (ADDRESS_WORDS.test(text)) return false
  if (GATEWAY_WORDS.test(text)) return true
  return /\b5\.7\.[01]\b/.test(text)
}

/** What a free-text bounce says, in the fields a DSN would have carried. */
export interface MailBounceText extends MailBounceReading {
  /** The receiving server the text names, lowercased, when it names one. */
  remoteMta: string | null
  /** The gateway that server, or the text's own wording, names. */
  gateway: MailGateway | null
}

/** An enhanced status code, `5.7.1`, anywhere in the text. */
const ENHANCED_STATUS = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/

/** A host name the text mentions: two or more labels, ending in letters. */
const HOST_NAME = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\b/gi

/** Gateway names written as words, for a message that names no host. */
const GATEWAY_BY_WORD: ReadonlyArray<readonly [RegExp, MailGateway]> = [
  [/barracuda/i, 'barracuda'],
  [/proofpoint|pphosted/i, 'proofpoint'],
  [/mimecast/i, 'mimecast'],
]

/**
 * The status, the remote server and the gateway a provider's bounce message
 * names, from its text — the facts a Gmail DSN hands over as fields, which a
 * provider like Resend folds into one sentence. Addresses are scrubbed from
 * the diagnostic before it is kept anywhere.
 */
export function readBounceText(text: unknown): MailBounceText {
  const raw = String(text ?? '').trim()
  if (!raw) return { status: null, diagnostic: null, remoteMta: null, gateway: null }
  const diagnostic = scrubBounceDiagnostic(raw)
  const status = raw.match(ENHANCED_STATUS)?.[0] ?? null
  let remoteMta: string | null = null
  let gateway: MailGateway | null = null
  for (const match of raw.replace(/[\w.+-]+@[\w.-]+/g, ' ').matchAll(HOST_NAME)) {
    const host = match[1].toLowerCase()
    const named = mailGatewayOfHost(host)
    if (named) {
      remoteMta = host
      gateway = named
      break
    }
    if (!remoteMta && /^(mx|mail|smtp|mta|inbound|relay)[\w-]*\./.test(host)) remoteMta = host
  }
  if (!gateway) gateway = GATEWAY_BY_WORD.find(([pattern]) => pattern.test(raw))?.[1] ?? null
  return { status, diagnostic, remoteMta, gateway }
}

/** A diagnostic with every address in it replaced, trimmed to what a table can show. */
export function scrubBounceDiagnostic(text: unknown): string | null {
  const said = String(text ?? '')
    .replace(/[\w.+-]+@[\w.-]+/g, '<address>')
    .replace(/\s+/g, ' ')
    .trim()
  return said ? said.slice(0, 300) : null
}
