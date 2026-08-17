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
 * AGL-1806: the order dialog answers the restock question AGL-1797 asks.
 *
 * `flagOrderRestock` writes `restockCheck` on a reversal and nothing ever
 * wrote `resolution`, so the prompt never cleared. The dialog now renders the
 * open question with two answers — and, per AGL-1797's ledger argument, the
 * answers MOVE NO STOCK: "Restocked" is clicked after the merchant used the
 * products hub's "Adjust stock" (the one stock writer), "No restock" says the
 * goods are not recoverable. Every case below therefore asserts not just what
 * was written but what was NOT: no product write, no `inventoryAdjustments`
 * row, no client `updateDoc` outside the transaction.
 *
 * The answer lands through a TRANSACTION keyed on the rendered
 * `flaggedAtMs`, because the flag writer re-asks an ANSWERED question after
 * the next reversal — so a stale dialog's answer, written blind, would either
 * double-answer or replace a brand-new question with a resolved copy of the
 * old one. The transaction re-reads on the server (it cannot run offline,
 * which is the `writeGuardedBySeed` refusal of cached data by other means)
 * and refuses both cases.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrderDetailDialog from './order-detail-dialog.component'
import { runTransaction, updateDoc } from 'firebase/firestore'

jest.mock('firebase/firestore', () => ({
  // Refs carry their path so a test can tell the order write from a stock
  // write it must NOT see.
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  updateDoc: jest.fn(async () => undefined),
  runTransaction: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({
    data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok') },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return {
    useSnackbar: () => ({ enqueueSnackbar }),
    __snackbar: enqueueSnackbar,
  }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const confirm = jest.fn(async () => undefined)
  return { useConfirmationContext: () => ({ confirm }), __confirm: confirm }
})

const clientWrite = updateDoc as jest.Mock
const transactionRunner = runTransaction as jest.Mock
const snackbar = (
  jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock }
).__snackbar

const FLAGGED_AT = Date.UTC(2026, 7, 12, 10, 0)

/** The check `flagOrderRestock` writes for a fully refunded two-line order. */
const openCheck = {
  kind: 'refund',
  lines: [
    { productId: 'p1', variantId: 'v1', quantity: 3, name: 'Ceramic mug' },
    {
      productId: 'p2',
      variantId: 'v2',
      quantity: 2,
      name: 'Tea towel',
      variantLabel: 'Blue',
    },
  ],
  units: 5,
  fullyReversed: true,
  flaggedAtMs: FLAGGED_AT,
}

const refundedOrder = {
  $id: 'order-abc',
  number: 1042,
  status: 'refunded',
  customerEmail: 'buyer@example.com',
  refundedCents: 6200,
  lineItems: [
    { productId: 'p1', name: 'Ceramic mug', quantity: 3, unitAmountCents: 1100 },
    { productId: 'p2', name: 'Tea towel', quantity: 2, unitAmountCents: 1450 },
  ],
  timeline: [
    { event: 'paid', atMs: Date.UTC(2026, 7, 10, 12, 0) },
    {
      event: 'restock-check',
      atMs: FLAGGED_AT,
      detail: '5 units may need restocking',
    },
  ],
  restockCheck: openCheck,
}

const show = (order: Record<string, unknown> = refundedOrder) =>
  render(
    <OrderDetailDialog
      hostId="host-1"
      order={order as never}
      onClose={jest.fn()}
    />,
  )

const transactionUpdate = jest.fn()

/**
 * Backs the mocked transaction with a "server" document, so a case can hand
 * the dialog one order and the transaction a fresher one — the stale-dialog
 * cases are exactly that difference.
 */
const serveOrder = (data: Record<string, unknown> | null) => {
  transactionRunner.mockImplementation(
    async (_db: unknown, updater: (transaction: unknown) => Promise<unknown>) =>
      updater({
        get: async (reference: { path: string }) => ({
          exists: () => data != null,
          data: () => data,
          path: reference.path,
        }),
        update: transactionUpdate,
      }),
  )
}

const restockedButton = () => screen.getByRole('button', { name: 'Restocked' })
const noRestockButton = () => screen.getByRole('button', { name: 'No restock' })

beforeEach(() => {
  jest.clearAllMocks()
  serveOrder(refundedOrder)
})

describe('the restock prompt renders while the question is open (AGL-1806)', () => {
  it('shows the units, every flagged line, and both answers', () => {
    show()
    // "after this refund" is prompt-only copy: the flag's own timeline entry
    // (rendered by the same dialog) also says "may need restocking".
    expect(screen.getByText(/5 units may need restocking after this refund/)).toBeTruthy()
    // The prompt lists the flagged lines itself — a second "3× Ceramic mug"
    // beside the line-items section's own.
    expect(screen.getAllByText(/3× Ceramic mug/).length).toBe(2)
    expect(screen.getByText(/2× Tea towel — Blue/)).toBeTruthy()
    expect(restockedButton()).toBeTruthy()
    expect(noRestockButton()).toBeTruthy()
    // The contract with AGL-1797's ledger decision, said to the merchant:
    // stock moves only through the products hub's "Adjust stock".
    expect(screen.getByText(/move no stock/)).toBeTruthy()
    expect(screen.getByText(/Adjust stock/)).toBeTruthy()
  })

  it('says a partial reversal makes the units an upper bound', () => {
    show({
      ...refundedOrder,
      status: 'paid',
      restockCheck: { ...openCheck, fullyReversed: false },
    })
    expect(screen.getByText(/upper bound/)).toBeTruthy()
  })

  it('keeps the chargeback default-NO wording', () => {
    show({
      ...refundedOrder,
      restockCheck: { ...openCheck, kind: 'chargeback' },
    })
    expect(
      screen.getByText(/shopper kept the goods unless they actually came back/),
    ).toBeTruthy()
  })

  it('renders no prompt without a check, and none once it is answered', () => {
    const { unmount } = show({ ...refundedOrder, restockCheck: undefined })
    expect(screen.queryByRole('button', { name: 'Restocked' })).toBeNull()
    // Prompt-only copy — the timeline's own "may need restocking" entry
    // rightly stays either way.
    expect(screen.queryByText(/may need restocking after this refund/)).toBeNull()
    unmount()
    show({
      ...refundedOrder,
      restockCheck: {
        ...openCheck,
        resolution: 'restocked',
        resolvedAtMs: FLAGGED_AT + 1000,
        resolvedBy: 'uid-earlier',
      },
    })
    expect(screen.queryByRole('button', { name: 'Restocked' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No restock' })).toBeNull()
  })
})

describe('answering the restock question (AGL-1806)', () => {
  it('records "restocked" on the order and NOTHING else — no stock write, no ledger row', async () => {
    show()
    fireEvent.click(restockedButton())
    await waitFor(() => expect(transactionRunner).toHaveBeenCalledTimes(1))
    // Exactly one write, and it is the ORDER document — the ledger argument
    // (AGL-1797) is that "Adjust stock" is the only stock writer, so a write
    // to products/ or inventoryAdjustments/ here is the defect.
    expect(transactionUpdate).toHaveBeenCalledTimes(1)
    const [reference, patch] = transactionUpdate.mock.calls[0]
    expect(reference.path).toBe('hosts/host-1/orders/order-abc')
    // The answer triple `OrderRestockCheck` declares, on the whole map — the
    // question's own lines survive alongside it.
    expect(patch.restockCheck).toEqual({
      ...openCheck,
      resolution: 'restocked',
      resolvedAtMs: expect.any(Number),
      resolvedBy: 'uid-admin',
    })
    // The timeline says what happened, appended after the existing events.
    const appended = patch.timeline[patch.timeline.length - 1]
    expect(patch.timeline.length).toBe(refundedOrder.timeline.length + 1)
    expect(appended.event).toBe('restock-check')
    expect(appended.detail).toContain('restocked')
    // No client write outside the transaction.
    expect(clientWrite).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Recorded as restocked',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('records "no restock" as dismissed', async () => {
    show()
    fireEvent.click(noRestockButton())
    await waitFor(() => expect(transactionUpdate).toHaveBeenCalledTimes(1))
    const [, patch] = transactionUpdate.mock.calls[0]
    expect(patch.restockCheck.resolution).toBe('dismissed')
    const appended = patch.timeline[patch.timeline.length - 1]
    expect(appended.detail).toContain('no restock')
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Recorded — no restock',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('appends the timeline the SERVER holds, not the one the dialog rendered', async () => {
    // A note lands from another tab between render and click. Appending to
    // the dialog's stale array would erase it; the transaction re-reads.
    serveOrder({
      ...refundedOrder,
      timeline: [
        ...refundedOrder.timeline,
        { event: 'note', atMs: FLAGGED_AT + 500, detail: 'concurrent note' },
      ],
    })
    show()
    fireEvent.click(restockedButton())
    await waitFor(() => expect(transactionUpdate).toHaveBeenCalledTimes(1))
    const [, patch] = transactionUpdate.mock.calls[0]
    expect(
      patch.timeline.some(
        (event: { detail?: string }) => event.detail === 'concurrent note',
      ),
    ).toBe(true)
  })

  it('refuses to answer twice: a question already answered on the server writes nothing', async () => {
    // 932559b60's cancel route answers an open check itself; a dialog held
    // open across that (or across another admin's click) must not re-answer.
    serveOrder({
      ...refundedOrder,
      restockCheck: {
        ...openCheck,
        resolution: 'restocked',
        resolvedAtMs: FLAGGED_AT + 1000,
        resolvedBy: 'uid-other',
      },
    })
    show()
    fireEvent.click(restockedButton())
    await waitFor(() => expect(transactionRunner).toHaveBeenCalledTimes(1))
    expect(transactionUpdate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        expect.stringContaining('already answered'),
        expect.objectContaining({ variant: 'info' }),
      ),
    )
    const [message] = snackbar.mock.calls[0]
    expect(message).toContain('nothing changed')
  })

  it('refuses a stale dialog whose question was answered and RE-FLAGGED since', async () => {
    // The writer's guard re-asks an answered question after the next
    // reversal. This dialog still shows the OLD question; a blind write here
    // would replace the new one with a resolved copy of the old.
    serveOrder({
      ...refundedOrder,
      restockCheck: {
        ...openCheck,
        units: 2,
        lines: [openCheck.lines[1]],
        flaggedAtMs: FLAGGED_AT + 60_000,
      },
    })
    show()
    fireEvent.click(restockedButton())
    await waitFor(() => expect(transactionRunner).toHaveBeenCalledTimes(1))
    expect(transactionUpdate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        expect.stringContaining('changed while this dialog was open'),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    const [message] = snackbar.mock.calls[0]
    expect(message).toContain('Reopen the order')
  })

  it('reports a failed transaction as NOT recorded, and re-arms the buttons', async () => {
    // The web SDK refuses to run a transaction offline — the cached-data
    // refusal `writeGuardedBySeed` makes on the products hub, by other means.
    transactionRunner.mockRejectedValue(new Error('offline'))
    show()
    fireEvent.click(restockedButton())
    await waitFor(() => expect(snackbar).toHaveBeenCalledTimes(1))
    const [message, options] = snackbar.mock.calls[0]
    expect(message).toContain('not recorded')
    expect(message).toContain('Nothing changed')
    expect(options).toEqual(expect.objectContaining({ variant: 'error' }))
    expect(snackbar).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variant: 'success' }),
    )
    await waitFor(() =>
      expect((restockedButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('disables both answers while one is in flight', async () => {
    let release: (value: unknown) => void = () => undefined
    transactionRunner.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    show()
    fireEvent.click(restockedButton())
    await waitFor(() =>
      expect((restockedButton() as HTMLButtonElement).disabled).toBe(true),
    )
    expect((noRestockButton() as HTMLButtonElement).disabled).toBe(true)
    release('recorded')
    await waitFor(() =>
      expect((restockedButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })
})
