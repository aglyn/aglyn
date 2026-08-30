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

export interface CampaignEmailRenderInput {
  /** The campaign's subject, after any A/B variant override. */
  subject: string
  /** The campaign's plain-text body, after any A/B variant override. */
  body: string
  /** The composer's preview line; overrides the template's own. */
  preheader?: string
  /** Set for a designed campaign; the body becomes the text fallback. */
  template?: CampaignEmailTemplate | null
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
  const { template, recipient, siteBase = '', hostId, unsubscribeUrl } = input
  const subject = resolveMergeTags(
    input.subject || template?.subject || '',
    recipient,
  )
  const body = resolveMergeTags(input.body ?? '', recipient)
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

  if (!template) {
    const text = `${body}${unsubscribeLine}`
    return { subject, html: renderTextEmailHtml(text, subject, preheader), text }
  }

  const rendered = renderEmailHtml({
    nodes: template.nodes as never,
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
      Object.entries(template.products ?? {}).map(([id, product]) => [
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
  return {
    subject,
    html: rendered.html,
    text: `${rendered.text}${unsubscribeLine}`,
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
