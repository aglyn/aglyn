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

import { OUTREACH_MACHINE_AGENTS, outreachBodyLinks } from './click-tracking'
import type { OutreachOpenSource } from './open-source'

/*==========================================
 * OPENS, WHEN A SEQUENCE ASKS FOR THEM (AGL-3395).
 *
 * A sequence email is plain text, and a plain-text email cannot report an
 * open: an open is a fetch of an image, and an image needs an HTML part
 * (`./click-tracking.ts` says why that is the default). A sequence that
 * turns on "Count opens" accepts the cost of one, for the sends it makes
 * from then on.
 *
 * ## What the HTML part is
 *
 * The plain-text part is sent exactly as it would have been. The HTML part
 * beside it is the SAME TEXT — escaped, its line breaks as `<br>`, its bare
 * links made into anchors to the same address — with a 1×1 image at the end.
 * No styling, no layout, no second copy of anything: a client that shows
 * the HTML part shows what the plain-text part says, in the reader's own
 * font, and the image is the only thing the text does not carry.
 *
 * The image is a short link (AGL-3297) on the same host the clicks use, so
 * the email names no address a click does not already name.
 *
 * ## What it costs
 *
 * A one-to-one email from a person has no HTML part; one with a remote
 * image reads, to a filter, as marketing. Some gateways score it. That is
 * why the setting is per sequence, off by default, and said in the editor
 * where it is turned on.
 *==========================================*/

/** Every character HTML gives a meaning to, as the entity that does not. */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text safe to place in HTML content or a double-quoted attribute. */
export function escapeOutreachHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

/** One run of text, escaped, with its line breaks as `<br>`. */
const escapedLines = (text: string): string =>
  escapeOutreachHtml(text).replace(/\r\n|\r|\n/g, '<br>\n')

/**
 * The HTML part for a plain-text email and its tracking image.
 *
 * @param text The plain-text body as it is sent, footer included — so the
 *   HTML part carries the organization's identification and the way out
 *   word for word, and any link click tracking already rewrote stays the
 *   rewritten link.
 * @param pixelUrl The image's address. Written into a quoted attribute
 *   after escaping, so no value can close the attribute.
 */
export function outreachOpenTrackedHtml(text: string, pixelUrl: string): string {
  const body = String(text ?? '')
  let html = ''
  let cursor = 0
  // Linked by the same reader click tracking rewrites by, so a link the
  // plain text offers is exactly a link the HTML offers.
  for (const link of outreachBodyLinks(body)) {
    html += escapedLines(body.slice(cursor, link.start))
    const href = escapeOutreachHtml(link.url)
    html += `<a href="${href}">${href}</a>`
    cursor = link.end
  }
  html += escapedLines(body.slice(cursor))
  const src = escapeOutreachHtml(pixelUrl)
  return (
    '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n' +
    `<div dir="auto">${html}</div>\n` +
    `<img src="${src}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">\n` +
    '</body>\n</html>\n'
  )
}

/*==========================================
 * WHO OPENED: A PERSON, OR A MACHINE.
 *
 * The same judgement scanner clicks get (`./click-tracking.ts`), with the
 * machines that fetch images rather than links — told apart by what a fetch
 * says it is AND where it came from (AGL-3488), because the agent alone
 * cannot separate them:
 *
 * - **Apple Mail Privacy Protection** fetches every remote image of every
 *   message as it arrives, whether or not anyone reads it, naming itself
 *   only as `Mozilla/5.0` — and from Apple's relay egress, never from
 *   Google's or Microsoft's mail servers. The bare agent from anywhere else
 *   is a scanner borrowing it, and is called one: a sequence mailing
 *   Google Workspace addresses once read 128 such fetches as Apple's.
 * - **Gmail's `GoogleImageProxy`** is NOT a machine here. Gmail fetches
 *   through it when the reader opens the message, so outside the delivery
 *   window its fetch is the reader's open, and setting it apart would leave
 *   the rate blind to every Gmail and Workspace reader. The proxy caches the
 *   image, so a reader's later opens may not arrive at all; the rate is
 *   taken over first opens per person either way. Gmail's PREFETCH, which
 *   fetches on delivery for some signed-in recipients, names a 2015 Edge
 *   instead — no reader's browser — and is a scanner.
 * - **Google's and Microsoft's mail scanning** fetches from their mail
 *   networks with whatever agent it likes. Anything from Google's own
 *   network that is not the image proxy is a scanner, and so is anything
 *   from Exchange Online Protection, Microsoft's mail filter. The rest of
 *   Microsoft's mail network is NOT judged by itself: Outlook on the web
 *   loads images through it when the reader opens the message.
 * - **Yahoo's image proxy** fetches on the provider's behalf, and is set
 *   apart as a proxy.
 * - **Gateways and scanners** that name themselves as the click scanners
 *   do, or that arrive within seconds of delivery.
 *
 * Every fetch's agent and network are kept on its history row, so a
 * judgement can be checked against what actually arrived.
 *
 * Counted apart, never dropped: `machineOpens` beside `opens`, as
 * `machineClicks` beside `clicks`.
 *==========================================*/

/**
 * How soon after a send an open is a machine's however it identifies
 * itself — the click window's reasoning, for the same reason: a proxy or a
 * gateway fetches as the message is delivered, and a person reading a cold
 * email does not.
 */
export const OUTREACH_OPEN_HUMAN_DELAY_MS = 30_000

/** Image proxies that fetch on a mail provider's behalf, matched as substrings of the agent. */
const IMAGE_PROXY_AGENTS = ['yahoomailproxy']

/**
 * Gmail's image proxy, which fetches when the reader opens the message and
 * so counts as their open — see the note above. It names itself in an agent
 * the scanner list would otherwise match (`googleimageproxy`).
 */
const GMAIL_PROXY_AGENTS = ['googleimageproxy', 'ggpht.com']

/**
 * Gmail's prefetch: Chrome 42 and Edge 12 in one agent, both from 2015,
 * matched together so neither browser alone is ever read as a machine.
 */
const GMAIL_PREFETCH_AGENT_PARTS = ['chrome/42.0.2311.135', 'edge/12.246']

/**
 * The agent Apple's Mail Privacy Protection proxy sends: the bare product
 * token, with no platform after it — which no browser or mail client that
 * shows an image to a person sends.
 */
const BARE_AGENT = 'mozilla/5.0'

/** The longest agent kept on a history row: evidence, not a store for whatever a caller sends. */
export const OUTREACH_OPEN_AGENT_MAX = 400

/**
 * Why an open was read as a machine's. `scanner` (AGL-3488) is a mail
 * provider's or a security product's fetch, known by where it came from;
 * `agent` is one known by what it called itself.
 */
export type OutreachOpenMachineReason =
  | 'agent'
  | 'too_soon'
  | 'method'
  | 'image_proxy'
  | 'privacy_proxy'
  | 'scanner'

/** The reasons that are a mail provider's proxy rather than a scanner. */
export const OUTREACH_PROXY_OPEN_REASONS: readonly OutreachOpenMachineReason[] = ['image_proxy', 'privacy_proxy']

/** What one fetch of a tracking image was. */
export interface OutreachOpenJudgement {
  /** Whether it counts toward the open rate. */
  human: boolean
  /** Why it does not; `null` when it does. */
  machineReason: OutreachOpenMachineReason | null
}

/** The agent as a history row keeps it: trimmed, on one line, and no longer than {@link OUTREACH_OPEN_AGENT_MAX}. */
export function outreachOpenAgentEvidence(userAgent: string | null | undefined): string | null {
  // Every control character, a line break included, read as a space.
  const agent = Array.from(String(userAgent ?? ''), (character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : character
  })
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
  return agent ? agent.slice(0, OUTREACH_OPEN_AGENT_MAX) : null
}

/**
 * Whether one fetch of a tracking image is a person's open.
 *
 * Read before the open is recorded, never before the image is answered:
 * every fetch gets the same image.
 *
 * @param input.sinceSentMs Milliseconds between the send and this fetch, or
 *   `null` when the send it belongs to could not be found.
 * @param input.source The network the fetch came from (`./open-source.ts`),
 *   or `null` when no address was read — judged then by the agent alone,
 *   as every fetch was before AGL-3488.
 */
export function judgeOutreachOpen(input: {
  method: string
  userAgent: string | null | undefined
  sinceSentMs: number | null
  source?: OutreachOpenSource | null
}): OutreachOpenJudgement {
  const machine = (machineReason: OutreachOpenMachineReason): OutreachOpenJudgement => ({
    human: false,
    machineReason,
  })
  const source = input.source ?? null
  if (String(input.method ?? '').toUpperCase() === 'HEAD') return machine('method')
  const agent = String(input.userAgent ?? '').trim().toLowerCase()
  if (!agent) return machine('agent')
  if (source === 'yahoo' || IMAGE_PROXY_AGENTS.some((needle) => agent.includes(needle))) return machine('image_proxy')
  if (agent === BARE_AGENT) {
    // Apple's agent from Apple's relay — or from nowhere we could read,
    // which is how every such fetch was judged before the address was.
    return machine(source === null || source === 'apple' ? 'privacy_proxy' : 'scanner')
  }
  if (GMAIL_PREFETCH_AGENT_PARTS.every((part) => agent.includes(part))) return machine('scanner')
  const gmail = GMAIL_PROXY_AGENTS.some((needle) => agent.includes(needle))
  // Gmail's proxy fetches from Google's network; the same words from any
  // other network that could be read are someone else's.
  if (gmail && source !== null && source !== 'google') return machine('agent')
  if (!gmail && OUTREACH_MACHINE_AGENTS.some((needle) => agent.includes(needle))) return machine('agent')
  if (!gmail && (source === 'google' || source === 'microsoft_filter')) return machine('scanner')
  // A fetch before its send is two clocks disagreeing, and read as a person's.
  if (input.sinceSentMs !== null && input.sinceSentMs >= 0 && input.sinceSentMs < OUTREACH_OPEN_HUMAN_DELAY_MS) {
    return machine('too_soon')
  }
  return { human: true, machineReason: null }
}
