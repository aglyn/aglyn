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
 * CLICK-TO-CALL (AGL-2661).
 *
 * What has to hold: a stored number is a `tel:` link a tap can dial, and a
 * value no dialer could take is shown as text rather than as a link that
 * rings nothing; **Call** carries the same href and is refused with its
 * reason otherwise; and **Log a call** opens the activity dialog ALREADY a
 * call, bound to the record the page named — the two steps the button is
 * there to remove.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { CrmCallButton, CrmPhoneLink } from './crm-call-actions'

const scope = { firestore: {}, dataScope: ['orgs', 'org-1'], hostId: 'host-1' }
jest.mock('./activity-queries', () => ({
  useActivityScope: () => scope,
}))

const dialogProps: Array<Record<string, unknown>> = []
jest.mock('./log-activity-dialog', () => ({
  LogActivityDialog: (props: Record<string, unknown>) => {
    dialogProps.push(props)
    return <div data-testid="log-activity-dialog" />
  },
}))

beforeEach(() => {
  dialogProps.length = 0
})

const anchor = (name: string) => screen.getByRole('link', { name })

describe('CrmPhoneLink', () => {
  it('is a tel: link for a number, and plain text for anything else', () => {
    const { container } = render(<CrmPhoneLink phone="+1 (512) 555-0123" />)
    expect(anchor('+1 (512) 555-0123').getAttribute('href')).toBe('tel:+15125550123')
    expect(container.textContent).toBe('+1 (512) 555-0123')

    // Words and extensions are shown, never linked: a dialer handed them
    // would ring nothing.
    render(<CrmPhoneLink phone="ask reception" />)
    expect(screen.queryByRole('link', { name: 'ask reception' })).toBeNull()
    expect(screen.getByText('ask reception')).toBeTruthy()
  })

  it('renders the fallback, and nothing by default, for a record with no number', () => {
    const { container } = render(<CrmPhoneLink phone="   " />)
    expect(container.textContent).toBe('')
    render(<CrmPhoneLink phone={null} fallback={<span>{'No phone'}</span>} />)
    expect(screen.getByText('No phone')).toBeTruthy()
  })
})

describe('CrmCallButton', () => {
  const link = { contactId: 'c-1' }

  it('dials the stored number', () => {
    render(<CrmCallButton hostId="host-1" link={link} phone="+15125550123" />)
    expect(anchor('Call').getAttribute('href')).toBe('tel:+15125550123')
  })

  it('refuses a number no dialer could take, and says which', () => {
    render(<CrmCallButton hostId="host-1" link={link} phone="ext. 4102" />)
    // Refused rather than absent — a rep should learn the number is unusable.
    const call = screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement
    expect(call.disabled).toBe(true)
    expect(screen.queryByRole('link', { name: 'Call' })).toBeNull()
  })

  it('opens the activity dialog already a call, bound to the record', () => {
    render(<CrmCallButton hostId="host-1" link={link} phone="+15125550123" />)
    // Mounted only once asked for, the way the send-email button's is.
    expect(screen.queryByTestId('log-activity-dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Log a call' }))
    expect(screen.getByTestId('log-activity-dialog')).toBeTruthy()
    expect(dialogProps.at(-1)).toMatchObject({ open: true, kind: 'call', link, scope })
  })

  it('locks the log on a plan without the CRM suite, and still dials (AGL-2788)', () => {
    render(<CrmCallButton hostId="host-1" link={link} phone="+15125550123" suiteLocked />)
    // Dialing is not the suite's; logging the call is.
    expect(anchor('Call').getAttribute('href')).toBe('tel:+15125550123')
    const log = screen.getByRole('button', { name: 'Log a call' }) as HTMLButtonElement
    expect(log.disabled).toBe(true)
    fireEvent.click(log)
    expect(screen.queryByTestId('log-activity-dialog')).toBeNull()
  })

  it('offers the log even when there is nothing to dial', () => {
    render(<CrmCallButton hostId={null} link={link} phone={null} />)
    expect((screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(true)
    // A call placed from a mobile is still a call to log.
    fireEvent.click(screen.getByRole('button', { name: 'Log a call' }))
    expect(dialogProps.at(-1)).toMatchObject({ kind: 'call' })
  })
})
