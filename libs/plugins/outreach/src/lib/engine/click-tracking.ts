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
 * CLICKS, IN A PLAIN-TEXT EMAIL (AGL-3239).
 *
 * A marketing campaign gets its opens and clicks from Resend, which rewrites
 * the links and injects a pixel into the HTML part before the message leaves.
 * A sequence has neither half of that: it goes out through the rep's own
 * Gmail, and it goes out as plain text on purpose.
 *
 * ## Why there is no open rate here, and never a zero one
 *
 * An open is measured by a pixel, a pixel is an `<img>`, and an `<img>` needs
 * an HTML part. Giving cold one-to-one email a multipart HTML body is the
 * deliverability posture this plugin was built to avoid, so opens are not
 * measured at all — and the report SAYS SO rather than rendering 0%, exactly
 * as `campaign-report.ts` withholds a rate whose denominator was never
 * recorded. A zero that could only ever have been zero measures our sending
 * code, not the recipient.
 *
 * A click needs no HTML. It needs the destination in the body to be a link of
 * ours that forwards to theirs, which is what this module writes.
 *
 * ## What it will and will not rewrite
 *
 * Only bare `http:`/`https:` URLs, and only in the STEP'S OWN BODY — the
 * rewrite runs on the rendered body before the footer is appended, so the
 * organization's legal name, its postal address and the way out are never
 * touched. `mailto:` is left alone: the opt-out address is the one link in a
 * cold email that must not route through us.
 *==========================================*/

/**
 * A URL as it appears in a plain-text body, with where it was found.
 *
 * `end` is exclusive, so `text.slice(start, end)` is exactly `url`.
 */
export interface OutreachBodyLink {
  url: string
  start: number
  end: number
}

/**
 * Trailing characters a sentence puts after a URL that are not part of it.
 *
 * A plain-text body is prose, so a link is routinely followed by a full stop,
 * a comma or a closing bracket. Taking those into the URL would rewrite a
 * destination nobody wrote and forward the recipient to a 404.
 */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/

/**
 * A bare http(s) URL, up to the first whitespace or bracket that never
 * belongs in one.
 *
 * `(` and `)` are NOT excluded, because a real path can contain them — a
 * Wikipedia article is the everyday example — and {@link trimUrlEnd}
 * decides which trailing one is the URL's and which is the sentence's.
 */
const URL_PATTERN = /https?:\/\/[^\s<>[\]{}"']+/gi

/**
 * Trims what the sentence put after the URL, not what the URL contains.
 *
 * A closing bracket is the URL's when the URL opened one, and the
 * sentence's when it did not — which is the usual case, a link inside a
 * parenthetical. Counted rather than merely looked for, so a link that is
 * both parenthesised AND contains brackets loses exactly the outer one.
 */
function trimUrlEnd(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, '')
  while (url.endsWith(')')) {
    const opened = url.split('(').length - 1
    const closed = url.split(')').length - 1
    if (closed <= opened) break
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return url
}

/**
 * Every http(s) URL in a plain-text body, in the order they appear.
 *
 * Duplicates are returned as the separate occurrences they are: the same
 * destination written twice is two links to rewrite, and each gets its own
 * index so a click says which one was followed.
 */
export function outreachBodyLinks(text: string): OutreachBodyLink[] {
  const body = String(text ?? '')
  const links: OutreachBodyLink[] = []
  for (const match of body.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const url = trimUrlEnd(match[0])
    if (!url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    links.push({ url, start, end: start + url.length })
  }
  return links
}

/** What {@link rewriteOutreachBodyLinks} produced. */
export interface OutreachRewrittenBody {
  text: string
  /**
   * The destinations that were rewritten, in the order their tracking links
   * were minted — the index a click token names.
   *
   * Empty when nothing was rewritten, which is what a body with no links, a
   * sequence with tracking off, and a minter that could not sign all read as.
   */
  links: string[]
}

/**
 * Rewrites every link in a plain-text body to a tracking link.
 *
 * @param text The rendered step body, footer NOT yet appended.
 * @param mint Answers the tracking URL for the link at `index`, or `null` to
 *   leave that one alone. A minter that cannot sign returns `null` for every
 *   link and the body goes out exactly as it was written — an email whose
 *   links do not work is far worse than an email we cannot measure.
 */
export function rewriteOutreachBodyLinks(
  text: string,
  mint: (link: { url: string; index: number }) => string | null,
): OutreachRewrittenBody {
  const body = String(text ?? '')
  const found = outreachBodyLinks(body)
  if (!found.length) return { text: body, links: [] }
  const links: string[] = []
  let out = ''
  let cursor = 0
  for (const link of found) {
    // The index a token carries is the index in `links`, which counts only
    // the links that were actually rewritten. A minter that skips one must
    // not shift the numbering of the ones after it.
    const tracked = mint({ url: link.url, index: links.length })
    out += body.slice(cursor, link.start)
    if (tracked) {
      out += tracked
      links.push(link.url)
    } else {
      out += link.url
    }
    cursor = link.end
  }
  return { text: out + body.slice(cursor), links }
}

/*==========================================
 * WHO CLICKED: A PERSON, OR A MACHINE.
 *
 * Every corporate mailbox now runs the links in an incoming email before the
 * recipient ever sees it — Microsoft Defender's Safe Links, Proofpoint,
 * Mimecast, Barracuda, and Gmail's own scanning. Each of those fetches is a
 * click by any definition a redirect handler can apply, and on cold B2B mail
 * they outnumber the human ones.
 *
 * Counting them is how a sequence reports a 60% click rate on an email
 * nobody read. So they are counted APART: `clicks` and `uniqueClicks` are
 * the human ones and carry the rate, `machineClicks` is kept beside them and
 * shown, because a number withheld silently is the other way to mislead.
 *
 * This is the same judgement `campaign-revenue.ts` records about Apple's Mail
 * Privacy Protection inflating opens — stated on the screen rather than
 * quietly corrected away.
 *==========================================*/

/**
 * How soon after a send a click is a machine's however it identifies itself.
 *
 * A scanner fetches as the message is delivered. A person has to receive the
 * mail, notice it and read it, and thirty seconds is faster than anyone does
 * that on a cold email — while being long enough to stay wrong only in the
 * rarest case, which is a rate that reads a little low rather than a rate
 * that reads triple.
 */
export const OUTREACH_CLICK_HUMAN_DELAY_MS = 30_000

/**
 * Agents that say what they are. Matched case-insensitively as substrings of
 * the user agent, so a version bump does not un-match one.
 *
 * Absence from this list is not evidence of a person — most scanners
 * impersonate a browser, which is what {@link OUTREACH_CLICK_HUMAN_DELAY_MS}
 * is for.
 */
const MACHINE_AGENTS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'preview',
  'scanner',
  'curl',
  'wget',
  'python-requests',
  'java/',
  'go-http-client',
  'okhttp',
  'headlesschrome',
  'phantomjs',
  'proofpoint',
  'mimecast',
  'barracuda',
  'symantec',
  'forcepoint',
  'microsoft office',
  'ms-office',
  'bingpreview',
  'skypeuripreview',
  'google-safety',
  'googleimageproxy',
  'apache-httpclient',
  'axios',
  'node-fetch',
  'urlresolver',
  'safelinks',
]

/** Why a click was read as a machine's, or `null` when it was a person's. */
export type OutreachClickMachineReason = 'agent' | 'too_soon' | 'method'

/** What one request to a tracking link was. */
export interface OutreachClickJudgement {
  /** Whether it counts toward the click rate. */
  human: boolean
  /** Why it does not; `null` when it does. */
  machineReason: OutreachClickMachineReason | null
}

/**
 * Whether one request to a tracking link is a person's.
 *
 * Read before the redirect is *recorded*, never before it is *answered*: a
 * machine is forwarded to the destination exactly as a person is, because a
 * scanner that gets a refusal reports the link as broken and the mail as
 * suspicious.
 *
 * @param input.method The HTTP method. A `HEAD` is a fetch of the headers
 *   alone, which no mail client does for a person following a link.
 * @param input.userAgent The request's agent, `''` when it sent none — which
 *   is itself a machine, since every browser sends one.
 * @param input.sinceSentMs Milliseconds between the send and this request,
 *   or `null` when the send it belongs to could not be found.
 */
export function judgeOutreachClick(input: {
  method: string
  userAgent: string | null | undefined
  sinceSentMs: number | null
}): OutreachClickJudgement {
  const machine = (machineReason: OutreachClickMachineReason): OutreachClickJudgement => ({
    human: false,
    machineReason,
  })
  if (String(input.method ?? '').toUpperCase() === 'HEAD') return machine('method')
  const agent = String(input.userAgent ?? '').trim().toLowerCase()
  if (!agent) return machine('agent')
  if (MACHINE_AGENTS.some((needle) => agent.includes(needle))) return machine('agent')
  /*
   * A click that arrives BEFORE the send it belongs to is a clock disagreeing
   * with itself, not a time traveller, and it is read as a person's: the one
   * thing worse than counting a scanner is refusing to count a real reply to
   * an email because two machines are a second apart.
   */
  if (input.sinceSentMs !== null && input.sinceSentMs >= 0 && input.sinceSentMs < OUTREACH_CLICK_HUMAN_DELAY_MS) {
    return machine('too_soon')
  }
  return { human: true, machineReason: null }
}
