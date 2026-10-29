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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import sharp from 'sharp'
import {
  commercePdfContactLines,
  commercePdfFilename,
  handleQuotePdf,
  loadCommercePdfBrand,
  logoJpeg,
  orderInvoicePdfFile,
  quotePdfFile,
  type CommercePdfBrandDeps,
  type QuotePdfRouteDeps,
} from './commerce-pdf'
import { pdfResponseHeaders } from './pdf-response'
import { mintQuoteLinkToken } from './quote-link-token'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {},
  getOrgForHost: jest.fn(async () => null),
  consumeRateLimit: jest.fn(),
  isServerReleaseFlagOnForOrg: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin/server/media-variants', () => ({
  loadSharp: async () => jest.requireActual('sharp'),
}))

/**
 * The quote and invoice PDFs on the server (AGL-4095): the brand they are
 * drawn with, the logo's conversion, and the customer's download behind the
 * quote's signed link, refused exactly as the quote page's data is.
 */

const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

const HOST = {
  subdomain: 'acme',
  displayName: 'Acme Tents',
  seo: { entity: { name: 'Acme Tents', email: 'hello@example.com', telephone: '(512) 555-0142' } },
  business: { supportEmail: 'help@example.com', address: '1 Main St\nAustin, TX 78701' },
  logoUrl: 'https://cdn.example.com/logo.png',
  timeZone: 'America/Chicago',
  theme: { colorSchemes: { light: { primary: { main: '#0b6e4f' } } } },
}

const docs = new Map<string, Record<string, any>>()

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (field: string) => field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  }
}

const firestore: any = { collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }) }

let rateAllowed = true
const rateKeys: string[] = []
const rendered: Array<Parameters<QuotePdfRouteDeps['quotePdf']>[0]> = []

const deps: QuotePdfRouteDeps = {
  firestore: () => firestore,
  consumeRateLimit: async (key) => {
    rateKeys.push(key)
    return { allowed: rateAllowed, resetMs: 60_000 }
  },
  orgForHost: async () => ({ id: 'org-1', org: { timeZone: 'America/New_York' } }),
  nativeMode: async () => ({ native: false, publishableKey: '' }) as never,
  taxRateId: async () => null,
  createSession: async () => ({ ok: false, session: {} }),
  expireSession: async () => 'expired',
  ensureDomain: async () => null,
  now: () => 10_000,
  quotePdf: async (input) => {
    rendered.push(input)
    return { bytes: new Uint8Array([37, 80, 68, 70]), filename: 'acme-tents-quote-1042.pdf' }
  },
}

const request = (query: Record<string, string>, method = 'GET'): PluginApiRequest =>
  ({ method, query, body: undefined, headers: {}, cookies: {}, socket: {} }) as PluginApiRequest

const token = (version = 1) => String(mintQuoteLinkToken('site1', 'q-1', version))

function storeQuote(section: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  docs.set('hosts/site1/orders/q-1', {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [{ productId: 'canopy', name: 'Canopy 10x10', quantity: 2, unitAmountCents: 120_000 }],
    totals: { itemsCents: 240_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 240_000 },
    quote: {
      stage: 'sent',
      revision: 3,
      customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
      tax: { kind: 'none', reason: 'not-collected' },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  })
}

const SECRET = process.env.TOKEN_SIGNING_SECRET

beforeEach(() => {
  process.env.TOKEN_SIGNING_SECRET = 'quote-pdf-spec-secret'
  docs.clear()
  rendered.length = 0
  rateKeys.length = 0
  rateAllowed = true
  docs.set('hosts/site1', HOST)
  docs.set('hosts/site1/settings/store', { currency: 'USD' })
  storeQuote()
})

afterAll(() => {
  if (SECRET === undefined) delete process.env.TOKEN_SIGNING_SECRET
  else process.env.TOKEN_SIGNING_SECRET = SECRET
})

describe('the customer’s download', () => {
  it('answers the PDF for the link’s quote, with its current pay link', async () => {
    const outcome = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token() }))
    expect(outcome.status).toBe(200)
    expect('pdf' in outcome && outcome.pdf.filename).toBe('acme-tents-quote-1042.pdf')
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toEqual(
      expect.objectContaining({ hostId: 'site1', quoteId: 'q-1', owner: expect.objectContaining({ id: 'org-1' }) }),
    )
    expect(rendered[0].payUrl).toBe(`https://acme.aglyn.app/pay-quote?q=q-1&t=${encodeURIComponent(token())}`)
    expect(rateKeys[0]).toMatch(/^commerce-quote-pdf:site1:/)
  })

  it('prints no pay link on a paid quote', async () => {
    storeQuote({ paidAtMs: 5_000 }, { status: 'paid' })
    const outcome = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token() }))
    expect(outcome.status).toBe(200)
    expect(rendered[0].payUrl).toBeNull()
  })

  it('answers a wrong token exactly as a quote that does not exist', async () => {
    const wrong = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: `1.${'0'.repeat(32)}` }))
    const missing = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-404', t: String(mintQuoteLinkToken('site1', 'q-404', 1)) }))
    expect(wrong.status).toBe(404)
    expect(wrong).toEqual(missing)
    expect(rendered).toHaveLength(0)
  })

  it('refuses a link the business replaced, and one signed for a version not made yet', async () => {
    storeQuote({ linkVersion: 2 })
    const old = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token(1) }))
    expect(old.status).toBe(410)
    const ahead = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token(3) }))
    expect(ahead.status).toBe(404)
    expect(rendered).toHaveLength(0)
    expect((await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token(2) }))).status).toBe(200)
  })

  it('refuses a document that is not a quote', async () => {
    storeQuote({}, { channel: 'web' })
    expect((await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token() }))).status).toBe(404)
  })

  it('answers an invoiced draft’s link with its invoice PDF, carrying the same link (AGL-4099)', async () => {
    docs.set('hosts/site1/orders/d-1', {
      number: 2001,
      status: 'pending',
      channel: 'draft',
      lineItems: [{ productId: 'canopy', name: 'Canopy 10x10', productType: 'service', quantity: 1, unitAmountCents: 50_000 }],
      totals: { itemsCents: 50_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 50_000 },
    })
    const invoices: unknown[] = []
    const draftToken = String(mintQuoteLinkToken('site1', 'd-1', 1))
    const outcome = await handleQuotePdf(
      {
        ...deps,
        invoicePdf: async (input) => {
          invoices.push(input)
          return { bytes: new Uint8Array([37]), filename: 'acme-tents-invoice-2001.pdf' }
        },
      },
      request({ hostId: 'site1', q: 'd-1', t: draftToken }),
    )
    expect('pdf' in outcome && outcome.pdf.filename).toBe('acme-tents-invoice-2001.pdf')
    expect(rendered).toHaveLength(0)
    expect(invoices[0]).toEqual(
      expect.objectContaining({ orderId: 'd-1', payUrl: `https://acme.aglyn.app/pay-quote?q=d-1&t=${encodeURIComponent(draftToken)}` }),
    )
  })

  it('is rate-limited before the token is checked', async () => {
    rateAllowed = false
    const outcome = await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: 'not-a-token' }))
    expect(outcome.status).toBe(429)
    expect('headers' in outcome && outcome.headers?.['Retry-After']).toBeTruthy()
  })

  it('refuses an incomplete link and any method but GET', async () => {
    expect((await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1' }))).status).toBe(400)
    expect((await handleQuotePdf(deps, request({ hostId: 'site1', q: 'q-1', t: token() }, 'POST'))).status).toBe(405)
  })

  it('is a download that is never cached, indexed or referred on', () => {
    expect(pdfResponseHeaders({ bytes: new Uint8Array(), filename: 'acme-quote-1.pdf' })).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="acme-quote-1.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    })
  })
})

describe('the brand', () => {
  const brandDeps = (logo: CommercePdfBrandDeps['logo']): CommercePdfBrandDeps => ({
    logo,
    orgForHost: async () => ({ id: 'org-9', org: {} }),
  })

  it('reads the business, its contact, its theme and its zone from the site', async () => {
    const logo = jest.fn<ReturnType<CommercePdfBrandDeps['logo']>, Parameters<CommercePdfBrandDeps['logo']>>(async () => null)
    const brand = await loadCommercePdfBrand({ hostId: 'site1', host: HOST }, brandDeps(logo))
    expect(brand.businessName).toBe('Acme Tents')
    expect(brand.contactLines).toEqual(['1 Main St', 'Austin, TX 78701', 'hello@example.com', '(512) 555-0142', 'acme.aglyn.app'])
    expect(brand.colors?.accent).toBe('#0b6e4f')
    expect(brand.timeZone).toBe('America/Chicago')
    expect(logo).toHaveBeenCalledWith({ hostId: 'site1', orgId: 'org-9', value: 'https://cdn.example.com/logo.png' })
    expect(brand.logo).toBeNull()
  })

  it('asks for no logo when the site has none, and falls back to the support email', async () => {
    const logo = jest.fn(async () => null)
    const brand = await loadCommercePdfBrand(
      { hostId: 'site1', host: { displayName: 'Plain Co', business: { supportEmail: 'help@example.com' } }, owner: null },
      brandDeps(logo),
    )
    expect(logo).not.toHaveBeenCalled()
    expect(brand.businessName).toBe('Plain Co')
    expect(commercePdfContactLines({ business: { supportEmail: 'help@example.com' } })).toEqual(['help@example.com'])
  })

  it('names the file by the business, the document and its number', () => {
    expect(commercePdfFilename('Café Zoë & Co.', 'quote', 1042, 'q-1')).toBe('cafe-zoe-co-quote-1042.pdf')
    expect(commercePdfFilename('', 'invoice', undefined, 'abcdefXYZ123')).toBe('invoice-xyz123.pdf')
  })

  it('turns a logo with transparency into a JPEG on white, no larger than it needs to be', async () => {
    const png = await sharp({
      create: { width: 1600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="200" r="150"/></svg>'), left: 0, top: 0 }])
      .png()
      .toBuffer()
    const jpeg = await logoJpeg(png, sharp as never)
    expect(jpeg).toEqual(expect.objectContaining({ width: 720, height: 180, components: 3 }))
    const corner = await sharp(Buffer.from(jpeg?.bytes ?? [])).extract({ left: 700, top: 5, width: 1, height: 1 }).raw().toBuffer()
    expect(Math.min(...corner)).toBeGreaterThan(245)
  })

  it('throws on bytes sharp cannot read, which the brand turns into no logo', async () => {
    await expect(logoJpeg(Buffer.from('not an image'), sharp as never)).rejects.toThrow()
  })
})

describe('the files', () => {
  const brandDeps: CommercePdfBrandDeps = { logo: async () => null, orgForHost: async () => null }

  it('makes the quote’s PDF from the customer-safe view, with the pay link given', async () => {
    const order = docs.get('hosts/site1/orders/q-1') as never
    const file = await quotePdfFile(
      { hostId: 'site1', quoteId: 'q-1', order, host: HOST, store: { currency: 'USD' }, owner: null, payUrl: 'https://acme.aglyn.app/pay-quote?q=q-1&t=1.x' },
      brandDeps,
    )
    const pdf = text(file.bytes)
    expect(file.filename).toBe('acme-tents-quote-1042.pdf')
    expect(pdf).toContain('(Quote #1042) Tj')
    expect(pdf).toContain('(Revision) Tj')
    expect(pdf).toContain('(3) Tj')
    expect(pdf).toContain('/URI (https://acme.aglyn.app/pay-quote?q=q-1&t=1.x)')
    expect(pdf).not.toContain('jordan@example.com')
  })

  it('makes an order’s invoice PDF', async () => {
    const file = await orderInvoicePdfFile(
      {
        hostId: 'site1',
        orderId: 'o-1',
        order: { number: 7, status: 'paid', lineItems: [{ productId: 'p', name: 'Mug', quantity: 1, unitAmountCents: 900 }], totals: { itemsCents: 900, totalCents: 900, feeCents: 0 } } as never,
        host: HOST,
        store: { currency: 'USD', receiptFooter: 'Thanks!' },
        owner: null,
      },
      brandDeps,
    )
    expect(file.filename).toBe('acme-tents-invoice-7.pdf')
    const pdf = text(file.bytes)
    expect(pdf).toContain('(Invoice #7) Tj')
    expect(pdf).toContain('(Thanks!) Tj')
  })
  it('prints an unpaid invoice’s pay link, and an unpaid quote’s customer from its quote (AGL-4099)', async () => {
    const order = docs.get('hosts/site1/orders/q-1') as never
    const file = await orderInvoicePdfFile(
      { hostId: 'site1', orderId: 'q-1', order, host: HOST, store: { currency: 'USD' }, owner: null, payUrl: 'https://acme.aglyn.app/pay-quote?q=q-1&t=1.x' },
      brandDeps,
    )
    const pdf = text(file.bytes)
    expect(pdf).toContain('(Invoice #1042) Tj')
    expect(pdf).toContain('(Pay this invoice) Tj')
    expect(pdf).toContain('/URI (https://acme.aglyn.app/pay-quote?q=q-1&t=1.x)')
    expect(pdf).toContain('(Jordan Lee) Tj')
    expect(pdf).toContain('(Awaiting payment) Tj')
  })

  it('prints no pay link on a paid invoice, whatever it is handed', async () => {
    const file = await orderInvoicePdfFile(
      {
        hostId: 'site1',
        orderId: 'o-1',
        order: { number: 7, status: 'paid', lineItems: [{ productId: 'p', name: 'Mug', quantity: 1, unitAmountCents: 900 }], totals: { itemsCents: 900, totalCents: 900, feeCents: 0 } } as never,
        host: HOST,
        store: { currency: 'USD' },
        owner: null,
        payUrl: 'https://acme.aglyn.app/pay-quote?q=o-1&t=1.x',
      },
      brandDeps,
    )
    expect(text(file.bytes)).not.toContain('pay-quote')
  })
})
