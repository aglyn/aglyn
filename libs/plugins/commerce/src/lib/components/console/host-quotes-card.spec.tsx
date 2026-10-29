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
 * The Quotes card and its editor (AGL-4093), rendered: the list reads the
 * `quote` channel of the orders collection, "New quote" is held behind
 * "Create and edit quotes", the editor works the totals out as lines are
 * added, and Save sends the server what was chosen, never a product's price.
 * A saved quote's pay link (AGL-4094) is copied and replaced behind "Send
 * quotes and invoices to customers".
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockFetch = jest.fn<Promise<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>, unknown[]>(
  async () => ({
    ok: true,
    json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
  }),
)
let mockQuotes: Array<Record<string, unknown>> = []
let mockStore: Record<string, unknown> = {}

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  query: (base: { __path: string }) => base,
  where: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  // The site, read once when Send invoice's form opens (AGL-4099).
  getDoc: async () => ({ data: () => ({ displayName: 'Acme Tents' }) }),
  setDoc: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useStoreSettingsHref: (_hostId: string, page: string) => `/acme/hosts/shop/products/${page}`,
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreDoc: () => ({ data: mockStore, status: 'success', fromCache: false }),
  useFirestoreCollection: (build: () => { __path: string }) => {
    const path = build().__path
    if (path.endsWith('/orders')) return { data: mockQuotes, status: 'success' }
    return {
      data: [
        {
          $id: 'canopy',
          name: 'Canopy 10x10',
          type: 'physical',
          variants: [{ id: 'red', options: { Color: 'Red' }, priceUsd: 1200 }],
        },
      ],
      status: 'success',
    }
  },
  writeGuardedBySeed: async (_guard: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: { children: ReactNode; header: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section>
      <h2>{header}</h2>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))

import { HostQuotesCard } from './host-quotes-card.component'

const QUOTE = {
  $id: 'q-1',
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [{ productId: '', custom: true, name: 'Installation', quantity: 1, unitAmountCents: 30_000, productType: 'service' }],
  totals: { itemsCents: 30_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 30_000 },
  timeline: [],
  quote: {
    stage: 'draft',
    revision: 1,
    customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
    tax: { kind: 'at-payment' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    createdBy: 'a',
    updatedBy: 'a',
  },
}

beforeEach(() => {
  mockFetch.mockClear()
  mockQuotes = []
  mockStore = { tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 10 }] } }
})

describe('the Quotes card', () => {
  it('lists each quote with its number, customer, total and status', () => {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(screen.getByText('Quote #1042')).toBeTruthy()
    expect(screen.getByText('Jordan Lee')).toBeTruthy()
    expect(screen.getByText('$300.00')).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('plus tax at payment')).toBeTruthy()
  })

  it('invites the first quote when there are none', () => {
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(screen.getByText(/No quotes yet/)).toBeTruthy()
  })

  it('holds New quote, and Save, behind "Create and edit quotes"', () => {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit={false} canSend />)
    const button = screen.getByRole('button', { name: 'New quote' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByLabelText('Your role does not include "Create and edit quotes" — ask an organization admin')).toBeTruthy()
  })

  it('works the totals out as lines are added, and sends the choices to the server', async () => {
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add custom item' }))
    fireEvent.change(within(dialog).getByLabelText('Item'), { target: { value: 'Installation' } })
    fireEvent.change(within(dialog).getByLabelText('Unit price ($)'), { target: { value: '300' } })
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '2' } })
    // $600 at the store's 10% rate for its own address.
    expect(within(dialog).getByText('Tax (10%)')).toBeTruthy()
    expect(within(dialog).getByText('$660.00')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create quote' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/commerce/quote')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      action: 'create',
      hostId: 'site1',
      quote: {
        lines: [{ kind: 'custom', name: 'Installation', unitAmountCents: 30_000, quantity: 2, ships: true }],
        requireProofApproval: false,
      },
    })
  })

  it('starts a new quote with the store’s proof-approval default', async () => {
    mockStore = { ...mockStore, quotes: { requireProofApproval: true } }
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    const toggle = within(dialog).getByLabelText('Customers approve the proof before they can pay') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('says when tax is added at payment, under Stripe Tax', async () => {
    mockStore = { tax: { mode: 'stripe' } }
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tax is added at payment')).toBeTruthy()
    expect(within(dialog).getByText('Total before tax')).toBeTruthy()
  })
})

describe('a quote’s pay link (AGL-4094)', () => {
  const LINK = 'https://acme.aglyn.app/pay-quote?q=q-1&t=1.0123456789abcdef0123456789abcdef'
  const writeText = jest.fn(async (_text: string) => undefined)

  beforeEach(() => {
    writeText.mockClear()
    Object.assign(navigator, { clipboard: { writeText } })
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ url: LINK, linkVersion: 1 }),
    }))
  })

  afterEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
    }))
  })

  async function openQuote(props: { canEdit?: boolean; canSend?: boolean } = {}) {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit={props.canEdit ?? true} canSend={props.canSend ?? true} />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  it('copies the link the server signs, and shows it', async () => {
    const dialog = await openQuote()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy pay link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/commerce/quote')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'pay-link', hostId: 'site1', quoteId: 'q-1' })
    expect((within(dialog).getByLabelText('Pay link') as HTMLInputElement).value).toBe(LINK)
  })

  it('drops the link on screen when the quote’s link moves on, and shows and copies the new one', async () => {
    const NEXT = 'https://acme.aglyn.app/pay-quote?q=q-1&t=2.fedcba9876543210fedcba9876543210'
    mockQuotes = [QUOTE]
    const card = <HostQuotesCard hostId="site1" canEdit canSend />
    const { rerender } = render(card)
    fireEvent.click(screen.getByText('Quote #1042'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy pay link' }))
    await waitFor(() => expect((within(dialog).getByLabelText('Pay link') as HTMLInputElement).value).toBe(LINK))

    // A revision was emailed (or the link replaced elsewhere): the stored version moves to 2.
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ url: NEXT, linkVersion: 2 }) }))
    mockQuotes = [{ ...QUOTE, quote: { ...QUOTE.quote, linkVersion: 2 } }]
    rerender(<HostQuotesCard hostId="site1" canEdit canSend />)
    await waitFor(() => expect((within(dialog).getByLabelText('Pay link') as HTMLInputElement).value).toBe(NEXT))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((mockFetch.mock.calls[1] as [unknown, string, RequestInit])[2].body))).toMatchObject({
      action: 'pay-link',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy pay link' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(NEXT))
    // Copying the link already current asks the server nothing more.
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('replaces the link only after saying the old one stops working', async () => {
    const dialog = await openQuote()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace link' }))
    const confirm = await screen.findByRole('dialog', { name: 'Replace the pay link?' })
    expect(within(confirm).getByText(/The link you sent before will stop working/)).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Replace link' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [, , init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ action: 'replace-link', hostId: 'site1', quoteId: 'q-1' })
  })

  it('holds both, Send quote and Send invoice behind "Send quotes and invoices to customers", whoever may edit', async () => {
    const dialog = await openQuote({ canEdit: true, canSend: false })
    for (const name of ['Copy pay link', 'Replace link', 'Send quote', 'Send invoice']) {
      expect((within(dialog).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(
      within(dialog).getAllByLabelText(
        'Your role does not include "Send quotes and invoices to customers" — ask an organization admin',
      ),
    ).toHaveLength(4)
  })

  it('offers no Replace on a paid quote, which is locked and says Paid', async () => {
    mockQuotes = [{ ...QUOTE, status: 'paid', quote: { ...QUOTE.quote, paidAtMs: Date.UTC(2026, 9, 30) } }]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Paid').length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/It is an order now and can no longer be changed/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Replace link' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('emailing a quote (AGL-4097)', () => {
  const send = (revision: number, linkVersion: number, atMs: number) => ({
    revision,
    to: 'jordan@example.com',
    subject: 'Quote #1042',
    atMs,
    by: 'owner@example.com',
    messageId: `<q.${atMs}.a@acme.test>`,
    providerId: null,
    linkVersion,
  })

  beforeEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ sent: true, to: 'jordan@example.com', atMs: 5, revision: 1, linkVersion: 1, linkReplaced: false }),
    }))
  })

  afterEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
    }))
  })

  async function openQuote(quote: Record<string, unknown> = QUOTE) {
    mockQuotes = [quote]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  it('sends from a form prefilled with the customer’s email, once per press', async () => {
    const dialog = await openQuote()
    expect(within(dialog).getByText(/Not sent yet/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send quote' }))
    const form = await screen.findByRole('dialog', { name: 'Send quote: Quote #1042' })
    expect((within(form).getByLabelText(/^To/) as HTMLInputElement).value).toBe('jordan@example.com')
    expect((within(form).getByLabelText('Subject') as HTMLInputElement).value).toBe('Quote #1042')
    fireEvent.change(within(form).getByLabelText('Message'), { target: { value: 'Here is the canopy.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/commerce/quote')
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'send',
      hostId: 'site1',
      quoteId: 'q-1',
      to: 'jordan@example.com',
      subject: 'Quote #1042',
      message: 'Here is the canopy.',
    })
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
  })

  it('says when it was sent and to whom, and offers Send again', async () => {
    const dialog = await openQuote({ ...QUOTE, quote: { ...QUOTE.quote, stage: 'sent', sends: [send(1, 1, Date.UTC(2026, 9, 29, 15))] } })
    expect(within(dialog).getByText(/^Sent Oct 29, 2026, .+ to jordan@example\.com\.$/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Send again' })).toBeTruthy()
  })

  it('starts Send again addressed to where the last email went when the quote names no email', async () => {
    const dialog = await openQuote({
      ...QUOTE,
      quote: {
        ...QUOTE.quote,
        stage: 'sent',
        customer: { name: 'Jordan Lee', email: '' },
        sends: [{ ...send(1, 1, 5), to: 'buyer@example.org' }],
      },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send again' }))
    const form = await screen.findByRole('dialog', { name: 'Send again: Quote #1042' })
    expect((within(form).getByLabelText(/^To/) as HTMLInputElement).value).toBe('buyer@example.org')
  })

  it('offers Send revision 2 after a new revision, and says it gives the customer a new link', async () => {
    const dialog = await openQuote({ ...QUOTE, quote: { ...QUOTE.quote, revision: 2, sends: [send(1, 1, 5)] } })
    expect(within(dialog).getByRole('button', { name: 'Send revision 2' })).toBeTruthy()
    expect(within(dialog).getByText(/Sending revision 2 gives your customer a new pay link/)).toBeTruthy()
  })

  it('waits for unsaved changes to be saved', async () => {
    const dialog = await openQuote()
    fireEvent.change(within(dialog).getByLabelText('Notes for the customer'), { target: { value: 'Changed' } })
    expect((within(dialog).getByRole('button', { name: 'Send quote' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers no quote send on a paid quote, only its invoice', async () => {
    const dialog = await openQuote({ ...QUOTE, status: 'paid', quote: { ...QUOTE.quote, sends: [send(1, 1, 5)] } })
    expect(within(dialog).queryByRole('button', { name: /^Send (quote|again|revision)/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Send invoice' })).toBeTruthy()
  })
})

describe('a quote’s invoice (AGL-4099)', () => {
  const invoiceSend = (atMs: number, paid: boolean) => ({
    to: 'jordan@example.com',
    subject: 'Quote #1042',
    atMs,
    by: 'owner@example.com',
    messageId: `<invoice.${atMs}.a@acme.test>`,
    providerId: null,
    paid,
    linkVersion: paid ? null : 1,
    totalCents: 1_000,
  })

  beforeEach(() => {
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ sent: true, to: 'jordan@example.com', paid: true, linkVersion: null }) }))
  })

  afterEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
    }))
  })

  async function openQuote(quote: Record<string, unknown>, canSend = true) {
    mockQuotes = [quote]
    render(<HostQuotesCard hostId="site1" canEdit canSend={canSend} />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  it('sends a paid quote’s invoice as the record, in the quote’s conversation', async () => {
    const dialog = await openQuote({ ...QUOTE, status: 'paid' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }))
    const form = await screen.findByRole('dialog', { name: 'Send invoice: Invoice #1042' })
    await waitFor(() => expect((within(form).getByLabelText('Subject') as HTMLInputElement).value).toBe('Invoice #1042 from Acme Tents'))
    expect((within(form).getByLabelText(/^To/) as HTMLInputElement).value).toBe('jordan@example.com')
    expect(within(form).getByText(/shows the invoice as paid/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/commerce/order-invoice-send')
    expect(JSON.parse(String(init.body))).toMatchObject({ hostId: 'site1', orderId: 'q-1', to: 'jordan@example.com' })
  })

  it('offers an unpaid quote’s invoice beside Send quote, and says when one went out', async () => {
    const dialog = await openQuote({ ...QUOTE, invoiceSends: [invoiceSend(Date.UTC(2026, 9, 29, 15), false)] })
    expect(within(dialog).getByRole('button', { name: 'Send quote' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Send invoice' })).toBeTruthy()
    expect(within(dialog).getByText(/^Invoice sent Oct 29, 2026, .+ to jordan@example\.com\.$/)).toBeTruthy()
  })

  it('starts Send invoice addressed to where the last invoice went when the quote names no email', async () => {
    const dialog = await openQuote({
      ...QUOTE,
      quote: { ...QUOTE.quote, customer: { name: 'Jordan Lee', email: '' } },
      invoiceSends: [{ ...invoiceSend(5, false), to: 'billing@example.org' }],
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }))
    const form = await screen.findByRole('dialog', { name: 'Send invoice: Invoice #1042' })
    expect((within(form).getByLabelText(/^To/) as HTMLInputElement).value).toBe('billing@example.org')
  })

  it('holds Send invoice behind "Send quotes and invoices to customers"', async () => {
    const dialog = await openQuote({ ...QUOTE, status: 'paid' }, false)
    expect((within(dialog).getByRole('button', { name: 'Send invoice' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers none on a canceled quote', async () => {
    const dialog = await openQuote({ ...QUOTE, status: 'cancelled' })
    expect(within(dialog).queryByRole('button', { name: 'Send invoice' })).toBeNull()
  })
})

describe('a quote’s PDF (AGL-4095)', () => {
  const createObjectURL = jest.fn((_blob: Blob) => 'blob:quote')
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

  beforeEach(() => {
    createObjectURL.mockClear()
    click.mockClear()
    Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() })
    mockFetch.mockImplementation(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === 'content-disposition' ? 'attachment; filename="acme-quote-1042.pdf"' : null) },
      blob: async () => new Blob(['%PDF-']),
      json: async () => ({}),
    }))
  })

  afterEach(() => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
    }))
  })

  afterAll(() => click.mockRestore())

  it('asks the server for the saved quote’s PDF and saves it under the name it gives', async () => {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit canSend={false} />)
    fireEvent.click(screen.getByText('Quote #1042'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(url).toBe('/api/commerce/quote')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'pdf', hostId: 'site1', quoteId: 'q-1' })
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('acme-quote-1042.pdf')
  })

  it('holds it behind "Create and edit quotes"', async () => {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit={false} canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('a quote’s proofs and revisions (AGL-4096)', () => {
  const PROOF = { id: 'p1', revision: 1, name: 'Banner.pdf', contentType: 'application/pdf', size: 2_048, path: 'hosts/site1/private/uploads/quote-proof/q-1/p1', addedAtMs: 1, addedBy: 'a' }
  const storageFetch = jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: false, status: 0 }))
  const realFetch = globalThis.fetch

  beforeEach(() => {
    storageFetch.mockClear()
    Object.assign(globalThis, { fetch: storageFetch })
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:proof'), revokeObjectURL: jest.fn() })
  })

  afterEach(() => {
    Object.assign(globalThis, { fetch: realFetch })
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
    }))
  })

  async function openQuote(quote: Record<string, unknown>, canEdit = true) {
    mockQuotes = [{ ...QUOTE, quote: { ...QUOTE.quote, ...quote } }]
    render(<HostQuotesCard hostId="site1" canEdit={canEdit} canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  it('lists the current revision’s proofs and what the customer asked to change', async () => {
    const dialog = await openQuote({
      stage: 'changes_requested',
      proofs: [PROOF],
      responses: [{ action: 'changes', revision: 1, atMs: Date.UTC(2026, 9, 29), comment: 'Make the logo bigger', ip: '203.0.113.9', userAgent: 'UA' }],
    })
    expect(within(dialog).getByText('Proofs · Revision 1')).toBeTruthy()
    expect(within(dialog).getByText('Banner.pdf · 2 KB')).toBeTruthy()
    expect(within(dialog).getByText('Make the logo bigger')).toBeTruthy()
    expect(within(dialog).getAllByText('Changes requested').length).toBeGreaterThan(0)
    // Answered: the proof can no longer be taken off or added to.
    expect(within(dialog).queryByRole('button', { name: 'Remove Banner.pdf' })).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Add proof' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('holds Add proof, Remove and Start revision behind "Create and edit quotes"', async () => {
    const dialog = await openQuote({ proofs: [PROOF] }, false)
    for (const name of ['Add proof', 'Remove Banner.pdf', 'Start revision 2']) {
      expect((within(dialog).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends a proof straight to Storage through a ticket, then finalizes it', async () => {
    mockFetch.mockImplementation(async (...args: unknown[]) => {
      const body = JSON.parse(String((args[2] as RequestInit).body))
      if (body.action === 'proof-ticket') {
        return { ok: true, json: async () => ({ ticket: 'ticket-1', upload: { url: 'https://storage.example/b/', fields: { key: 'k', policy: 'p' } } }) }
      }
      return { ok: true, json: async () => ({ proof: { id: 'p2', name: 'Logo.png', contentType: 'image/png', size: 4 }, updatedAtMs: 7 }) }
    })
    const dialog = await openQuote({})
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'Logo.png', { type: 'image/png' })
    fireEvent.change(within(dialog).getByTestId('quote-proof-picker'), { target: { files: [file] } })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    const bodies = mockFetch.mock.calls.map((call) => JSON.parse(String((call[2] as RequestInit).body)))
    expect(bodies[0]).toEqual({ action: 'proof-ticket', hostId: 'site1', quoteId: 'q-1', file: { name: 'Logo.png', contentType: 'image/png', size: 4 } })
    expect(bodies[1]).toEqual({ action: 'proof-finalize', hostId: 'site1', quoteId: 'q-1', ticket: 'ticket-1' })
    expect(storageFetch).toHaveBeenCalledWith('https://storage.example/b/', expect.objectContaining({ method: 'POST', mode: 'no-cors' }))
    const form = storageFetch.mock.calls[0][1]?.body as FormData
    expect([...form.keys()]).toEqual(['key', 'policy', 'file'])
  })

  it('refuses a file it does not take before asking for anything', async () => {
    const dialog = await openQuote({})
    const file = new File(['<html>'], 'page.html', { type: 'text/html' })
    fireEvent.change(within(dialog).getByTestId('quote-proof-picker'), { target: { files: [file] } })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('starts the next revision only after saying what is kept', async () => {
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ revision: 2, updatedAtMs: 9 }) }))
    const dialog = await openQuote({ proofs: [PROOF] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start revision 2' }))
    const confirm = await screen.findByRole('dialog', { name: 'Start revision 2?' })
    expect(within(confirm).getByText(/Revision 1 is kept as it is now/)).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Start revision 2' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String((mockFetch.mock.calls[0][2] as RequestInit).body))).toEqual({ action: 'start-revision', hostId: 'site1', quoteId: 'q-1' })
  })

  it('lists earlier revisions, read-only, with their status and answers', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        revisions: [
          {
            revision: 1,
            stage: 'changes_requested',
            closedAtMs: Date.UTC(2026, 9, 29),
            proofs: [{ id: 'p1', name: 'First.pdf', contentType: 'application/pdf', size: 1_024 }],
            responses: [{ action: 'changes', revision: 1, atMs: Date.UTC(2026, 9, 28), comment: 'Too small' }],
          },
        ],
      }),
    }))
    const dialog = await openQuote({ revision: 2 })
    expect(await within(dialog).findByText('Revision 1')).toBeTruthy()
    expect(within(dialog).getByText('First.pdf · 1 KB')).toBeTruthy()
    expect(within(dialog).getByText('Too small')).toBeTruthy()
    expect(JSON.parse(String((mockFetch.mock.calls[0][2] as RequestInit).body))).toEqual({ action: 'revisions', hostId: 'site1', quoteId: 'q-1' })
    expect(within(dialog).queryByRole('button', { name: 'Remove First.pdf' })).toBeNull()
  })

  it('opens the quote a manager notice links to', async () => {
    window.history.replaceState(null, '', '/acme/hosts/shop/products/orders?quote=q-1')
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    window.history.replaceState(null, '', '/')
  })
})
