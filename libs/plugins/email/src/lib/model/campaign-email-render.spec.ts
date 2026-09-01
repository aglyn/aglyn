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
 * ONE MESSAGE, ONE SOURCE — and the defect that came of having two.
 *
 * The renderer used to take a `body` and a `template` side by side and read
 * the body only inside `if (!template)`. Both gates in front of it accepted
 * EITHER input, so a merchant who picked a design and also wrote a message
 * passed every check and mailed the design: the typed body was resolved for
 * merge tags, then dropped, and nothing anywhere said so.
 *
 * It is now a union, which is why the tests below can be about behavior rather
 * than about a warning. The designed branch has no `body` in scope to drop and
 * no caller can supply one — the last test in this file is what holds that
 * line, and it fails at COMPILE time if the shape ever loosens back.
 *
 * ## The typed body is refused; a PLAIN-TEXT PART is offered instead
 *
 * The two are not the same offer, and the difference is the whole point. A
 * `body` is the message of a plain-text email — unreviewed as a text
 * alternative, because nobody was ever shown it as one — so promoting it would
 * start mailing text a merchant never checked out of records that already
 * exist. What they actually want is named for its job: `plainText`, the text
 * half of a designed message, generated from the design by default and
 * editable, shown in the preview beside the HTML.
 *
 * Generated is a real default rather than a stub. `renderEmailHtml` synthesizes
 * the text from the same nodes, and a button or a product block keeps its URL
 * in it. What it loses is an inline link inside a rich-text block — the
 * synthesis strips tags, and the href goes with them — which is the concrete
 * reason an override exists at all.
 */

import { UNSUBSCRIBE_FOOTER_LABEL } from '@aglyn/shared-util-email'
import {
  campaignMessageMode,
  campaignPlainTextState,
  renderCampaignEmail,
  type CampaignEmailContent,
} from './campaign-email-render'

/** Rooted at `_@_`, the id the besigner really writes. */
const NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1'] },
  t1: { componentId: 'emailText', props: { children: 'Designed copy here' } },
} as Record<string, unknown>

/** The same nodes, with the author's OWN opt-out link in a button. */
const LINKED_NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1', 'b1'] },
  t1: { componentId: 'emailText', props: { children: 'Designed copy here' } },
  b1: {
    componentId: 'emailButton',
    props: { children: 'Leave this list', href: '{{unsubscribeUrl}}' },
  },
} as Record<string, unknown>

/** Signed, so the `&` between its parameters is there to be escaped. */
const SIGNED_URL =
  'https://acme.example/api/email/preferences?hostId=h&email=d%40e.co&sig=abc'

const RECIPIENT = { email: 'dana@example.com', name: 'Dana Reed' }

const TYPED = 'Typed copy here'

describe('which of the two ways an email is written', () => {
  it('reads the mode off the one field that decides it', () => {
    expect(campaignMessageMode({ templateScreenId: 'scr_1' })).toBe('design')
    expect(campaignMessageMode({ templateScreenId: '' })).toBe('text')
    expect(campaignMessageMode({})).toBe('text')
  })

  it('has exactly TWO answers, because the data model has two things', () => {
    /*
     * A saved template IS a besigner email screen — the same `kind: 'email'`
     * document the design picker lists — so "designed" and "from a template"
     * are one mode under two names. A third would be a distinction nothing
     * stores.
     */
    const modes = new Set(
      [{ templateScreenId: 'scr_1' }, { templateScreenId: '' }, {}].map(
        campaignMessageMode,
      ),
    )
    expect([...modes].sort()).toEqual(['design', 'text'])
  })
})

describe('a plain-text message', () => {
  const rendered = () =>
    renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'text', body: TYPED },
      recipient: RECIPIENT,
      unsubscribeUrl: 'https://acme.example/opt-out',
    })

  it('mails the typed body as the plain-text part', () => {
    expect(rendered().text).toContain(TYPED)
  })

  it('still carries an HTML part, synthesized from that body', () => {
    /*
     * Not cosmetic. A message with no HTML part has no anchors, so its links
     * are inert and click tracking has nothing to rewrite — every send reports
     * a structurally zero click rate. The text mode is exactly the case that
     * would have one, so the synthesis is the thing to assert.
     */
    const { html } = rendered()
    expect(html).toContain(TYPED)
    expect(html.toLowerCase()).toContain('<html')
  })

  it('resolves merge tags in the body, per recipient', () => {
    const { text } = renderCampaignEmail({
      subject: 'Hi {{firstName|there}}',
      content: { mode: 'text', body: 'Hello {{firstName|there}}' },
      recipient: RECIPIENT,
    })
    expect(text).toContain('Hello Dana')
  })

  it('ends on the opt-out line, which is where a text reader finds it', () => {
    expect(rendered().text.trimEnd()).toMatch(
      /https:\/\/acme\.example\/opt-out$/,
    )
  })
})

describe('a designed message', () => {
  const rendered = () =>
    renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES } },
      recipient: RECIPIENT,
      unsubscribeUrl: 'https://acme.example/opt-out',
    })

  it('draws BOTH parts from the design', () => {
    const { html, text } = rendered()
    expect(html).toContain('Designed copy here')
    expect(text).toContain('Designed copy here')
  })

  it('takes the template’s own subject when the campaign names none', () => {
    const { subject } = renderCampaignEmail({
      subject: '',
      content: {
        mode: 'design',
        template: { nodes: NODES, subject: 'From the template' },
      },
      recipient: RECIPIENT,
    })
    expect(subject).toBe('From the template')
  })
})

describe('the plain-text half of a designed message', () => {
  const NODES_WITH_A_LINK = {
    '_@_': { componentId: 'emailSection', nodes: ['t1', 'b1'] },
    t1: { componentId: 'emailText', props: { children: 'Designed copy here' } },
    b1: {
      componentId: 'emailButton',
      props: { children: 'Shop now', href: 'https://acme.example/sale' },
    },
  } as Record<string, unknown>

  it('is generated from the design, links and all', () => {
    /*
     * Generated is a real message rather than a stub, which is why it is the
     * default. A button keeps its destination in the text part — the one half
     * a text-only reader can act on.
     */
    const { text } = renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES_WITH_A_LINK } },
      recipient: RECIPIENT,
    })
    expect(text).toContain('Designed copy here')
    expect(text).toContain('https://acme.example/sale')
  })

  it('is replaced, whole, by one the author wrote', () => {
    const { html, text } = renderCampaignEmail({
      subject: 'Spring sale',
      content: {
        mode: 'design',
        template: { nodes: NODES_WITH_A_LINK },
        plainText: 'Sale ends Sunday: https://acme.example/sale',
      },
      recipient: RECIPIENT,
    })
    expect(text).toContain('Sale ends Sunday')
    expect(text).not.toContain('Designed copy here')
    // And it changes NOTHING about the styled half.
    expect(html).toContain('Designed copy here')
  })

  it('resolves merge tags in an authored part', () => {
    // A text part shipping `{{firstName|there}}` literally is worse than the
    // generated one it replaced.
    const { text } = renderCampaignEmail({
      subject: 'Spring sale',
      content: {
        mode: 'design',
        template: { nodes: NODES },
        plainText: 'Hello {{firstName|there}}, the sale ends Sunday.',
      },
      recipient: RECIPIENT,
    })
    expect(text).toContain('Hello Dana')
    expect(text).not.toContain('{{firstName')
  })

  it('cannot write away the unsubscribe link, which stays a bare URL', () => {
    /*
     * The compliance-critical half. Anchor markup is invisible in a text part,
     * so the only form a text-only reader can use is the address itself — and
     * it is appended after the author's copy rather than being part of it.
     */
    const { text } = renderCampaignEmail({
      subject: 'Spring sale',
      content: {
        mode: 'design',
        template: { nodes: NODES },
        plainText: 'No footer here.',
      },
      recipient: RECIPIENT,
      unsubscribeUrl: 'https://acme.example/opt-out',
    })
    expect(text).toContain('https://acme.example/opt-out')
    expect(text).not.toContain('<a ')
  })

  it('gives the HTML part the same visible opt-out the text part gets', () => {
    /*
     * THE HALF ALMOST EVERY RECIPIENT ACTUALLY READS.
     *
     * A designed template carries an opt-out only if its author placed a
     * `{{unsubscribeUrl}}` somewhere, and nothing makes them: a footer block
     * that says only the copyright line shipped an HTML part with no way out
     * of the list at all, while the text part had one — so the defect was
     * invisible to anyone reading their own test send.
     */
    const { html } = renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES } },
      recipient: RECIPIENT,
      unsubscribeUrl: 'https://acme.example/opt-out',
    })
    expect(html).toContain('https://acme.example/opt-out')
    expect(html).toContain('</a>')
  })

  it('leaves an author’s OWN placement alone rather than adding a second', () => {
    // `{{unsubscribeUrl}}` in a link lands in an `href`, where the renderer
    // escapes it — so the check that spots it has to look for the escaped
    // form too, or the templates that did the right thing get two footers.
    const { html } = renderCampaignEmail({
      subject: 'Spring sale',
      content: {
        mode: 'design',
        template: { nodes: LINKED_NODES },
      },
      recipient: RECIPIENT,
      unsubscribeUrl: SIGNED_URL,
    })
    expect(html.split('Leave this list').length - 1).toBe(1)
    expect(html).not.toContain(UNSUBSCRIBE_FOOTER_LABEL)
  })

  it('reports the message text WITHOUT the footer, for the composer', () => {
    /*
     * What an override is filled from. Prefilling from `text` would fold this
     * render's footer into the stored value, and the next send would append a
     * second one.
     */
    const { text, messageText } = renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES } },
      recipient: RECIPIENT,
      unsubscribeUrl: 'https://acme.example/opt-out',
    })
    expect(messageText).toContain('Designed copy here')
    expect(messageText).not.toContain('opt-out')
    expect(text).toContain('opt-out')
  })

  it('treats an empty authored part as no override at all', () => {
    // Presence is the signal, and whitespace is not presence.
    const { text } = renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES }, plainText: '  ' },
      recipient: RECIPIENT,
    })
    expect(text).toContain('Designed copy here')
  })
})

describe('whether the text part still describes the design', () => {
  /*
   * The staleness question, which exists because an authored part is never
   * overwritten when the design is edited. Nothing rewrites somebody's
   * writing — which leaves a part that has fallen behind, and a value nobody
   * can see scores the same as one that is not there.
   */
  it('calls an absent part generated, and never stale', () => {
    expect(campaignPlainTextState({}, 'ver_2')).toEqual({
      source: 'generated',
      stale: false,
    })
    expect(campaignPlainTextState({ plainText: '   ' }, 'ver_2')).toEqual({
      source: 'generated',
      stale: false,
    })
  })

  it('calls a part written against THIS design current', () => {
    expect(
      campaignPlainTextState(
        { plainText: 'Mine', plainTextVersionId: 'ver_2' },
        'ver_2',
      ),
    ).toEqual({ source: 'authored', stale: false })
  })

  it('calls a part written against an older design stale', () => {
    expect(
      campaignPlainTextState(
        { plainText: 'Mine', plainTextVersionId: 'ver_1' },
        'ver_2',
      ),
    ).toEqual({ source: 'authored', stale: true })
  })

  it('does not cry stale over a question it cannot answer', () => {
    // An unanswerable question must not render as a warning — a part written
    // before the version was recorded, or a design whose version is unknown.
    expect(campaignPlainTextState({ plainText: 'Mine' }, 'ver_2').stale).toBe(
      false,
    )
    expect(
      campaignPlainTextState(
        { plainText: 'Mine', plainTextVersionId: 'ver_1' },
        undefined,
      ).stale,
    ).toBe(false)
  })
})

describe('the mode is READ, not assumed', () => {
  /*==========================================
   * THE CONTROL.
   *
   * Every test above passes just as well against a renderer that ignored the
   * mode and always took one path — the text tests would pass a text-only
   * renderer, the design tests a design-only one. This is the pair that does
   * not: the same subject, the same recipient, the same everything except the
   * mode, asserted to produce two DIFFERENT messages with neither one's copy
   * appearing in the other.
   *
   * A renderer that always designed, or always took the body, fails here.
   *=========================================*/
  const same = {
    subject: 'Spring sale',
    recipient: RECIPIENT,
    unsubscribeUrl: 'https://acme.example/opt-out',
  }

  it('produces a different message for each mode', () => {
    const asText = renderCampaignEmail({
      ...same,
      content: { mode: 'text', body: TYPED },
    })
    const asDesign = renderCampaignEmail({
      ...same,
      content: { mode: 'design', template: { nodes: NODES } },
    })

    expect(asText.html).not.toBe(asDesign.html)
    expect(asText.text).not.toBe(asDesign.text)

    // Each carries its own source, and NEITHER carries the other's.
    expect(asText.text).toContain(TYPED)
    expect(asText.text).not.toContain('Designed copy here')
    expect(asDesign.text).toContain('Designed copy here')
    expect(asDesign.text).not.toContain(TYPED)
  })

  it('cannot be handed a design and a typed body at the same time', () => {
    /*==========================================
     * THE REGRESSION GUARD, and it is a COMPILE-time one.
     *
     * The discard was possible because the input took both fields. It no
     * longer has a top-level `body` at all, so this call does not compile —
     * and if anyone ever puts one back, `@ts-expect-error` becomes an
     * unused suppression and `npm run typecheck` goes red on this line.
     * A runtime assertion could only observe the drop; this makes the drop
     * unsayable.
     *=========================================*/
    const message = renderCampaignEmail({
      subject: 'Spring sale',
      content: { mode: 'design', template: { nodes: NODES } },
      // @ts-expect-error a designed message has no typed body to carry
      body: TYPED,
      recipient: RECIPIENT,
    })
    // And what it does render is the design, whole.
    expect(message.text).toContain('Designed copy here')
  })

  it('names the design branch without a body field of its own', () => {
    // The same guard one level down, on the union member rather than on the
    // render input — so widening either shape is caught.
    const designed: Extract<CampaignEmailContent, { mode: 'design' }> = {
      mode: 'design',
      template: { nodes: NODES },
      // @ts-expect-error the designed member carries a template and nothing else
      body: TYPED,
    }
    expect(designed.mode).toBe('design')
  })
})
