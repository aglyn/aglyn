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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { siteContactEmail, resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { resolveSiteTheme, type ThemeHostDocument } from '@aglyn/aglyn/app-utils/site-theme'
import { buildEmailPalette, emailPaletteBaseForHost } from '@aglyn/shared-util-email'
import { readJpeg, type PdfJpegImage } from '@aglyn/shared-util-tools/pdf/pdf-file'
import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { loadSharp } from '@aglyn/tenant-data-admin/server/media-variants'
import * as CommerceModel from '../model'
import {
  COMMERCE_PDF_NEUTRAL_COLORS,
  commercePdfColorsFromPalette,
  renderOrderInvoicePdf,
  renderQuotePdf,
  type CommercePdfBrand,
  type CommercePdfColors,
} from '../utils/commerce-document-pdf'
import { invoiceStoreFrom } from '../utils/order-invoice'
import { orderStatusUrl } from './order-status-token'
import { sendPdf, type CommercePdfFile } from './pdf-response'
import { quotePayLinkUrl } from './quote-link-token'
import {
  defaultQuotePayDeps,
  limitedQuoteLink,
  loadLinkedQuote,
  quoteLinkParams,
  sendQuoteLinkOutcome,
  type QuoteLinkOutcome,
  type QuotePayDeps,
} from './quote-pay'
import { locateImageSource, readImageSourceBytes } from './site-image-source'

/*==========================================
 * A QUOTE'S AND AN ORDER'S PDF ON THE SERVER (AGL-4095).
 *
 * What the renderers in `utils/commerce-document-pdf.ts` are given comes from
 * here: the site's business name and contact, its theme's colors, its logo
 * (read from storage or its public address, converted to a JPEG on white by
 * sharp, and left out when there is none or it cannot be read), its time
 * zone, and the quote or order itself.
 *
 * Three doors use it, each loading this module only when it is asked for a
 * PDF, so sharp and the PDF writer stay out of every other request:
 *
 *   POST commerce/quote { action: 'pdf' }                 the console's quote ("Create and edit quotes")
 *   GET  commerce/order-print?kind=invoice-pdf             the console's and the apps' invoice ("Manage orders")
 *   GET  commerce/quote-pdf?hostId=&q=&t=                  the customer's quote, by its signed link
 *=========================================*/

/** A logo source larger than this is not read. */
const LOGO_SOURCE_MAX_BYTES = 10_000_000

/** The logo's pixels: about four times the box it is drawn in, never enlarged. */
const LOGO_PIXELS = { width: 720, height: 200 } as const

/** A converted logo larger than this is left out rather than bloat every copy of the document. */
const LOGO_MAX_JPEG_BYTES = 350_000

/** A source whose decoded pixels exceed this is refused rather than decoded. */
const LOGO_MAX_INPUT_PIXELS = 50_000_000

/** The ground a logo's transparent pixels are flattened onto: the page's white. */
const LOGO_GROUND = { r: 255, g: 255, b: 255 } as const

type HostDocument = Record<string, unknown>

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The business's contact as the document prints it: its postal address (a
 * block of text, a line per line), the email visitors write to, its phone,
 * and its web address without the scheme.
 */
export function commercePdfContactLines(host: HostDocument | null | undefined): string[] {
  const source = (host ?? {}) as HostTokenSource & {
    seo?: { entity?: { email?: unknown; telephone?: unknown } }
    business?: { supportEmail?: unknown }
  }
  const address = trimmed(resolveHostToken('address', source))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const email = siteContactEmail(source) ?? ''
  const phone = trimmed(source.seo?.entity?.telephone)
  const site = trimmed(resolveHostToken('url', source)).replace(/^https?:\/\//, '').replace(/\/$/, '')
  return [...address, email, phone, site].filter(Boolean)
}

/** The site theme's colors for a document, or the neutral ones when the theme cannot be read. */
export function commercePdfSiteColors(host: HostDocument | null | undefined): CommercePdfColors {
  try {
    const theme = resolveSiteTheme((host ?? null) as ThemeHostDocument | null)
    return commercePdfColorsFromPalette(
      buildEmailPalette({
        base: emailPaletteBaseForHost(host as { cname?: string; subdomain?: string } | null),
        colors: (theme?.colorSchemes?.light ?? null) as Record<string, unknown> | null,
      }),
    )
  } catch {
    return { ...COMMERCE_PDF_NEUTRAL_COLORS }
  }
}

/** sharp's decoding options; an SVG is rasterized dense enough for the logo's pixels. */
async function decodeOptions(sharp: Awaited<ReturnType<typeof loadSharp>>, source: Buffer) {
  const base = { limitInputPixels: LOGO_MAX_INPUT_PIXELS, failOn: 'error' as const }
  const meta = await sharp(source, base).metadata()
  if (meta.format !== 'svg') return base
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (!longest) return base
  return { ...base, density: Math.min(2400, Math.max(1, Math.ceil((72 * LOGO_PIXELS.width) / longest))) }
}

/**
 * A logo's bytes as a JPEG the PDF can carry: turned upright, fitted inside
 * {@link LOGO_PIXELS}, transparency flattened onto white, and small enough to
 * attach. Null when the bytes are not an image sharp reads.
 */
export async function logoJpeg(source: Buffer, sharpFactory?: Awaited<ReturnType<typeof loadSharp>>): Promise<PdfJpegImage | null> {
  const sharp = sharpFactory ?? (await loadSharp())
  const options = await decodeOptions(sharp, source)
  for (const quality of [86, 72]) {
    const jpeg = await sharp(source, options)
      .rotate()
      .resize(LOGO_PIXELS.width, LOGO_PIXELS.height, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: LOGO_GROUND })
      .jpeg({ quality })
      .toBuffer()
    if (jpeg.length <= LOGO_MAX_JPEG_BYTES) return readJpeg(new Uint8Array(jpeg))
  }
  return null
}

export interface CommercePdfBrandDeps {
  /** The site's logo as a JPEG, or null; never throws. */
  logo(input: { hostId: string; orgId: string; value: string }): Promise<PdfJpegImage | null>
  orgForHost(hostId: string): Promise<{ id?: string; org?: unknown } | null>
}

export function defaultCommercePdfBrandDeps(): CommercePdfBrandDeps {
  return {
    logo: async ({ hostId, orgId, value }) => {
      try {
        const located = await locateImageSource(value, hostId, orgId, LOGO_SOURCE_MAX_BYTES)
        const bytes = located ? await readImageSourceBytes(located, LOGO_SOURCE_MAX_BYTES) : null
        return bytes ? await logoJpeg(bytes) : null
      } catch (error) {
        console.warn('[commerce/pdf] the site logo was left out', error)
        return null
      }
    },
    orgForHost: async (hostId) => {
      const found = await getOrgForHost(hostId)
      return found ? { id: found.orgId, org: found.org } : null
    },
  }
}

/** Who a site's documents are from: its name, contact, colors, logo and time zone. */
export async function loadCommercePdfBrand(
  input: { hostId: string; host: HostDocument; owner?: { id?: string; org?: unknown } | null },
  deps: CommercePdfBrandDeps = defaultCommercePdfBrandDeps(),
): Promise<CommercePdfBrand> {
  const host = input.host
  const owner = input.owner === undefined ? await deps.orgForHost(input.hostId).catch(() => null) : input.owner
  const logoValue = trimmed(resolveHostToken('logo', host as HostTokenSource))
  const logo = logoValue ? await deps.logo({ hostId: input.hostId, orgId: String(owner?.id ?? ''), value: logoValue }) : null
  return {
    businessName: trimmed(resolveHostToken('businessName', host as HostTokenSource)) || trimmed(host['name']),
    contactLines: commercePdfContactLines(host),
    logo,
    colors: commercePdfSiteColors(host),
    timeZone: resolveSiteTimeZone(
      (owner?.org ?? null) as { timeZone?: string } | null,
      host as { timeZone?: string },
    ),
  }
}

/** `acme-signs-quote-1042.pdf`: the business, the document and its number, in ASCII. */
export function commercePdfFilename(businessName: string, document: 'quote' | 'invoice', number: unknown, docId: string): string {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
  const numbered = number != null && String(number).trim() ? String(number) : docId.slice(-6)
  return `${[slug(businessName), document, slug(numbered)].filter(Boolean).join('-')}.pdf`
}

/** A quote's PDF: what its customer's page shows, from the business, with its pay link when given one. */
export async function quotePdfFile(
  input: {
    hostId: string
    quoteId: string
    order: CommerceModel.HostOrder
    host: HostDocument
    store: HostDocument | null | undefined
    owner?: { id?: string; org?: unknown } | null
    /** Printed on a quote still to be paid; null leaves it off. */
    payUrl: string | null
  },
  deps?: CommercePdfBrandDeps,
): Promise<CommercePdfFile> {
  const brand = await loadCommercePdfBrand({ hostId: input.hostId, host: input.host, owner: input.owner }, deps)
  const view = CommerceModel.buildQuotePageView({
    order: input.order,
    orderId: input.quoteId,
    storeName: brand.businessName,
    currency: String(input.store?.['currency'] ?? 'USD'),
    receiptUrl: CommerceModel.isUnpaidQuote(input.order) ? null : orderStatusUrl(input.host, input.hostId, input.quoteId),
  })
  return {
    bytes: renderQuotePdf({ brand, view, revision: Number(input.order.quote?.revision) || 1, payUrl: input.payUrl }),
    filename: commercePdfFilename(brand.businessName, 'quote', input.order.number, input.quoteId),
  }
}

/** An order's invoice PDF, a paid quote's included. */
export async function orderInvoicePdfFile(
  input: {
    hostId: string
    orderId: string
    order: CommerceModel.HostOrder
    host: HostDocument
    store: HostDocument | null | undefined
    owner?: { id?: string; org?: unknown } | null
  },
  deps?: CommercePdfBrandDeps,
): Promise<CommercePdfFile> {
  const brand = await loadCommercePdfBrand({ hostId: input.hostId, host: input.host, owner: input.owner }, deps)
  return {
    bytes: renderOrderInvoicePdf({
      brand,
      order: input.order,
      orderId: input.orderId,
      store: invoiceStoreFrom(input.host, input.store),
    }),
    filename: commercePdfFilename(brand.businessName, 'invoice', input.order.number, input.orderId),
  }
}

/*==========================================
 * THE CUSTOMER'S DOWNLOAD: GET commerce/quote-pdf?hostId=&q=&t=
 *
 * The same signed link and the same rules as the quote page's data
 * (`commerce/quote-view`): a wrong token answers exactly as a missing quote,
 * a link to an older version of the quote is refused, and every address is
 * rate-limited per site before the token is checked. The PDF is the page's
 * own view, so it shows nothing the page does not.
 *=========================================*/

/** Downloads one address may make per site, per ten minutes. */
export const QUOTE_PDF_DOWNLOADS_PER_WINDOW = 20

export interface QuotePdfRouteDeps extends QuotePayDeps {
  quotePdf: typeof quotePdfFile
}

export async function handleQuotePdf(
  deps: QuotePdfRouteDeps,
  req: PluginApiRequest,
): Promise<QuoteLinkOutcome | { status: 200; pdf: CommercePdfFile }> {
  if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  const { hostId, quoteId, token, complete } = quoteLinkParams((req.query ?? {}) as Record<string, unknown>)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  const refused = await limitedQuoteLink(deps, req, `commerce-quote-pdf:${hostId}`, QUOTE_PDF_DOWNLOADS_PER_WINDOW)
  if (refused) return refused
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const { host, order, store } = linked.loaded
  const payUrl = CommerceModel.isUnpaidQuote(order)
    ? quotePayLinkUrl(host, hostId, quoteId, CommerceModel.quoteLinkVersion(order.quote))
    : null
  const owner = await deps.orgForHost(hostId).catch(() => null)
  const pdf = await deps.quotePdf({
    hostId,
    quoteId,
    order,
    host,
    store: (store.data() ?? null) as HostDocument | null,
    owner: owner ? { id: owner.id, org: owner.org } : null,
    payUrl,
  })
  return { status: 200, pdf }
}

/** `GET /api/commerce/quote-pdf`. */
export const quotePdfHandler: PluginApiHandler = async (req, res) => {
  try {
    const outcome = await handleQuotePdf({ ...defaultQuotePayDeps(), quotePdf: quotePdfFile }, req)
    if ('pdf' in outcome) return sendPdf(res, outcome.pdf)
    return sendQuoteLinkOutcome(res, outcome)
  } catch (error) {
    console.error('quote pdf failed', error)
    return sendQuoteLinkOutcome(res, { status: 500, body: { error: 'This quote could not be made into a PDF. Try again.' } })
  }
}
