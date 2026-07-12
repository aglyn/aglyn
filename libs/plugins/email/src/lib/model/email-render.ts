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

export function renderEmailHtml(options: EmailRenderOptions): RenderedEmail {
  const {
    nodes,
    rootId = 'root',
    subject = '',
    preheader = '',
    merge,
    products,
    sanitize = (html: string) => html,
  } = options

  const textParts: string[] = []
  const sub = (value: unknown): string =>
    substituteMergeTokens(String(value ?? ''), merge)

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
        const src = sub(props.src)
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
        const image = product.imageUrl
          ? `<img src="${escapeEmailHtml(product.imageUrl)}" alt="${escapeEmailHtml(product.name)}" width="280" style="max-width:100%;height:auto;border:0;border-radius:6px;" /><br />`
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
        body +
        `</table>`,
      'padding:24px 8px;',
    ) +
    `</table></body></html>`

  return { html, text: textParts.join('\n\n') }
}
