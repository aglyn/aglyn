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
 * A REPLY THAT SAYS STOP (AGL-2979).
 *
 * Every Outreach email tells its reader to reply "no" to be left alone, so
 * a reply has to be read for that. Any reply already stops its sequence;
 * reading one as an OPT-OUT also puts the address on the organization's
 * do-not-contact list, so no later sequence reaches it either. Both mistakes
 * cost something: a missed opt-out lets another sequence write to somebody
 * who said no, and a false one silently loses a prospect who said "no rush".
 *
 * ## Only the reply's own words
 *
 * A reply quotes the email it answers, and that email's footer says "Reply
 * 'no'". So the quoted history is cut first — the CRM capture reader's
 * `stripQuotedHistory` — along with a signature and any footer line a mail
 * client quoted without marking it.
 *
 * ## What counts
 *
 * - A short reply that says nothing but no: "No.", "No thanks", "Nope",
 *   "Pass", "Stop" — with a greeting and a sign-off allowed around it.
 * - A request anywhere in the reply: unsubscribe, remove me, take me off
 *   the list, stop emailing, don't contact me, opt out, no more emails —
 *   unless it is negated ("please don't remove me").
 * - "Not interested", unless it defers ("not interested yet", "not
 *   interested right now, try me next quarter") or asks ("not interested?").
 * - A reply that calls the email spam, which is also a COMPLAINT.
 *
 * "No rush", "no problem" and "no worries" are none of these: a "no" only
 * counts when it is the whole answer.
 *==========================================*/

import { stripQuotedHistory } from '@aglyn/aglyn/app-utils/crm-inbound'

export interface OutreachOptOutIntent {
  /** The reply asks not to be emailed again. */
  optOut: boolean
  /** The reply calls the email spam — an opt-out that also counts against the mailbox. */
  complaint: boolean
  /** The words that decided it, for the timeline and the log; `null` when nothing matched. */
  matched: string | null
}

const NONE: OutreachOptOutIntent = { optOut: false, complaint: false, matched: null }

/** A line of the footer every Outreach email carries, however a client re-quoted it. */
const FOOTER_LINE = /reply\s+["“”'‘’]?no["“”'‘’]?\s+and\s+i\s+won['’]?t\s+email|business\s+solicitation\s+from/i

/**
 * The words a reply adds to its thread: the text above the quoted history,
 * with a signature and any quoted footer line removed.
 */
export function outreachFreshReplyText(text: unknown): string {
  const body = stripQuotedHistory(
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u202f]/g, ' '),
  )
  const lines = body.split('\n')
  const signature = lines.findIndex((line) => /^--\s*$/.test(line))
  return (signature >= 0 ? lines.slice(0, signature) : lines)
    .filter((line) => !FOOTER_LINE.test(line))
    .join('\n')
    .trim()
}

/** Curly quotes straightened, case folded, whitespace settled. */
function fold(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const GREETING_LINE = /^(hi|hello|hey|dear|greetings|good (morning|afternoon|evening))\b[^\n]{0,40}$/i
const GREETING_LEAD = /^(hi|hello|hey|dear|greetings)(\s+[a-z'’-]+)?\s*[,!.:–—-]\s*/i
const SIGN_OFF =
  /^(thanks|thank you|thx|many thanks|cheers|regards|best|best regards|kind regards|warm regards|sincerely|all the best|sent from my\b.*|get outlook\b.*)[\s,.!]*$/i
const NAME = "[A-Z][a-z'’-]+( [A-Z][a-z'’-]+)?"
/** Thanks, then a signed name: "No thanks, Jordan" or "No thanks — Jordan". */
const THANKS_THEN_NAME = new RegExp(`\\b(thanks|thank you|thx|cheers)[\\s,–—-]+${NAME}[.!]?\\s*$`, 'i')
const NAME_LINE = new RegExp(`^${NAME}[.!]?$`)

/**
 * What is left of a reply once its greeting, its sign-off and a name signed
 * after "thanks" are gone. A name is only taken off after a thank-you,
 * because "No, WordPress." is an answer about a platform, not a signature.
 */
function answerOnly(fresh: string): string {
  const lines = fresh
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > 1 && GREETING_LINE.test(lines[0])) lines.shift()
  const signOff = lines.findIndex((line, index) => index > 0 && SIGN_OFF.test(line))
  const kept = signOff >= 0 ? lines.slice(0, signOff) : lines
  if (
    kept.length > 1 &&
    NAME_LINE.test(kept[kept.length - 1]) &&
    /\b(thanks|thank you|thx|cheers)[\s,.!]*$/i.test(kept[kept.length - 2])
  ) {
    kept.pop()
  }
  return kept
    .join(' ')
    .replace(GREETING_LEAD, '')
    .replace(THANKS_THEN_NAME, '$1')
}

/** The only words a reply may hold to be read as a bare "no". */
const BARE_NO_WORDS = new Set([
  'no',
  'nope',
  'nah',
  'pass',
  "i'll",
  'ill',
  'i',
  'will',
  'stop',
  'unsubscribe',
  'remove',
  'me',
  'us',
  'please',
  'thanks',
  'thank',
  'you',
  'thx',
  'sorry',
  'but',
  'not',
  'for',
  'interested',
])
const BARE_NO_TRIGGERS = new Set(['no', 'nope', 'nah', 'pass', 'stop', 'unsubscribe', 'remove'])

function bareNo(answer: string): string | null {
  const words = fold(answer)
    .replace(/[^a-z' ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
  if (!words.length || words.length > 6) return null
  if (!words.every((word) => BARE_NO_WORDS.has(word))) return null
  const said = words.join(' ')
  if (
    words.some((word) => BARE_NO_TRIGGERS.has(word)) ||
    /\bnot interested\b|\bnot for (me|us)\b/.test(said)
  ) {
    return said
  }
  return null
}

/** Negations that turn a request around when they come just before it. */
const NEGATED = /\b(don't|dont|do not|didn't|didnt|did not|never|not|no need to|please don't|wouldn't|won't)\s+(\w+\s+){0,2}$/

const REQUESTS: readonly RegExp[] = [
  /\bunsubscrib(e|ed|ing)\b/,
  /\bopt(ed|ing)?[ -]?(me )?out\b/,
  /\bremove (me|us|my (email|e-mail|address|name|details|info))\b/,
  /\bremove\b[^.!?\n]{0,30}\bfrom (your|the|this|all) (list|lists|mailing list|emails?|database|system|sequence)\b/,
  /\btake (me|us|my (email|e-mail|address|name)) off\b/,
  /\btake\b[^.!?\n]{0,30}\boff (your|the|this|all) (list|lists|mailing list|emails?)\b/,
  // Aimed at us: "stop emailing me", "stop sending these", "stop contacting." —
  // not "we had to stop sending newsletters ourselves".
  /\b(stop|quit) (emailing|e-mailing|mailing|contacting|messaging|writing|sending|reaching out)(?=\s*([.!,;]|$)|\s+(me|us|my|our|this|these|those|them|to (me|us)|emails?|e-mails?|messages?|mail)\b)/,
  /\bplease stop\b/,
  /^stop\b(?! (by|in|over|at|the|thinking|worrying))/,
  /\b(do not|don't|dont|never) (email|e-mail|contact|message|write to|reach out to) (me|us)\b/,
  /\bno (more|further) (emails?|e-mails?|messages|mail|contact)\b/,
  /\b(don't|do not) want (to (hear|receive)|any more|these)\b[^.!?\n]{0,20}\b(emails?|messages|from you)\b/,
]

const COMPLAINTS: readonly RegExp[] = [
  /\b(this|that|it|you|your emails?|these emails?|this email)\s*(is|are|'s|'re)\s+(just\s+)?spam\b/,
  /\b(stop|quit|don't|do not) spam(ming)?\b/,
  /\bspamming (me|us|my|our)\b/,
  /\b(i|we)('ve| have| just| will| am| are)?\s*(report(ed|ing)?|mark(ed|ing)?|flag(ged|ging)?)\b[^.!?\n]{0,30}\b(as|for) spam\b/,
]

/** Words after "not interested" that put it off rather than rule it out. */
const DEFERRAL =
  /^[\s,]*(yet|right now|for now|now|at the moment|at this (time|moment|point|stage)|today|this (week|month|quarter|year)|until|in the (near )?future|but\b|however\b|though\b)/

function notInterested(text: string): string | null {
  const pattern = /\bnot (really |at all )?interested\b/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const before = text.slice(0, match.index)
    const after = text.slice(match.index + match[0].length)
    const sentenceEnd = after.search(/[.!?\n]/)
    const rest = sentenceEnd >= 0 ? after.slice(0, sentenceEnd + 1) : after
    if (rest.trimEnd().endsWith('?')) continue
    if (DEFERRAL.test(after)) continue
    if (/\b(if|unless|in case|are you|were you|you're|you are)\s+(\w+\s+){0,2}$/.test(before)) continue
    return match[0]
  }
  return null
}

/**
 * Whether a SUBJECT says nothing but stop — "Unsubscribe", "Remove me",
 * "STOP" — as a message sent from an unsubscribe link, or typed fresh, does.
 * Only a bare answer counts: a subject is a sender's headline, and "Stop
 * losing leads" is one.
 */
export function detectOutreachOptOutSubject(subject: unknown): OutreachOptOutIntent {
  const said = bareNo(String(subject ?? ''))
  return said ? { optOut: true, complaint: false, matched: said } : NONE
}

/**
 * Whether a reply's text asks to be left alone — see the module note. Pass
 * the reply's text as received; the quoted history is removed here.
 */
export function detectOutreachOptOutIntent(text: unknown): OutreachOptOutIntent {
  const fresh = outreachFreshReplyText(text)
  if (!fresh) return NONE
  const folded = fold(fresh)
  for (const pattern of COMPLAINTS) {
    const match = pattern.exec(folded)
    if (match) return { optOut: true, complaint: true, matched: match[0] }
  }
  const bare = bareNo(answerOnly(fresh))
  if (bare) return { optOut: true, complaint: false, matched: bare }
  for (const pattern of REQUESTS) {
    const match = pattern.exec(folded)
    if (match && !NEGATED.test(folded.slice(0, match.index))) {
      return { optOut: true, complaint: false, matched: match[0] }
    }
  }
  const declined = notInterested(folded)
  if (declined) return { optOut: true, complaint: false, matched: declined }
  return NONE
}
