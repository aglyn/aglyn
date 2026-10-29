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
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockFetch = jest.fn(async (..._args: unknown[]) => ({
  ok: true,
  json: async () => ({ quoteId: 'q-new', number: 1043, updatedAtMs: 5 }),
}))
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
    render(<HostQuotesCard hostId="site1" canEdit />)
    expect(screen.getByText('Quote #1042')).toBeTruthy()
    expect(screen.getByText('Jordan Lee')).toBeTruthy()
    expect(screen.getByText('$300.00')).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('plus tax at payment')).toBeTruthy()
  })

  it('invites the first quote when there are none', () => {
    render(<HostQuotesCard hostId="site1" canEdit />)
    expect(screen.getByText(/No quotes yet/)).toBeTruthy()
  })

  it('holds New quote, and Save, behind "Create and edit quotes"', () => {
    mockQuotes = [QUOTE]
    render(<HostQuotesCard hostId="site1" canEdit={false} />)
    const button = screen.getByRole('button', { name: 'New quote' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByLabelText('Your role does not include "Create and edit quotes" — ask an organization admin')).toBeTruthy()
  })

  it('works the totals out as lines are added, and sends the choices to the server', async () => {
    render(<HostQuotesCard hostId="site1" canEdit />)
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
    render(<HostQuotesCard hostId="site1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    const toggle = within(dialog).getByLabelText('Customers approve the proof before they can pay') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('says when tax is added at payment, under Stripe Tax', async () => {
    mockStore = { tax: { mode: 'stripe' } }
    render(<HostQuotesCard hostId="site1" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: 'New quote' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tax is added at payment')).toBeTruthy()
    expect(within(dialog).getByText('Total before tax')).toBeTruthy()
  })
})
