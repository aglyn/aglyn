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
 * Email render pipeline (AGL-348): converts a designed email screen's
 * node map into email-client-compatible HTML (600px table layout,
 * inlined styles, bulletproof buttons) plus a plain-text alternative.
 * Pure — no I/O; callers resolve products/merge data first.
 *
 * Merge tokens ({{contact.firstName}}, {{unsubscribeUrl}}, …) substitute
 * from the provided map; unknown tokens are left in place so a missing
 * field is visible in test sends instead of silently blank.
 *
 * ## The safety contract, in one place
 *
 * Everything this emits is author-controlled, and it is emitted into mail
 * that has left the building. Three rules, all applied here rather than
 * left to a caller:
 *
 * 1. Block HTML goes through {@link EmailRenderOptions.sanitize}, which is
 *    REQUIRED. There is no identity default to fall back into.
 * 2. Every URL is scheme-checked against `@aglyn/shared-util-http` before it
 *    is escaped into an attribute — escaping stops an attribute breakout and
 *    says nothing at all about `javascript:`.
 * 3. Merge substitution into a URL cannot draw from the `contact.` namespace,
 *    so no template can route a recipient's own address into a query string.
 *
 * Mail clients strip most of this themselves, so none of the three is the
 * last line of defense in an inbox. They are the only line the moment one of
 * these documents renders outside one — a "view this email in your browser"
 * page is the ordinary way that happens.
 */

import {
  hasSafeLinkScheme,
  hasSafeMediaScheme,
} from '@aglyn/shared-util-http/safe-url-scheme'

import { resolveEmailMediaSrc } from './email-media-src'

export interface EmailRenderProduct {
  name: string
  priceLabel?: string
  imageUrl?: string
  url?: string
}

export interface EmailRenderNode {
  componentId?: string
  props?: Record<string, any>
  nodes?: string[]
}

export interface EmailRenderOptions {
  /** Flat node map (screen version `nodes`). */
  nodes: Record<string, EmailRenderNode | undefined>
  /** Root node id (defaults to 'root'). */
  rootId?: string
  subject?: string
  /** Hidden preview line shown next to the subject in inboxes. */
  preheader?: string
  /** Merge values keyed by token body, e.g. 'contact.firstName'. */
  merge?: Record<string, string>
  /** Product data by id for emailProduct blocks. */
  products?: Record<string, EmailRenderProduct | undefined>
  /**
   * The HTML policy applied to every `emailRichtext` / `emailHtml` block.
   *
   * REQUIRED, and required is the point. A policy a caller may omit is a
   * policy that gets omitted, and an omitted one here is not a rendering
   * bug: the console renders these same nodes through `sanitizeCustomHtml`
   * before an author ever sees them, so an unpoliced mail render means two
   * renderers of one document disagreeing about safety, with the unsafe one
   * being the one that sends.
   *
   * This module cannot pick the policy for itself — it is `scope:shared` and
   * the sanitizer is aglyn-scoped, which nx forbids it to import — so the
   * choice belongs to the caller, and the type is what makes the caller make
   * it. Every send path passes `sanitizeAuthorHtml`, which is exactly what
   * `sanitizeCustomHtml` delegates to, so the mailed copy and the previewed
   * copy are the same function of the same string.
   */
  sanitize: (html: string) => string
  /**
   * Absolute origin serving this email's media, e.g. `https://acme.com`
   * (AGL-1224).
   *
   * An image an author picked with "Browse media" is stored as a
   * `media:{scope}/{mediaId}` reference, which resolves to the SITE-RELATIVE
   * CDN path `/api/media/cdn/…`. A browser has a page to resolve that
   * against; an inbox has nothing. Without this, every picked image is a
   * broken-image box in the delivered mail.
   *
   * It is an input rather than a lookup because this module is pure, and
   * because the CDN route is mounted in BOTH the console and the tenant app
   * — which origin is correct depends on whose email this is.
   */
  mediaOrigin?: string
  /**
   * Host doc id of the site sending, so an `org:`-scoped reference is
   * host-qualified. The CDN is unauthenticated and decides from the URL
   * alone, so an org asset restricted to particular sites is only served
   * through the qualified form.
   */
  mediaHostId?: string
  /**
   * Absolute URL of the sender's EMAIL logo, prepended as a centred row at
   * the top of the 600px table (AGL-2139).
   *
   * `emailLogoUrl` was a first-class field of `OrgBrandingProfile`, resolved,
   * collected in the branding editor, https-validated and persisted — and read
   * at ZERO render sites. An agency admin on the tier that costs the most
   * filled it in, the form saved, the value round-tripped, and it appeared in
   * no email ever. This is the consumer that makes it a live capability
   * rather than a stored string.
   *
   * Absent or blank emits NOTHING — not an empty row, not a spacer. An email
   * with a gap where a logo should be reads as broken; one without a logo
   * reads as plain, which is the correct appearance for an org that has not
   * set one.
   */
  brandLogoUrl?: string
}

export interface RenderedEmail {
  html: string
  text: string
}

const FONT = 'Helvetica, Arial, sans-serif'

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Substitutes {{token}} occurrences; unknown tokens stay visible. */
export function substituteMergeTokens(
  value: string,
  merge: Record<string, string> | undefined,
): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, token: string) => {
    const replacement = merge?.[token]
    return replacement !== undefined ? replacement : match
  })
}

const TEXT_STYLES: Record<string, string> = {
  heading: `font-size:28px;font-weight:700;line-height:1.25`,
  subheading: `font-size:20px;font-weight:600;line-height:1.3`,
  body: `font-size:15px;font-weight:400;line-height:1.55`,
  caption: `font-size:12px;font-weight:400;line-height:1.4`,
}

/** One full-width table row wrapping arbitrary cell HTML. */
const row = (cellHtml: string, cellStyle = ''): string =>
  `<tr><td style="${cellStyle}">${cellHtml}</td></tr>`

/**
 * The id the besigner roots every stored node map at — `CANVAS_ROOT_ELEMENT_ID`
 * in `@aglyn/aglyn`. `renderEmailHtml` still defaults `rootId` to `'root'` for
 * ad-hoc callers, but anything rendering a real besigner document MUST pass
 * this: rendering a besigner map as `'root'` finds no root and emits nothing
 * (AGL-765). Kept here so server code need not import the heavy `@aglyn/aglyn`
 * barrel; a drift guard in the console specs asserts the two stay equal.
 */
export const EMAIL_NODE_ROOT_ID = '_@_'

export function renderEmailHtml(options: EmailRenderOptions): RenderedEmail {
  const {
    nodes,
    rootId = 'root',
    subject = '',
    preheader = '',
    merge,
    products,
    sanitize,
    mediaOrigin,
    mediaHostId,
    brandLogoUrl,
  } = options

  const textParts: string[] = []
  const sub = (value: unknown): string =>
    substituteMergeTokens(String(value ?? ''), merge)

  /**
   * The merge map as it applies inside a URL: everything except the
   * `contact.` namespace.
   *
   * That namespace is the recipient — `contact.email`, `contact.name`,
   * `contact.firstName` are what campaign-send puts in the map. Substituting
   * them into an `href` or a `src` is how a template like
   * `https://example.test/?e={{contact.email}}` turns every send into the
   * recipient's own address on somebody's query string, and putting personal
   * data in a URL is a line this codebase does not cross. The refusal has to
   * live here because it is the SUBSTITUTION that creates the value: no
   * scheme check and no sanitizer can see the address, since the template
   * the author wrote and the editor reviewed contains only the token.
   *
   * Nothing else narrows: `{{unsubscribeUrl}}` and `{{site.url}}` ARE URLs
   * and are the reason a token appears in this position at all.
   *
   * A refused token is left standing rather than blanked, which is this
   * module's existing convention for a token it will not fill — a test send
   * shows `?e={{contact.email}}` in the link, which names the problem to the
   * author instead of silently shipping a subtly different URL.
   */
  const urlMerge = merge
    ? Object.fromEntries(
        Object.entries(merge).filter(
          ([token]) => !token.startsWith('contact.'),
        ),
      )
    : undefined

  /** {@link sub} for a value that lands in a URL — see {@link urlMerge}. */
  const subUrl = (value: unknown): string =>
    substituteMergeTokens(String(value ?? ''), urlMerge)

  /**
   * A link target safe to emit, or undefined.
   *
   * Escaping the value into the attribute stops a breakout and says nothing
   * about the scheme, so `escapeEmailHtml` on its own passes a stored
   * `javascript:` or `data:` href through verbatim. The check runs on the
   * SUBSTITUTED string, because a merge value is part of the final URL and a
   * template that reads clean can resolve to one that does not.
   */
  const linkHref = (value: unknown): string | undefined => {
    const href = subUrl(value)
    if (!href) return undefined
    return hasSafeLinkScheme(href) ? href : undefined
  }

  const origin = mediaOrigin?.replace(/\/+$/, '')

  /**
   * A stored image value turned into something an inbox can actually fetch,
   * or undefined (AGL-1224).
   *
   * `resolveEmailMediaSrc` handles the three stored generations — a `media:`
   * reference, the AGL-175 relative CDN path, and a plain absolute URL an
   * author typed — but the first two come back site-relative, which is the
   * whole bug: only a browser has a page to resolve them against.
   *
   * With no origin to absolutize against, the image is DROPPED rather than
   * emitted relative. Both are a missing picture; a dropped one leaves a gap,
   * while `src="/api/media/cdn/…"` renders as a broken-image box, which reads
   * to a recipient as a broken email rather than a plain one.
   *
   * ⚠️ This comment used to claim "neither send path relies on this — both
   * supply an origin", and treated reaching the drop as hypothetical. It was
   * wrong, and it was wrong in the direction that hides the bug: campaign-send
   * passed no `mediaOrigin`/`mediaHostId` at all, so every author-picked image
   * was silently dropped from every marketing campaign until AGL-1394. The
   * quiet failure IS still the right one for a caller that genuinely has no
   * origin — but "no caller reaches this" is a claim about the whole repo, and
   * it decays the moment someone adds a third send path. Verify it before
   * relying on it; do not restore a count here.
   *
   * A protocol-relative `//host/x.png` is passed through untouched: it is
   * already absolute enough to name a host, and prefixing an origin would
   * corrupt it.
   *
   * The scheme is checked on the way out. `resolveEmailMediaSrc` recognizes
   * the two stored reference forms and passes anything else through as an
   * author-typed URL, so it is this check and nothing else that stands
   * between what an author types and the `src` attribute. A refusal drops
   * the image on the same reasoning as everything else here that cannot be
   * made fetchable: a gap reads as a plain email, and a `src` we would not
   * stand behind is not made safer by shipping it.
   */
  const imageSrc = (value: unknown): string | undefined => {
    const resolved = resolveEmailMediaSrc(subUrl(value), mediaHostId)
    if (!resolved || !hasSafeMediaScheme(resolved)) return undefined
    if (!resolved.startsWith('/') || resolved.startsWith('//')) return resolved
    return origin ? `${origin}${resolved}` : undefined
  }

  const renderChildren = (ids: string[] | undefined): string =>
    (ids ?? [])
      .map((id) => renderNode(id))
      .filter(Boolean)
      .join('')

  const renderNode = (id: string): string => {
    const node = nodes[id]
    if (!node) return ''
    const props = node.props ?? {}
    switch (node.componentId) {
      case 'emailSection': {
        const background = props.backgroundColor || '#ffffff'
        const padding = Number.isFinite(Number(props.padding))
          ? Number(props.padding)
          : 24
        const align = props.align || 'left'
        return (
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
          `style="background-color:${background};">` +
          row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
              renderChildren(node.nodes) +
              `</table>`,
            `padding:${padding}px;text-align:${align};`,
          ) +
          `</table>`
        )
      }
      case 'emailText': {
        const text = sub(props.children)
        textParts.push(text)
        const style = TEXT_STYLES[props.variant as string] ?? TEXT_STYLES['body']
        const color = props.color || '#1a1a1a'
        const align = props.align || 'left'
        return row(
          `<div style="font-family:${FONT};${style};color:${color};text-align:${align};">` +
            escapeEmailHtml(text).replace(/\n/g, '<br />') +
            `</div>`,
          'padding:4px 0;',
        )
      }
      case 'emailRichtext':
      case 'emailHtml': {
        const html = sanitize(sub(props.html))
        if (!html.trim()) return ''
        textParts.push(html.replace(/<[^>]+>/g, ' ').trim())
        return row(
          `<div style="font-family:${FONT};font-size:15px;line-height:1.55;">${html}</div>`,
          'padding:4px 0;',
        )
      }
      case 'emailImage': {
        const src = imageSrc(props.src)
        if (!src) return ''
        const width = Number(props.width) > 0 ? Number(props.width) : 600
        const alt = escapeEmailHtml(String(props.alt ?? ''))
        const align = props.align || 'center'
        const img =
          `<img src="${escapeEmailHtml(src)}" alt="${alt}" width="${Math.min(width, 600)}" ` +
          `style="display:inline-block;max-width:100%;height:auto;border:0;" />`
        // A refused href drops the WRAPPER, not the picture: the image is the
        // content and the link is decoration on it.
        const href = linkHref(props.href)
        return row(
          href
            ? `<a href="${escapeEmailHtml(href)}" target="_blank">${img}</a>`
            : img,
          `padding:8px 0;text-align:${align};`,
        )
      }
      case 'emailButton': {
        const label = sub(props.children ?? 'Call to action')
        // A refused href falls back to the placeholder the empty case already
        // uses, so the button keeps its place in the layout and goes nowhere.
        // Dropping the row instead would take the author's copy with it, and
        // an inert button reads as an unfinished email rather than a broken
        // one. The plain-text alternative gets the same value the anchor
        // does — a text/plain body is inert, but it is still delivered mail
        // and a refused URL does not belong in it either.
        const href = linkHref(props.href ?? '#') ?? '#'
        const background = props.backgroundColor || '#1a73e8'
        const color = props.color || '#ffffff'
        const align = props.align || 'center'
        textParts.push(`${label}: ${href}`)
        // Bulletproof-ish button: padded anchor, table-aligned.
        return row(
          `<a href="${escapeEmailHtml(href)}" target="_blank" ` +
            `style="display:inline-block;padding:12px 28px;border-radius:6px;` +
            `background-color:${background};color:${color};font-family:${FONT};` +
            `font-size:15px;font-weight:600;text-decoration:none;">` +
            escapeEmailHtml(label) +
            `</a>`,
          `padding:12px 0;text-align:${align};`,
        )
      }
      case 'emailDivider': {
        const color = props.color || '#e0e0e0'
        return row(
          `<div style="border-top:1px solid ${color};font-size:0;line-height:0;">&nbsp;</div>`,
          'padding:12px 0;',
        )
      }
      case 'emailSpacer': {
        const height = Number(props.height) > 0 ? Number(props.height) : 24
        return row(
          `<div style="height:${height}px;font-size:0;line-height:0;">&nbsp;</div>`,
        )
      }
      case 'emailProduct': {
        const product = props.productId
          ? products?.[String(props.productId)]
          : undefined
        if (!product) return ''
        const label = sub(props.buttonLabel ?? 'Shop now')
        // Catalog data rather than author markup, and the caller absolutizes
        // it before it arrives — but "it came from a trusted table" is a
        // claim about every writer of that table, so the same rule applies
        // here as to an author-typed href. Refused means no button and no
        // line in the text part; the product card itself still renders.
        const productUrl =
          product.url && hasSafeLinkScheme(product.url)
            ? product.url
            : undefined
        textParts.push(
          `${product.name}${product.priceLabel ? ` — ${product.priceLabel}` : ''}` +
            (productUrl ? `: ${productUrl}` : ''),
        )
        // Same treatment as emailImage: a catalog image can be a picked
        // asset, so it carries the same reference/relative forms (AGL-1224).
        const productImage = imageSrc(product.imageUrl)
        const image = productImage
          ? `<img src="${escapeEmailHtml(productImage)}" alt="${escapeEmailHtml(product.name)}" width="280" style="max-width:100%;height:auto;border:0;border-radius:6px;" /><br />`
          : ''
        const button = productUrl
          ? `<a href="${escapeEmailHtml(productUrl)}" target="_blank" style="display:inline-block;margin-top:8px;padding:10px 24px;border-radius:6px;background-color:#1a73e8;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;">${escapeEmailHtml(label)}</a>`
          : ''
        return row(
          `<div style="border:1px solid #e0e0e0;border-radius:8px;padding:16px;text-align:center;font-family:${FONT};">` +
            image +
            `<div style="font-size:16px;font-weight:600;margin-top:8px;">${escapeEmailHtml(product.name)}</div>` +
            (product.priceLabel
              ? `<div style="font-size:14px;color:#555555;margin-top:2px;">${escapeEmailHtml(product.priceLabel)}</div>`
              : '') +
            button +
            `</div>`,
          'padding:8px 0;',
        )
      }
      default: {
        // Unknown/web components: render their children so mixed documents
        // degrade gracefully instead of dropping content.
        return renderChildren(node.nodes)
      }
    }
  }

  const body = renderNode(rootId) || renderChildren(nodes[rootId]?.nodes)
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">` +
      escapeEmailHtml(sub(preheader)) +
      `</div>`
    : ''

  // INSIDE the 600px table, above the designed body, so it inherits the
  // column's width on a phone instead of being centred against the viewport.
  // `alt` is the product name where one is known, because a logo blocked by
  // the client (which is the default in most inboxes) must still say who sent
  // the mail. Height is capped rather than set, so a wordmark and a square
  // mark both land at a sane size without the sender supplying dimensions.
  //
  // The src goes through `imageSrc` like every other image in the message
  // (AGL-2230), and NOT into the tag raw. `emailLogoUrl` is collected by
  // `MediaUrlField`, whose "Browse" button writes the picked asset's
  // site-relative `cdnPath` — and the org DAM's other generation stores a
  // `media:{scope}/{mediaId}` reference. Neither is a URL an inbox can
  // resolve: there is no page to resolve it against, so a raw pass-through
  // put `src="media:h1/med9"` at the top of every transactional email a
  // white-label org sent. `imageSrc` absolutizes both forms against
  // `mediaOrigin`, passes a real https URL through untouched, and returns
  // undefined when it cannot produce something fetchable — in which case the
  // row is dropped, on the same reasoning as AGL-1224: a gap reads as a plain
  // email, a broken-image box reads as a broken one.
  const brandLogo = imageSrc(String(brandLogoUrl ?? '').trim()) ?? ''
  // The product name from the merge map, because most inboxes block images by
  // default — a logo with no `alt` is a blank box where the sender's identity
  // should be. Falls back to nothing rather than to a literal, which would
  // reintroduce the hard-coded brand this whole change removes.
  const brandLogoAlt = merge?.['brand.productName'] ?? ''
  const brandLogoHtml = brandLogo
    ? row(
        `<img src="${escapeEmailHtml(brandLogo)}" alt="${escapeEmailHtml(brandLogoAlt)}" ` +
          `style="max-height:48px;max-width:200px;display:block;margin:0 auto;border:0;" />`,
        'padding:24px 24px 0;text-align:center;',
      )
    : ''

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>${escapeEmailHtml(sub(subject))}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">` +
    preheaderHtml +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">` +
    row(
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="max-width:600px;width:100%;margin:0 auto;">` +
        brandLogoHtml +
        body +
        `</table>`,
      'padding:24px 8px;',
    ) +
    `</table></body></html>`

  return { html, text: textParts.join('\n\n') }
}
