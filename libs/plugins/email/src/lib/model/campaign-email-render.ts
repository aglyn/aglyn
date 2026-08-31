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
 * ONE CAMPAIGN MESSAGE, RENDERED — the step between a composed campaign and
 * the two parts that reach an inbox.
 *
 * It exists as a shared function because a preview that renders the message a
 * second way is a preview of something else. The class of defect it is meant
 * to catch has bitten twice on this send path — a designed campaign mailed
 * with its product blocks missing, and merge tags that resolved to empty
 * strings for an entire member audience — and neither would have been visible
 * in a preview that did not go through the same renderer, the same merge-tag
 * resolution and the same plain-text synthesis as the send.
 *
 * PURE, and free of `firebase-admin`, so the same call answers in three
 * places: the per-recipient loop in `campaign-send.ts`, the composer's
 * `renderPreview` action, and the console's own client components. Its inputs
 * are already-loaded data — a node map, resolved products, a recipient — and
 * the loading stays with the caller that has the credentials for it.
 */

import {
  EMAIL_NODE_ROOT_ID,
  renderEmailHtml,
  renderTextEmailHtml,
  resolveMergeTags,
  type EmailRenderProduct,
  type MergeTagRecipient,
} from '@aglyn/shared-util-email'
/*
 * The LEAF app-util, not `@aglyn/aglyn/server`: this module is pure and is
 * imported by client components, so a server entry point here would pull the
 * Admin SDK into a browser bundle. `sanitizeCustomHtml`, which the besigner
 * previews these same nodes under, is a one-line delegation to this function
 * — so the mailed copy and the previewed copy are the same policy over the
 * same string rather than two policies kept in step by hand.
 */
import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'

/**
 * A designed email, loaded. `nodes` is the DECODED besigner map: the stored
 * form is compressed msgpack from the first designer save onward, and a
 * caller that passes the raw value renders an empty shell.
 */
export interface CampaignEmailTemplate {
  nodes: Record<string, unknown>
  products?: Record<string, EmailRenderProduct | undefined>
  /** The template's own preview line, used when the campaign names none. */
  preheader?: string
  /** The template's own subject, used when the campaign names none. */
  subject?: string
}

/**
 * WHERE THE MESSAGE COMES FROM — one source, named.
 *
 * A union rather than two optional fields, and that is the whole point. The
 * design already supplies BOTH parts an inbox receives: `renderEmailHtml`
 * returns the HTML and a plain-text rendering of the same nodes, links
 * included. So on a designed send a typed BODY — the whole message of a
 * plain-text email — has no part to occupy, and the earlier shape, which
 * accepted both and read the body only when no template was given, computed it
 * and threw it away without saying so.
 *
 * What an author actually wants there is named for its job instead:
 * `plainText`, the text HALF of a designed message, generated from the design
 * by default. That is a different offer from reinterpreting a body, and
 * deliberately — see the field.
 *
 * Two members and not three: a saved TEMPLATE is a besigner email screen, the
 * same document the design picker offers, so "designed" and "from a template"
 * name one thing.
 *
 * With the two collapsed into a union the discard is not merely refused, it is
 * unsayable: the designed branch has no `body` in scope to drop, and a caller
 * holding both has to decide which it means before it can call at all.
 */
export type CampaignEmailContent =
  | {
      /** Written in the composer; the HTML part is synthesized from it. */
      mode: 'text'
      /** The plain-text body, after any A/B variant override. */
      body: string
    }
  | {
      /** Built in the besigner; the HTML part comes from the nodes. */
      mode: 'design'
      template: CampaignEmailTemplate
      /**
       * The author's OWN plain-text part, replacing the one the design
       * generates. Absent — not empty — means generated.
       *
       * Presence is the whole signal, which is why this is a separate
       * optional field rather than a flag beside a string: a flag and a value
       * are two things that can disagree, and the disagreement is invisible.
       *
       * Worth having because the generated text is good but not perfect. A
       * button and a product keep their URLs in it; an inline link inside an
       * `emailRichtext` block does not — the synthesis strips tags, so the
       * href goes with them. An author who cares about what a text-only
       * reader can actually follow needs a way to say so.
       */
      plainText?: string
    }

/** Which of the two ways one email is written. */
export type CampaignMessageMode = CampaignEmailContent['mode']

/**
 * Which mode a stored email is in, from the one field that decides it.
 *
 * Naming a template IS being designed — there is no separate flag, and adding
 * one would be a second answer to drift from this one. Read by the composer,
 * by the surfaces that describe a message and by the send path, so a record
 * cannot be shown as one thing and mailed as another.
 */
export function campaignMessageMode(record: {
  templateScreenId?: string | null
}): CampaignMessageMode {
  return record.templateScreenId ? 'design' : 'text'
}

export interface CampaignEmailRenderInput {
  /** The campaign's subject, after any A/B variant override. */
  subject: string
  /** The one source this message is written from. */
  content: CampaignEmailContent
  /** The composer's preview line; overrides the template's own. */
  preheader?: string
  /** Who this copy is being personalized for. */
  recipient: MergeTagRecipient
  /** The site's own public origin, absolutizing media and product links. */
  siteBase?: string
  /** Qualifies an org-scoped media asset for the unauthenticated CDN. */
  hostId?: string
  /** The recipient's signed opt-out link, appended to the text part. */
  unsubscribeUrl?: string
}

export interface RenderedCampaignEmail {
  /** The subject with this recipient's merge values resolved. */
  subject: string
  /** The HTML part, which every campaign message carries. */
  html: string
  /** The plain-text part, ending in the opt-out line. */
  text: string
  /**
   * The message's own plain text, WITHOUT the opt-out line.
   *
   * What the composer fills an authored plain-text part from. Prefilling from
   * `text` would fold this send's footer into the stored override, and the
   * next send would append a second one — so the two are reported apart
   * rather than the caller trying to trim one off the other.
   */
  messageText: string
}

/**
 * WHERE A DESIGNED EMAIL'S PLAIN-TEXT PART COMES FROM, and whether it still
 * describes the design.
 *
 * Two facts a composer has to state rather than imply. An authored text part
 * is not overwritten when the design is edited — losing somebody's writing
 * because they touched the canvas afterwards is not a trade worth making —
 * which leaves the other half of the problem: an override written against a
 * design that has since changed says something the HTML no longer says, and
 * nothing about it is visible. A value that cannot be read scores the same as
 * one that is absent, which is the shape of the defect this whole area is
 * being fixed for.
 *
 * So the design's VERSION is recorded beside the override, and the two are
 * compared here. Pure, and read by the composer, so the notice a merchant sees
 * and the state the record is in cannot disagree.
 */
export interface CampaignPlainTextState {
  /** `authored` when somebody wrote it; `generated` from the design. */
  source: 'generated' | 'authored'
  /**
   * An authored part written against a design that has moved since.
   *
   * False for a generated part, which cannot go stale — it is derived from
   * whatever the design says at send time — and false when either version is
   * unknown, because an unanswerable question must not render as a warning.
   */
  stale: boolean
}

export function campaignPlainTextState(
  record: {
    plainText?: string | null
    /** The design version the override was written against. */
    plainTextVersionId?: string | null
  },
  /** The design's version as it stands now. */
  currentVersionId?: string | null,
): CampaignPlainTextState {
  if (!record.plainText?.trim()) return { source: 'generated', stale: false }
  const written = record.plainTextVersionId ?? ''
  return {
    source: 'authored',
    stale: Boolean(written && currentVersionId && written !== currentVersionId),
  }
}

/**
 * Renders one campaign message for one recipient.
 *
 * The HTML part is produced here rather than left to `sendEmail`'s fallback
 * so that a caller can SEE it. `sendEmail` synthesizes an HTML part from the
 * text of any message that arrives without one — a text-only message has no
 * anchors, so its links are inert and click tracking has nothing to rewrite —
 * and this calls the same `renderTextEmailHtml` with the same text and
 * subject, so a plain-text campaign is byte-identical either way.
 */
export function renderCampaignEmail(
  input: CampaignEmailRenderInput,
): RenderedCampaignEmail {
  const { content, recipient, siteBase = '', hostId, unsubscribeUrl } = input
  const template = content.mode === 'design' ? content.template : null
  const subject = resolveMergeTags(
    input.subject || template?.subject || '',
    recipient,
  )
  const preheader = input.preheader?.trim() || template?.preheader || ''
  const name = (recipient.name ?? '').trim()
  /*
   * The plain-text footer, named for what the link actually opens.
   *
   * "Choose which emails you get" in front of "or unsubscribe" is the only
   * place a text-only reader learns that leaving one stream is an option at
   * all, and the word "unsubscribe" stays in the line because that is what a
   * recipient scans a footer for.
   */
  const unsubscribeLine = unsubscribeUrl
    ? `\n\n—\nChoose which emails you get, or unsubscribe: ${unsubscribeUrl}`
    : ''

  if (content.mode === 'text') {
    const messageText = resolveMergeTags(content.body, recipient)
    const text = `${messageText}${unsubscribeLine}`
    return {
      subject,
      html: renderTextEmailHtml(text, subject, preheader),
      text,
      messageText,
    }
  }

  const rendered = renderEmailHtml({
    nodes: content.template.nodes as never,
    // Besigner maps are rooted at `_@_`, not the renderer's default `root`:
    // rendering one as `root` finds no root and emits an empty 600px shell.
    rootId: EMAIL_NODE_ROOT_ID,
    subject,
    preheader,
    sanitize: sanitizeAuthorHtml,
    // An author-picked image is stored as a `media:` reference and resolves
    // site-relative; an inbox has no page to resolve it against, so without an
    // origin the renderer drops it.
    mediaOrigin: siteBase || undefined,
    mediaHostId: hostId,
    merge: {
      'contact.email': recipient.email,
      'contact.name': name,
      'contact.firstName': name.split(/\s+/)[0] ?? '',
      'site.url': siteBase,
      unsubscribeUrl: unsubscribeUrl ?? '',
    },
    products: Object.fromEntries(
      Object.entries(content.template.products ?? {}).map(([id, product]) => [
        id,
        product && {
          ...product,
          url: product.url?.startsWith('/')
            ? `${siteBase}${product.url}`
            : product.url,
        },
      ]),
    ),
  })
  /*
   * THE PLAIN-TEXT PART: the design's own, unless somebody wrote one.
   *
   * Merge tags are resolved in an authored part exactly as they are in a
   * plain-text campaign's body — a text part that ships `{{firstName|there}}`
   * literally is worse than the generated one it replaced. The design's own
   * text arrives already substituted, through `renderEmailHtml`'s `merge` map.
   *
   * The opt-out line is appended either way, and it is a BARE URL rather than
   * an anchor: markup is invisible in a text part, so a link a text-only
   * reader can copy is the only form that works. It is the one part of the
   * footer an author cannot write away.
   */
  const authored = content.plainText?.trim()
  const messageText = authored
    ? resolveMergeTags(authored, recipient)
    : rendered.text
  return {
    subject,
    html: rendered.html,
    text: `${messageText}${unsubscribeLine}`,
    messageText,
  }
}

/**
 * The merge tags the send path resolves, for the composer to offer.
 *
 * Kept beside the renderer because `resolveMergeTags` recognizes exactly
 * these three and substitutes the fallback for anything else: a tag a
 * merchant types from memory that is not on this list does not fail, it
 * silently renders as nothing in mail that has already gone out. A composer
 * that lists them is the difference between a documented feature and a
 * guess.
 */
export const CAMPAIGN_MERGE_TAGS: ReadonlyArray<{
  /** The full token, fallback included, as it should be typed. */
  token: string
  /** What it resolves to, per recipient. */
  description: string
}> = [
  {
    token: '{{firstName|there}}',
    description: 'The recipient’s first name, or “there” when none is stored',
  },
  {
    token: '{{name}}',
    description: 'The recipient’s full name, where the audience stores one',
  },
  { token: '{{email}}', description: 'The address this copy is going to' },
]
