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
 * The paid-sale receipt panel (AGL-3607, AGL-3608): a text receipt is offered
 * only when the store can send one, and every answer the customer display
 * gives — email, text, print or none — reaches the register's `receipt`
 * action, which is what sends it and ends the customer's turn on the screen.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockTender = jest.fn(async (..._args: unknown[]) => ({}))
jest.mock('./pos-api', () => {
  const actual = jest.requireActual('./pos-api')
  return { ...actual, posTender: (...args: unknown[]) => mockTender(...args) }
})

// The thermal receipt (AGL-3609) is the operations module's; here it is the
// call that prints it, and whether the register has a cloud printer.
const mockPrint = jest.fn((_gift?: boolean) => true)
let mockHasPrinter = false
jest.mock('../pos-ops/register-ops', () => ({
  usePosSaleReceipt: () => ({ order: { status: 'paid' }, print: (gift?: boolean) => mockPrint(gift) }),
  usePosRegisterHasPrinter: () => mockHasPrinter,
}))

import { PosReceiptPanel, type PosReceiptPanelProps } from './pos-receipt-panel.component'
import type { PosDisplayControl } from './use-pos-display'

const SALE = {
  orderId: 'sale-1',
  status: 'paid',
  totalCents: 1200,
  paidCents: 1200,
  dueCents: 0,
  tenderableCents: 0,
  tipCents: 0,
  payments: [],
} as unknown as PosReceiptPanelProps['sale']

function context(receiptDefault: string, smsReceipts: boolean) {
  return {
    settings: { receiptDefault, displayMarketingOptIn: false, tipPercentages: [15, 20, 25] },
    terminal: { available: false, testMode: true },
    readers: [],
    publishableKey: '',
    smsReceipts,
  } as unknown as PosReceiptPanelProps['context']
}

function display(answer: Record<string, unknown> | null): PosDisplayControl {
  return {
    connected: true,
    asking: null,
    show: jest.fn(async () => undefined),
    ask: jest.fn(async () => answer as never),
    cancelAsk: jest.fn(),
    pairingCode: jest.fn(),
  }
}

function renderPanel(overrides: Partial<PosReceiptPanelProps>) {
  const props: PosReceiptPanelProps = {
    user: {} as never,
    hostId: 'host-1',
    sale: SALE,
    context: context('manual', false),
    display: display(null),
    onNewSale: jest.fn(),
    notify: jest.fn(),
    ...overrides,
  }
  render(<PosReceiptPanel {...props} />)
  return props
}

beforeEach(() => {
  mockTender.mockClear()
  mockPrint.mockClear()
  mockHasPrinter = false
})

describe('text receipts', () => {
  it('are not offered when the store cannot send a text', () => {
    renderPanel({ context: context('manual', false) })
    expect(screen.queryByLabelText('Text receipt to')).toBeNull()
  })

  it('are sent from the register to the number the cashier types', async () => {
    renderPanel({ context: context('manual', true) })
    fireEvent.change(screen.getByLabelText('Text receipt to'), { target: { value: '555 010 0199' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    })
    expect(mockTender).toHaveBeenCalledWith({}, 'host-1', 'sale-1', 'receipt', {
      channel: 'sms',
      to: '555 010 0199',
    })
  })

  it('offers text on the display only when the store can send one, and sends the answer', async () => {
    const screenControl = display({ promptId: 'p', receiptChannel: 'sms', phone: '+15550100199', atMs: 1 })
    renderPanel({ context: context('ask', true), display: screenControl })
    await waitFor(() => expect(mockTender).toHaveBeenCalled())
    expect((screenControl.ask as jest.Mock).mock.calls[0][0].receipt.channels).toEqual([
      'email',
      'sms',
      'print',
      'none',
    ])
    expect(mockTender).toHaveBeenCalledWith({}, 'host-1', 'sale-1', 'receipt', {
      channel: 'sms',
      to: '+15550100199',
    })
  })
})

describe('the customer display answer', () => {
  it.each([
    [{ receiptChannel: 'none' }, { channel: 'none' }],
    [{ receiptChannel: 'email', email: 'ann@example.com', marketingOptIn: true }, { channel: 'email', to: 'ann@example.com', marketingOptIn: true }],
  ])('reaches the receipt action: %j', async (answer, sent) => {
    renderPanel({ context: context('ask', false), display: display({ promptId: 'p', atMs: 1, ...answer }) })
    await waitFor(() => expect(mockTender).toHaveBeenCalledWith({}, 'host-1', 'sale-1', 'receipt', sent))
  })

  it('prints the thermal receipt for a print choice, and records it so the display says thank you', async () => {
    renderPanel({ context: context('ask', false), display: display({ promptId: 'p', atMs: 1, receiptChannel: 'print' }) })
    await waitFor(() =>
      expect(mockTender).toHaveBeenCalledWith({}, 'host-1', 'sale-1', 'receipt', { channel: 'print' }),
    )
    expect(mockPrint).toHaveBeenCalledWith(undefined)
  })

  it('leaves the printing to the register\'s cloud printer when it has one', async () => {
    mockHasPrinter = true
    renderPanel({ context: context('print', false) })
    await waitFor(() =>
      expect(mockTender).toHaveBeenCalledWith({}, 'host-1', 'sale-1', 'receipt', { channel: 'print' }),
    )
    expect(mockPrint).not.toHaveBeenCalled()
  })

  it('prints a gift receipt on the cashier\'s tap', () => {
    renderPanel({})
    fireEvent.click(screen.getByRole('button', { name: 'Gift receipt' }))
    expect(mockPrint).toHaveBeenCalledWith(true)
  })

  it('sends the display to its thank-you when the prompt goes unanswered', async () => {
    const screenControl = display(null)
    renderPanel({ context: context('ask', false), display: screenControl })
    await waitFor(() => expect(screenControl.show).toHaveBeenCalledWith({ mode: 'thanks' }))
    expect(mockTender).not.toHaveBeenCalled()
  })

  it('does not offer text on the display when the store cannot send one', async () => {
    const screenControl = display(null)
    renderPanel({ context: context('ask', false), display: screenControl })
    await waitFor(() => expect(screenControl.ask).toHaveBeenCalled())
    expect((screenControl.ask as jest.Mock).mock.calls[0][0].receipt.channels).not.toContain('sms')
  })
})
