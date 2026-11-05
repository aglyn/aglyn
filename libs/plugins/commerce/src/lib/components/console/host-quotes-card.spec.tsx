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

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockFetch = jest.fn<Promise<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>, unknown[]>(
  async () => ({
    ok: true,
    json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
  }),
)
let mockQuotes: Array<Record<string, unknown>> = []
let mockStore: Record<string, unknown> = {}
/** The page's query string, as the router reads it (a manager notice's `?quote=`). */
let mockSearch = ''
/** Whether the workspace owner's payment account takes charges, as `useMerchantPayments` answers. */
const PAYMENTS_READY = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: '/acme/hosts/shop/products/payments' }
const PAYMENTS_MISSING = {
  state: 'not-connected',
  settled: true,
  ready: false,
  blocked: true,
  reason: 'Connect Stripe to take card payments.',
  href: '/acme/hosts/shop/products/payments',
}
let mockPayments: Record<string, unknown> = PAYMENTS_READY

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => '/acme/hosts/shop/products/orders',
}))

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
  firestoreDocPhase: (read: { data?: unknown; status: string }) =>
    read.data ? 'ready' : read.status === 'loading' ? 'loading' : 'missing',
  useMerchantPayments: (hostId: string | undefined) =>
    hostId ? mockPayments : { state: 'pending', settled: false, ready: false, blocked: false, reason: null, href: null },
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
  mockSearch = ''
  mockPayments = PAYMENTS_READY
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

  /*
   * The list says what the pay page will do (AGL-4162): `quotePayTax` against
   * the store as it stands now, the same answer the dialog's notice reads.
   */
  describe('its "plus tax at payment" label', () => {
    const LABEL = 'plus tax at payment'
    const UNDECIDED = { kind: 'none', reason: 'undecided' }
    const OWN_RATES = { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 10 }] }

    function listed(
      tax: Record<string, unknown>,
      store: Record<string, unknown> | undefined,
      order: Record<string, unknown> = {},
    ) {
      mockStore = store as Record<string, unknown>
      mockQuotes = [{ ...QUOTE, ...order, quote: { ...QUOTE.quote, tax } }]
      render(<HostQuotesCard hostId="site1" canEdit canSend />)
      expect(screen.getByText('Quote #1042')).toBeTruthy()
    }

    it('shows for a quote saved at payment, whatever the store has chosen since', () => {
      listed({ kind: 'at-payment' }, { tax: { mode: 'none' } })
      expect(screen.getByText(LABEL)).toBeTruthy()
    })

    it('shows for a quote saved before the store chose, once it is on Stripe Tax', () => {
      listed(UNDECIDED, { tax: { mode: 'stripe' } })
      expect(screen.getByText(LABEL)).toBeTruthy()
    })

    it('stays off for a quote saved before the store chose “Don’t collect sales tax”', () => {
      listed(UNDECIDED, { tax: { mode: 'none' } })
      expect(screen.queryByText(LABEL)).toBeNull()
    })

    it('stays off for a quote saved before the store chose its own rates, which only a save prices', () => {
      listed(UNDECIDED, { tax: OWN_RATES })
      expect(screen.queryByText(LABEL)).toBeNull()
    })

    it('stays off for a quote saved at the store’s own rate', () => {
      listed({ kind: 'rate', pct: 10, label: 'Texas sales tax' }, { tax: { mode: 'stripe' } })
      expect(screen.queryByText(LABEL)).toBeNull()
    })

    it('stays off while the store has not chosen', () => {
      listed(UNDECIDED, {})
      expect(screen.queryByText(LABEL)).toBeNull()
    })

    it('goes by the saved basis until the store’s settings answer', () => {
      listed(UNDECIDED, undefined)
      expect(screen.queryByText(LABEL)).toBeNull()
      cleanup()
      listed({ kind: 'at-payment' }, undefined)
      expect(screen.getByText(LABEL)).toBeTruthy()
    })

    it('stays off once a quote is paid, however it was saved', () => {
      listed({ kind: 'at-payment' }, { tax: { mode: 'stripe' } }, { status: 'paid' })
      expect(screen.queryByText(LABEL)).toBeNull()
    })

    it('stays off for a paid quote saved before the store chose, on Stripe Tax', () => {
      listed(UNDECIDED, { tax: { mode: 'stripe' } }, { status: 'paid' })
      expect(screen.queryByText(LABEL)).toBeNull()
    })
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

/*
 * The open quote's totals (AGL-4162). Left as saved, it says what the customer
 * is charged: the customer's page, `quotePayTax` over the stored lines, or a
 * paid quote's recorded totals. Once anything is changed, it says what a save
 * will store, because every save re-prices the lines and re-bases the tax.
 */
describe('the totals in a quote’s dialog', () => {
  const UNDECIDED = { kind: 'none', reason: 'undecided' }
  const RATE = { kind: 'rate', pct: 10, label: 'Texas sales tax' }
  const OWN_RATES = { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 10 }] }
  const AT_TEN_PERCENT = { itemsCents: 30_000, discountCents: 0, shippingCents: 0, taxCents: 3_000, feeCents: 0, totalCents: 33_000 }

  async function open(tax: Record<string, unknown>, store: Record<string, unknown> | undefined, order: Record<string, unknown> = {}) {
    mockStore = store as Record<string, unknown>
    mockQuotes = [{ ...QUOTE, ...order, quote: { ...QUOTE.quote, tax } }]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  /** The summary's text, every row: `Items$300.00Tax (10%)$30.00Total$330.00`. */
  const summary = (dialog: HTMLElement) => within(dialog).getByText(/^Total/).parentElement?.parentElement?.textContent

  const editNotes = (dialog: HTMLElement) =>
    fireEvent.change(within(dialog).getByLabelText('Notes for the customer'), { target: { value: 'Thanks' } })

  describe('left as saved', () => {
    it('adds tax at payment for a quote saved at payment, on a store that no longer collects', async () => {
      expect(summary(await open({ kind: 'at-payment' }, { tax: { mode: 'none' } }))).toBe(
        'Items$300.00Tax is added at paymentTotal before tax$300.00',
      )
    })

    it('charges the saved rate for a quote saved at a rate, on a store now on Stripe Tax', async () => {
      expect(summary(await open(RATE, { tax: { mode: 'stripe' } }, { totals: AT_TEN_PERCENT }))).toBe(
        'Items$300.00Texas sales tax (10%)$30.00Total$330.00',
      )
    })

    it('adds tax at payment for an undecided quote, once the store is on Stripe Tax', async () => {
      expect(summary(await open(UNDECIDED, { tax: { mode: 'stripe' } }))).toBe(
        'Items$300.00Tax is added at paymentTotal before tax$300.00',
      )
    })

    it('adds no tax for an undecided quote, once the store does not collect', async () => {
      expect(summary(await open(UNDECIDED, { tax: { mode: 'none' } }))).toBe('Items$300.00No sales tax$0.00Total$300.00')
    })

    it('keeps the saved basis and the save-again notice where only a save prices the store’s own rates', async () => {
      const dialog = await open(UNDECIDED, { tax: OWN_RATES })
      expect(summary(dialog)).toBe('Items$300.00Sales tax is not set up$0.00Total$300.00')
      expect(within(dialog).getByText('Save this quote again to apply the store’s sales tax setting.')).toBeTruthy()
    })

    it('keeps a tax service’s saved answer, whatever the store has chosen since', async () => {
      const service = { kind: 'service', taxCents: 1_234, providerLabel: 'Tax Co' }
      expect(summary(await open(service, { tax: { mode: 'stripe' } }))).toBe('Items$300.00Tax (Tax Co)$12.34Total$312.34')
    })

    it('goes by the saved basis until the store’s settings answer', async () => {
      expect(summary(await open(RATE, undefined))).toBe('Items$300.00Texas sales tax (10%)$30.00Total$330.00')
    })

    it('prices the lines the customer is charged, not the catalog’s price today', async () => {
      const lineItems = [{ productId: 'canopy', variantId: 'red', name: 'Canopy 10x10', quantity: 1, unitAmountCents: 100_000, productType: 'physical' }]
      const dialog = await open(RATE, { tax: OWN_RATES }, { lineItems })
      expect(summary(dialog)).toBe('Items$1000.00Texas sales tax (10%)$100.00Total$1100.00')
      editNotes(dialog)
      expect(summary(dialog)).toBe('Items$1200.00Tax (10%)$120.00Total$1320.00')
    })
  })

  describe('once something is changed, what the save will store', () => {
    it('takes a quote saved at payment to no tax, on a store that no longer collects', async () => {
      const dialog = await open({ kind: 'at-payment' }, { tax: { mode: 'none' } })
      editNotes(dialog)
      expect(summary(dialog)).toBe('Items$300.00No sales tax$0.00Total$300.00')
    })

    it('takes a quote saved at a rate to tax at payment, on a store now on Stripe Tax', async () => {
      const dialog = await open(RATE, { tax: { mode: 'stripe' } }, { totals: AT_TEN_PERCENT })
      editNotes(dialog)
      expect(summary(dialog)).toBe('Items$300.00Tax is added at paymentTotal before tax$300.00')
    })

    it('takes an undecided quote to the store’s own rate', async () => {
      const dialog = await open(UNDECIDED, { tax: OWN_RATES })
      editNotes(dialog)
      expect(summary(dialog)).toBe('Items$300.00Tax (10%)$30.00Total$330.00')
    })

    it('drops a tax service’s saved answer, which the save asks for again', async () => {
      const dialog = await open({ kind: 'service', taxCents: 1_234, providerLabel: 'Tax Co' }, { tax: OWN_RATES })
      editNotes(dialog)
      expect(summary(dialog)).toBe('Items$300.00Tax (10%)$30.00Total$330.00')
    })
  })

  it('shows a new quote what the save will store', async () => {
    mockStore = { tax: { mode: 'none' } }
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    expect(summary(await screen.findByRole('dialog'))).toBe('Items$0.00No sales tax$0.00Total$0.00')
  })

  describe('once paid, what was recorded', () => {
    const PAID = { itemsCents: 30_000, discountCents: 0, shippingCents: 0, taxCents: 2_500, feeCents: 0, totalCents: 32_500 }

    it('states Stripe Tax’s figure, with nothing left to add at payment', async () => {
      expect(summary(await open({ kind: 'at-payment' }, { tax: { mode: 'stripe' } }, { status: 'paid', totals: PAID }))).toBe(
        'Items$300.00Tax$25.00Total$325.00',
      )
    })

    it('keeps the rate it was paid at, whatever the store has chosen since', async () => {
      expect(summary(await open(RATE, { tax: OWN_RATES }, { status: 'paid', totals: PAID }))).toBe(
        'Items$300.00Texas sales tax (10%)$25.00Total$325.00',
      )
    })
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
    mockSearch = '?quote=q-1'
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('opens it when the notice is followed with the Orders page already open, and only once', async () => {
    mockQuotes = [QUOTE]
    const view = render(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The bell pushes `?quote=` onto the page that is already showing.
    mockSearch = '?quote=q-1'
    view.rerender(<HostQuotesCard hostId="site1" canEdit canSend />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The same address read again (any re-render) does not reopen it.
    view.rerender(<HostQuotesCard hostId="site1" canEdit canSend />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/*
 * "Customers can't pay this quote online yet" (AGL-4162): what the customer's
 * Pay waits on, with a button to each fix, in the editor, its pay link, the
 * Send quote form and the Send invoice form. Shown only once both answers
 * are in, and sending stays open.
 */
describe('telling the business what customers’ Pay waits on (AGL-4162)', () => {
  const UNDECIDED = { ...QUOTE, quote: { ...QUOTE.quote, tax: { kind: 'none', reason: 'undecided' } } }

  async function openQuote(quote: Record<string, unknown> = QUOTE) {
    mockQuotes = [quote]
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByText('Quote #1042'))
    return screen.findByRole('dialog')
  }

  it('names a missing payment account and an undecided sales tax, each with its own fix, in a new quote', async () => {
    mockPayments = PAYMENTS_MISSING
    mockStore = {}
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    const notice = within(dialog).getByRole('alert')
    expect(within(notice).getByText('Customers can’t pay this quote online yet.')).toBeTruthy()
    expect(within(notice).getByText('Connect Stripe to take card payments.')).toBeTruthy()
    expect(within(notice).getByRole('button', { name: 'Open Payments' }).getAttribute('href')).toBe('/acme/hosts/shop/products/payments')
    expect(within(notice).getByText('Choose how this store handles sales tax.')).toBeTruthy()
    expect(within(notice).getByRole('button', { name: 'Open Taxes' }).getAttribute('href')).toBe('/acme/hosts/shop/products/taxes')
    // The tax-only notice it replaces is gone.
    expect(within(dialog).queryByText(/so this quote shows no tax/)).toBeNull()
  })

  it('says nothing while the payment account is still being read', async () => {
    mockPayments = { state: 'pending', settled: false, ready: false, blocked: false, reason: null, href: null }
    mockStore = {}
    render(<HostQuotesCard hostId="site1" canEdit canSend />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Customers can’t pay this quote online yet.')).toBeNull()
  })

  it('says nothing for a quote customers can pay', async () => {
    const dialog = await openQuote()
    expect(within(dialog).queryByText('Customers can’t pay this quote online yet.')).toBeNull()
  })

  it('shows a saved quote’s notice once, with its pay link, which can still be copied', async () => {
    mockPayments = PAYMENTS_MISSING
    const dialog = await openQuote()
    expect(within(dialog).getAllByText('Customers can’t pay this quote online yet.')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: 'Open Payments' })).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Copy pay link' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('names no tax step for a quote saved before the store chose “Don’t collect sales tax”', async () => {
    mockStore = { tax: { mode: 'none' } }
    const dialog = await openQuote(UNDECIDED)
    expect(within(dialog).queryByText('Customers can’t pay this quote online yet.')).toBeNull()
  })

  it('asks for a save where only a save prices the store’s own rates', async () => {
    const dialog = await openQuote(UNDECIDED)
    expect(within(dialog).getByText('Customers can’t pay this quote online yet.')).toBeTruthy()
    expect(within(dialog).getByText('Save this quote again to apply the store’s sales tax setting.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Open Taxes' })).toBeNull()
  })

  it('says it in the Send quote form, and sends all the same', async () => {
    mockPayments = PAYMENTS_MISSING
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ sent: true, to: 'jordan@example.com', atMs: 5, revision: 1, linkVersion: 1, linkReplaced: false }),
    }))
    const dialog = await openQuote()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send quote' }))
    const form = await screen.findByRole('dialog', { name: 'Send quote: Quote #1042' })
    expect(within(form).getByText('Customers can’t pay this quote online yet.')).toBeTruthy()
    expect(within(form).getByRole('button', { name: 'Open Payments' })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect((mockFetch.mock.calls[0] as [unknown, string])[1]).toBe('/api/commerce/quote')
  })

  it('says it in the Send invoice form as “this invoice”, and sends all the same', async () => {
    mockPayments = PAYMENTS_MISSING
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ sent: true, to: 'jordan@example.com', paid: false, linkVersion: 1 }) }))
    const dialog = await openQuote()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }))
    const form = await screen.findByRole('dialog', { name: 'Send invoice: Invoice #1042' })
    expect(within(form).getByText('Customers can’t pay this invoice online yet.')).toBeTruthy()
    expect(within(form).getByText('Connect Stripe to take card payments.')).toBeTruthy()
    const send = within(form).getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect((mockFetch.mock.calls[0] as [unknown, string])[1]).toBe('/api/commerce/order-invoice-send')
  })

  it('sends an invoice for a quote saved before the store chose, once it has', async () => {
    mockStore = { tax: { mode: 'none' } }
    const dialog = await openQuote(UNDECIDED)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }))
    const form = await screen.findByRole('dialog', { name: 'Send invoice: Invoice #1042' })
    expect(within(form).queryByText(/Sales tax isn’t set up/)).toBeNull()
    expect((within(form).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('names the tax step once in the Send invoice form, where it holds the send', async () => {
    mockStore = {}
    const dialog = await openQuote(UNDECIDED)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invoice' }))
    const form = await screen.findByRole('dialog', { name: 'Send invoice: Invoice #1042' })
    expect(within(form).getByText('Choose how this store handles sales tax.')).toBeTruthy()
    expect(within(form).queryByText(/Sales tax isn’t set up/)).toBeNull()
    expect((within(form).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(form).getByLabelText(/Sales tax isn’t set up for this store yet/)).toBeTruthy()
  })
})
