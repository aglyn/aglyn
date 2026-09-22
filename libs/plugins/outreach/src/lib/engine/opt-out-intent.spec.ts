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
 *
 * @jest-environment node
 */

import {
  detectOutreachOptOutIntent,
  detectOutreachOptOutSubject,
  outreachFreshReplyText,
} from './opt-out-intent'

/** How a Gmail reply quotes the step it answers, footer and all. */
const QUOTED_STEP = [
  '',
  'On Mon, Sep 14, 2026 at 10:02 AM Avery Quinn <avery@example.org> wrote:',
  '> Hi Casey,',
  '>',
  '> Saw the portfolio launch last week. Worth 20 minutes?',
  '>',
  '> Example Co LLC · PO Box 12345, Anytown, TX 75001',
  '> This is a sales email from Example Co. Not interested? Reply "no" and I won\'t email again.',
].join('\n')

const reply = (words: string) => `${words}\n${QUOTED_STEP}`
const optsOut = (words: string) => detectOutreachOptOutIntent(reply(words)).optOut

describe('the words a reply adds', () => {
  it('cuts the quoted history, where our own footer says "no"', () => {
    expect(outreachFreshReplyText(reply('Sounds good, Tuesday works.'))).toBe('Sounds good, Tuesday works.')
    expect(detectOutreachOptOutIntent(QUOTED_STEP)).toEqual({ optOut: false, complaint: false, matched: null })
  })

  it('cuts a footer a client re-quoted without marks, and a signature', () => {
    const outlookStyle = [
      'Happy to talk next week.',
      '',
      '-- ',
      'Casey Morgan | Example Agency',
      'Reply STOP to opt out of our newsletter',
    ].join('\r\n')
    expect(outreachFreshReplyText(outlookStyle)).toBe('Happy to talk next week.')
    // The footer as it read before AGL-3228 — a prospect replying to an
    // older email quotes the sentence they were sent.
    const unmarked = 'Thanks!\nThis is a business solicitation from Example Co. Not relevant? Reply “no” and I won’t email again.'
    expect(outreachFreshReplyText(unmarked)).toBe('Thanks!')
    expect(detectOutreachOptOutIntent(unmarked).optOut).toBe(false)
    // The footer as it reads since AGL-3228, and as a client may re-quote it
    // with the "sales email" sentence alone.
    const current = 'Sounds good.\nThis is a sales email from Example Co. Not interested? Reply "no" and I won\'t email again.'
    expect(outreachFreshReplyText(current)).toBe('Sounds good.')
    expect(detectOutreachOptOutIntent(current).optOut).toBe(false)
    expect(outreachFreshReplyText('Sure\n> This is a sales email from Example Co.')).toBe('Sure')
  })

  it('reads nothing into an empty reply', () => {
    expect(detectOutreachOptOutIntent('')).toEqual({ optOut: false, complaint: false, matched: null })
    expect(detectOutreachOptOutIntent(null)).toEqual({ optOut: false, complaint: false, matched: null })
  })
})

describe('a bare no', () => {
  it.each([
    'no',
    'No.',
    'NO',
    'Nope',
    'nah',
    'No thanks',
    'No, thank you!',
    'no thx :)',
    'Thanks but no thanks.',
    'Pass.',
    "I'll pass",
    'Sorry, not interested.',
    'Not for us, thanks.',
    'Stop',
    'Please stop.',
    'unsubscribe',
    'Remove me',
    'Please remove me.',
  ])('reads "%s" as an opt-out', (words) => {
    expect(optsOut(words)).toBe(true)
  })

  it('allows a greeting, a sign-off and a name signed after thanks', () => {
    expect(optsOut('Hi Avery,\n\nNo thanks.\n\nBest,\nCasey')).toBe(true)
    expect(optsOut('Hi Avery, no thanks.')).toBe(true)
    expect(optsOut('No thanks, Casey')).toBe(true)
    expect(optsOut('No thanks\nCasey')).toBe(true)
    expect(optsOut('Nope.\n\nSent from my iPhone')).toBe(true)
  })

  it.each([
    'No rush on this.',
    'No problem, Thursday works.',
    'No worries — send me the deck.',
    'No, WordPress.',
    'No.\nWe run WordPress, how does this compare?',
    'Not yet, but maybe in Q1.',
    'no idea, ask my colleague',
    'Pass this along to our web team?',
  ])('does not read "%s" as one', (words) => {
    expect(optsOut(words)).toBe(false)
  })
})

describe('a request anywhere in the reply', () => {
  it.each([
    'Thanks for reaching out, but please unsubscribe me from these emails.',
    'How do I unsubscribe?',
    'Please remove my email from your list.',
    'Kindly remove this address from your mailing list.',
    'Can you take me off your list?',
    'Take my email off the list please',
    'Stop emailing me.',
    'Please stop contacting our team.',
    "Don't email me again.",
    'Do not contact us.',
    'Opt me out.',
    'I would like to opt-out.',
    'No more emails please.',
    "I don't want to receive any more of these emails.",
    'STOP. This is the third one.',
  ])('reads "%s" as an opt-out', (words) => {
    expect(optsOut(words)).toBe(true)
  })

  it.each([
    "Please don't remove me — I'm interested, just busy.",
    'Do not unsubscribe me, I want the follow-up.',
    'Stop by our booth at the expo and we can chat.',
    "I can't stop thinking about your pricing page.",
    'We had to stop sending newsletters ourselves last year.',
  ])('does not read a negated or unrelated "%s" as one', (words) => {
    expect(optsOut(words)).toBe(false)
  })
})

describe('not interested', () => {
  it.each([
    'Not interested.',
    'We are not interested.',
    "We're not interested in switching platforms.",
    'Not really interested, thanks.',
    'Honestly not at all interested.',
  ])('reads "%s" as an opt-out', (words) => {
    expect(optsOut(words)).toBe(true)
  })

  it.each([
    'not interested YET?',
    'Not interested yet — check back after our migration.',
    'Not interested right now, try me next quarter.',
    'not interested for now',
    'Not interested at the moment, but keep me posted.',
    'Not interested at this time.',
    "I'm not interested but my colleague might be: morgan@example.com",
    'Are you not interested in agencies our size?',
    "If you're not interested in the details, skip ahead.",
    'Not currently interested.',
  ])('does not read a deferred or asked "%s" as one', (words) => {
    expect(optsOut(words)).toBe(false)
  })
})

describe('a reply that calls the email spam', () => {
  it.each([
    'This is spam.',
    "That's spam, stop.",
    'Stop spamming me.',
    'Quit spamming our inbox.',
    "I've reported this as spam.",
    'I reported you for spam.',
    'Your emails are spam.',
  ])('reads "%s" as an opt-out and a complaint', (words) => {
    expect(detectOutreachOptOutIntent(reply(words))).toMatchObject({ optOut: true, complaint: true })
  })

  it.each([
    'Your first email went to my spam folder, sorry for the slow reply!',
    'Is this spam? Seems legit, tell me more.',
    'Our spam filter is aggressive — resend to casey@example.com?',
  ])('does not read "%s" as a complaint', (words) => {
    expect(detectOutreachOptOutIntent(reply(words))).toMatchObject({ optOut: false, complaint: false })
  })
})

describe('a subject that says stop', () => {
  it('counts only a bare answer, never a headline', () => {
    for (const subject of ['Unsubscribe', 'Remove me', 'STOP', 'No thanks', 'Not interested']) {
      expect(detectOutreachOptOutSubject(subject).optOut).toBe(true)
    }
    for (const subject of ['Stop losing leads', 'No more per-site pricing', 'Remove the busywork', 'Unsubscribe rates, explained']) {
      expect(detectOutreachOptOutSubject(subject).optOut).toBe(false)
    }
  })
})

describe('what matched', () => {
  it('names the words that decided it', () => {
    expect(detectOutreachOptOutIntent(reply('Please take me off your list.')).matched).toBe('take me off')
    expect(detectOutreachOptOutIntent(reply('No thanks.')).matched).toBe('no thanks')
    expect(detectOutreachOptOutIntent(reply('Not interested.')).matched).toBe('not interested')
  })
})
