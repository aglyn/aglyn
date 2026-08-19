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
 */

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
  /** Sanitizer applied to richtext/custom HTML (defaults to identity —
   * pass the custom-html policy in app code). */
  sanitize?: (html: string) => string
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
   * The sending org's white-label email logo, or absent (AGL-2139).
   *
   * `emailLogoUrl` has been a first-class field of `OrgBrandingProfile` since
   * White-Label Phase 1 — collected in the branding editor, https-validated,
   * persisted, and resolved by `resolveBrandingProfile` — and it was read at
   * ZERO render sites. An agency admin on the most expensive tier filled the
   * field in, the console confirmed the save, and the value appeared in no
   * email ever sent. This option is what makes it a capability rather than a
   * stored string.
   *
   * Rendered as a header row inside the 600px table, ABOVE the template body,
   * so it applies to a staff-designed template and a catalog default alike
   * without either having to wire anything. Absent — which is the resolved
   * value for every non-white-label org — emits nothing at all rather than an
   * empty `<img>`, because a zero-height broken-image box at the top of a
   * transactional email reads as a broken email.
   *
   * Goes through `imageSrc` like any other image, so a `media:` reference or
   * a relative CDN path is absolutized against `mediaOrigin` and DROPPED
   * rather than emitted relative when there is no origin (AGL-1224).
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
    sanitize = (html: string) => html,
    mediaOrigin,
    mediaHostId,
    brandLogoUrl,
  } = options

  const textParts: string[] = []
  const sub = (value: unknown): string =>
    substituteMergeTokens(String(value ?? ''), merge)

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
   */
  const imageSrc = (value: unknown): string | undefined => {
    const resolved = resolveEmailMediaSrc(sub(value), mediaHostId)
    if (!resolved) return undefined
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
        const href = sub(props.href)
        return row(
          href
            ? `<a href="${escapeEmailHtml(href)}" target="_blank">${img}</a>`
            : img,
          `padding:8px 0;text-align:${align};`,
        )
      }
      case 'emailButton': {
        const label = sub(props.children ?? 'Call to action')
        const href = sub(props.href ?? '#')
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
        textParts.push(
          `${product.name}${product.priceLabel ? ` — ${product.priceLabel}` : ''}` +
            (product.url ? `: ${product.url}` : ''),
        )
        // Same treatment as emailImage: a catalog image can be a picked
        // asset, so it carries the same reference/relative forms (AGL-1224).
        const productImage = imageSrc(product.imageUrl)
        const image = productImage
          ? `<img src="${escapeEmailHtml(productImage)}" alt="${escapeEmailHtml(product.name)}" width="280" style="max-width:100%;height:auto;border:0;border-radius:6px;" /><br />`
          : ''
        const button = product.url
          ? `<a href="${escapeEmailHtml(product.url)}" target="_blank" style="display:inline-block;margin-top:8px;padding:10px 24px;border-radius:6px;background-color:#1a73e8;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;">${escapeEmailHtml(label)}</a>`
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

  // White-label email logo (AGL-2139). Emitted only when the org actually has
  // one — `resolveBrandingProfile` returns null here for every org without the
  // `whiteLabel` entitlement, and an empty src would render as a broken-image
  // box rather than as nothing. Capped at 180px wide and given the org's brand
  // as alt text so a client with images off still reads the brand.
  const logoSrc = brandLogoUrl ? imageSrc(brandLogoUrl) : undefined
  const brandLogoHtml = logoSrc
    ? row(
        `<img src="${escapeEmailHtml(logoSrc)}" alt="${escapeEmailHtml(
          sub(merge?.['brand.productName'] ?? ''),
        )}" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0;margin:0 auto;" />`,
        'padding:0 0 20px;text-align:center;',
      )
    : ''
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">` +
      escapeEmailHtml(sub(preheader)) +
      `</div>`
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
