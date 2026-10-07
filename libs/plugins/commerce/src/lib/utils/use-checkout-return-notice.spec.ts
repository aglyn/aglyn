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
 * The return-page notice (AGL-3606). A redirect-based method that fails comes
 * back to the same `?order=success&session_id=…` a paid order does; this pins
 * that the page tells those two apart, says nothing on a paid order, and asks
 * once per document however many blocks mount it.
 */

import { renderHook, waitFor } from '@testing-library/react'
import {
  __resetCheckoutReturnNotice,
  checkoutReturnNoticeFor,
  useCheckoutReturnNotice,
} from './use-checkout-return-notice'

const respond = (body: unknown, ok = true) =>
  jest.fn(async () => ({ ok, json: async () => body }) as any)

function visit(search: string) {
  window.history.replaceState(null, '', `/shop${search}`)
}

beforeEach(() => {
  __resetCheckoutReturnNotice()
  visit('')
})

describe('checkoutReturnNoticeFor', () => {
  it('an OPEN session after a return means the payment did not complete', () => {
    expect(checkoutReturnNoticeFor('open', 'unpaid')).toMatchObject({
      severity: 'warning',
      message: expect.stringContaining('nothing was charged'),
    })
  })

  it('an expired session says nothing was charged', () => {
    expect(checkoutReturnNoticeFor('expired', 'unpaid')?.message).toContain(
      'nothing was charged',
    )
  })

  it('a paid session says nothing at all', () => {
    expect(checkoutReturnNoticeFor('complete', 'paid')).toBeNull()
    expect(checkoutReturnNoticeFor('complete', 'no_payment_required')).toBeNull()
  })

  it('a complete-but-unpaid session is processing, not failed', () => {
    expect(checkoutReturnNoticeFor('complete', 'unpaid')).toMatchObject({
      severity: 'info',
    })
  })
})

describe('useCheckoutReturnNotice', () => {
  it('does not ask on an ordinary page view', async () => {
    const siteFetch = respond({ status: 'open' })
    renderHook(() => useCheckoutReturnNotice('host-1', siteFetch))
    expect(siteFetch).not.toHaveBeenCalled()
  })

  it('asks about the returned session and shows the failure', async () => {
    visit('?order=success&session_id=cs_test_abcdefgh123')
    const siteFetch = respond({ status: 'open', paymentStatus: 'unpaid' })
    const { result } = renderHook(() =>
      useCheckoutReturnNotice('host-1', siteFetch),
    )
    await waitFor(() => expect(result.current[0]?.severity).toBe('warning'))
    expect((siteFetch.mock.calls[0] as any[])[0]).toBe(
      '/api/commerce/checkout-status?hostId=host-1&sessionId=cs_test_abcdefgh123',
    )
  })

  it('asks once per document, so a cart and a product page show one notice', async () => {
    visit('?order=success&session_id=cs_test_abcdefgh123')
    const siteFetch = respond({ status: 'open', paymentStatus: 'unpaid' })
    renderHook(() => useCheckoutReturnNotice('host-1', siteFetch))
    const second = renderHook(() => useCheckoutReturnNotice('host-1', siteFetch))
    await waitFor(() => expect(siteFetch).toHaveBeenCalledTimes(1))
    expect(second.result.current[0]).toBeNull()
  })

  it('stays silent when the lookup fails', async () => {
    visit('?order=success&session_id=cs_test_abcdefgh123')
    const siteFetch = respond({}, false)
    const { result } = renderHook(() =>
      useCheckoutReturnNotice('host-1', siteFetch),
    )
    await waitFor(() => expect(siteFetch).toHaveBeenCalled())
    expect(result.current[0]).toBeNull()
  })
})
