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
 * What you are told about, and what that actually means (AGL-3251).
 *
 * Reported as "it is not clear what each of these notifications are and which
 * one are actually staff" against a table of seven bare labels and two
 * switches. Three things answer it, and each has a test here: the category
 * says what arrives in it, the staff ones say they are staff, and a category
 * opens onto its own types with their own switches.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { NotificationChannel } from '@aglyn/aglyn'
import { NotificationCategoryTable } from '../components/notification-category-table.component'

const CHANNELS: Array<{ key: NotificationChannel; label: string }> = [
  { key: 'console', label: 'In console' },
  { key: 'email', label: 'Email' },
]

const renderTable = (
  props: Partial<Parameters<typeof NotificationCategoryTable>[0]> = {},
) => {
  const handlers = {
    onCategoryChange: jest.fn(),
    onTypeChange: jest.fn(),
    onTypeReset: jest.fn(),
  }
  const view = render(
    <NotificationCategoryTable
      categories={[
        ['billing', 'Billing'],
        ['content', 'Forms & bookings'],
        ['staff', 'Platform growth'],
      ]}
      channels={CHANNELS}
      categoryValue={() => true}
      typeValue={() => true}
      typePref={() => undefined}
      {...handlers}
      {...props}
    />,
  )
  return { ...view, ...handlers }
}

const rowOf = (text: string) =>
  screen.getByText(text).closest('tr') as HTMLElement

describe('NotificationCategoryTable (AGL-3251)', () => {
  it('says what arrives in each category', () => {
    renderTable()
    // The words a reader can check against their own feed, not the label again.
    expect(screen.getByText(/Invoices, failed payments/)).toBeTruthy()
    expect(screen.getByText(/form submissions, bookings, orders/)).toBeTruthy()
  })

  it('marks the staff categories and only those', () => {
    renderTable()
    // Already hidden from everyone who is not staff, which is exactly why it
    // looks like an ordinary product setting to the people who can see it.
    expect(within(rowOf('Platform growth')).getByText('Staff only')).toBeTruthy()
    expect(within(rowOf('Billing')).queryByText('Staff only')).toBeNull()
  })

  it('keeps the types folded away until asked', () => {
    renderTable()
    expect(screen.queryByText('Payment failed')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show what Billing covers'))
    expect(screen.getByText('Payment failed')).toBeTruthy()
    // One category at a time: opening Billing must not unfold everything.
    expect(screen.queryByText('New booking')).toBeNull()
    fireEvent.click(screen.getByLabelText('Hide what Billing covers'))
    expect(screen.queryByText('Payment failed')).toBeNull()
  })

  it('switches one type without its neighbours', () => {
    const { onTypeChange, onCategoryChange } = renderTable()
    fireEvent.click(screen.getByLabelText('Show what Billing covers'))
    fireEvent.click(
      within(rowOf('Payment failed')).getByLabelText('Payment failed — In console'),
    )
    expect(onTypeChange).toHaveBeenCalledWith('billing.paymentFailed', 'console', false)
    // The category is untouched — silencing one type took its six neighbours
    // with it before this existed.
    expect(onCategoryChange).not.toHaveBeenCalled()
  })

  describe('a type that carries its own answer', () => {
    const typePref = (type: string, channel: NotificationChannel) =>
      type === 'billing.usage' && channel === 'console' ? false : undefined

    it('says so, and offers the way back', () => {
      const { onTypeReset } = renderTable({
        typePref: typePref as any,
        typeValue: (type, channel) =>
          !(type === 'billing.usage' && channel === 'console'),
      })
      fireEvent.click(screen.getByLabelText('Show what Billing covers'))
      const row = rowOf('Usage threshold')
      // Drawn from the EFFECTIVE answer, so the switch alone cannot say which
      // of the two it is reading — and somebody who cannot see that they set
      // something cannot unset it.
      expect(within(row).getByText('Set')).toBeTruthy()
      fireEvent.click(within(row).getByText('Follow category'))
      /*
       * ONE call for the whole type, never one per channel. The page rebuilds
       * the settings document from the state it closed over, so two clears in
       * the same tick both read the value from before either of them and the
       * second restores what the first removed.
       */
      expect(onTypeReset).toHaveBeenCalledTimes(1)
      expect(onTypeReset).toHaveBeenCalledWith('billing.usage')
    })

    it('leaves an untouched row undecorated', () => {
      renderTable({ typePref: typePref as any })
      fireEvent.click(screen.getByLabelText('Show what Billing covers'))
      expect(within(rowOf('Invoice available')).queryByText('Set')).toBeNull()
    })
  })

  /**
   * A digest composes and sends its own email under its own switch, and the
   * generic channel skips it (`NOTIFICATION_SELF_SENT_EMAIL_TYPES`) — so an
   * email switch here would be a control that does nothing.
   */
  it('refuses to offer an email switch that could never fire', () => {
    renderTable()
    fireEvent.click(screen.getByLabelText('Show what Forms & bookings covers'))
    const digest = rowOf('Daily CRM digest')
    const disabled = (element: HTMLElement) =>
      (element as HTMLInputElement).disabled
    expect(disabled(within(digest).getByLabelText('Daily CRM digest — Email'))).toBe(
      true,
    )
    // Its console switch is a real control, and the neighbours keep both.
    expect(
      disabled(within(digest).getByLabelText('Daily CRM digest — In console')),
    ).toBe(false)
    expect(
      disabled(within(rowOf('New booking')).getByLabelText('New booking — Email')),
    ).toBe(false)
  })
})
