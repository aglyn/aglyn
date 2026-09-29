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
 * machines that fetch images rather than links:
 *
 * - **Apple Mail Privacy Protection** fetches every remote image of every
 *   message through Apple's proxy when the message arrives, whether or not
 *   anyone reads it. Its fetch names itself only as `Mozilla/5.0`.
 * - **Mail providers' image proxies** — Gmail's `GoogleImageProxy`, Yahoo's —
 *   fetch the image on the reader's behalf, and cache it. A Gmail reader's
 *   open therefore arrives as the proxy's, indistinguishable from the proxy
 *   prefetching it, and is counted here as a machine's. The rate that
 *   leaves is low rather than inflated, and the card shows the proxy count
 *   beside it so the reader can see how much was set aside.
 * - **Gateways and scanners** that open the message to inspect it, which
 *   name themselves as the click scanners do, or arrive within seconds of
 *   delivery.
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
const IMAGE_PROXY_AGENTS = ['googleimageproxy', 'ggpht.com', 'yahoomailproxy']

/**
 * The agent Apple's Mail Privacy Protection proxy sends: the bare product
 * token, with no platform after it — which no browser or mail client that
 * shows an image to a person sends.
 */
const APPLE_PRIVACY_AGENT = 'mozilla/5.0'

/** Why an open was read as a machine's. */
export type OutreachOpenMachineReason = 'agent' | 'too_soon' | 'method' | 'image_proxy' | 'privacy_proxy'

/** The reasons that are a mail provider's proxy rather than a scanner. */
export const OUTREACH_PROXY_OPEN_REASONS: readonly OutreachOpenMachineReason[] = ['image_proxy', 'privacy_proxy']

/** What one fetch of a tracking image was. */
export interface OutreachOpenJudgement {
  /** Whether it counts toward the open rate. */
  human: boolean
  /** Why it does not; `null` when it does. */
  machineReason: OutreachOpenMachineReason | null
}

/**
 * Whether one fetch of a tracking image is a person's open.
 *
 * Read before the open is recorded, never before the image is answered:
 * every fetch gets the same image.
 *
 * @param input.sinceSentMs Milliseconds between the send and this fetch, or
 *   `null` when the send it belongs to could not be found.
 */
export function judgeOutreachOpen(input: {
  method: string
  userAgent: string | null | undefined
  sinceSentMs: number | null
}): OutreachOpenJudgement {
  const machine = (machineReason: OutreachOpenMachineReason): OutreachOpenJudgement => ({
    human: false,
    machineReason,
  })
  if (String(input.method ?? '').toUpperCase() === 'HEAD') return machine('method')
  const agent = String(input.userAgent ?? '').trim().toLowerCase()
  if (!agent) return machine('agent')
  if (IMAGE_PROXY_AGENTS.some((needle) => agent.includes(needle))) return machine('image_proxy')
  if (agent === APPLE_PRIVACY_AGENT) return machine('privacy_proxy')
  if (OUTREACH_MACHINE_AGENTS.some((needle) => agent.includes(needle))) return machine('agent')
  // A fetch before its send is two clocks disagreeing, and read as a person's.
  if (input.sinceSentMs !== null && input.sinceSentMs >= 0 && input.sinceSentMs < OUTREACH_OPEN_HUMAN_DELAY_MS) {
    return machine('too_soon')
  }
  return { human: true, machineReason: null }
}
