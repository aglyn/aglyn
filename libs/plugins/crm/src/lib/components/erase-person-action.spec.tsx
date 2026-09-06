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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useErasePersonAction, type UseErasePersonActionProps } from './erase-person-action'

let canManage = true
let ready = true
jest.mock('./settings-section', () => ({
  useCanManageCrmSettings: () => ({ canManage, ready }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: async () => 'token-abc' } }),
}))
let notices: Array<{ message: string; variant: string }>
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown, options: { variant: string }) =>
      void notices.push({ message: String(message), variant: options.variant }),
  }),
}))

let calls: Array<{ url: string; body: Record<string, unknown> }>
let answer: () => { status: number; payload: Record<string, unknown> }

/**
 * The hook's three outputs, rendered plainly: each item as a button that
 * carries its reason as a title, then the banner, then the dialog.
 */
function Harness(props: UseErasePersonActionProps) {
  const action = useErasePersonAction(props)
  return (
    <>
      {action.menuItems.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          title={item.disabledReason}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
      {action.banner}
      {action.dialog}
    </>
  )
}

const contact: UseErasePersonActionProps['subject'] = {
  kind: 'contact',
  id: 'c1',
  email: 'jane@example.com',
}

beforeEach(() => {
  canManage = true
  ready = true
  notices = []
  calls = []
  answer = () => ({
    status: 200,
    payload: { ok: true, requestId: 'org1__k', pendingSinceMs: 1_700_000_000_000, alreadyPending: false },
  })
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const { status, payload } = answer()
    return { ok: status < 400, status, json: async () => payload }
  })
})

// `hidden`, because an open (or closing) dialog marks the page behind it
// aria-hidden, and the item lives on the page.
const item = () =>
  screen.getByRole('button', { name: 'Erase this person', hidden: true }) as HTMLButtonElement

describe('the menu item', () => {
  it('is offered to a workspace admin', () => {
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    expect(item().disabled).toBe(false)
  })

  it('is present but disabled, with the reason, for anyone else', () => {
    // An absent item and an inapplicable one look alike; the reason says
    // who can do this.
    canManage = false
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    expect(item().disabled).toBe(true)
    expect(item().getAttribute('title')).toBe('Only a workspace admin can erase a person')
  })

  it('waits for the role before deciding, and for the record before offering', () => {
    ready = false
    const { unmount } = render(
      <Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />,
    )
    expect(item().getAttribute('title')).toBe('Checking your workspace role')
    unmount()
    ready = true
    render(<Harness hostId="h1" orgId="org1" subject={null} requestedAtMs={null} />)
    expect(item().getAttribute('title')).toBe('The record has not loaded')
  })

  it('is disabled, and the banner shown, while a request already waits', () => {
    render(
      <Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={1_700_000_000_000} />,
    )
    expect(item().getAttribute('title')).toBe('An erasure is already pending for this person')
    expect(screen.getByTestId('erasure-pending-banner').textContent).toMatch(/Erasure pending/)
  })
})

describe('the dialog', () => {
  it('names what goes, what stays, what is not reached, and the two facts that follow', () => {
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    fireEvent.click(item())
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Erase jane@example.com from this workspace?')
    expect(dialog.textContent).toContain('Removed across the workspace')
    expect(dialog.textContent).toContain('Kept, with the person taken off')
    expect(dialog.textContent).toContain('Not reached')
    expect(dialog.textContent).toMatch(/Orders and bookings stay/)
    expect(dialog.textContent).toMatch(/Form submissions/)
    expect(dialog.textContent).toMatch(/address is closed/)
    expect(dialog.textContent).toMatch(/nightly erasure job/)
  })

  it('keeps the button off until the address is typed back, in any case', () => {
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    fireEvent.click(item())
    const confirm = screen.getByRole('button', { name: 'Erase permanently' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const field = screen.getByLabelText('Type the email address to confirm')
    fireEvent.change(field, { target: { value: 'jane@example.org' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(field, { target: { value: ' Jane@Example.com ' } })
    expect(confirm.disabled).toBe(false)
  })

  it('files the request from a contact, tells the admin, and shows the banner', async () => {
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    fireEvent.click(item())
    fireEvent.change(screen.getByLabelText('Type the email address to confirm'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/crm/erase-person')
    expect(calls[0].body).toEqual({ hostId: 'h1', contactId: 'c1', email: 'jane@example.com' })
    await waitFor(() =>
      expect(notices).toEqual([
        { message: 'Erasure requested — it runs with the nightly job', variant: 'success' },
      ]),
    )
    // The record's own marker has not arrived yet; the answer is enough.
    expect(screen.getByTestId('erasure-pending-banner')).toBeTruthy()
    expect(item().disabled).toBe(true)
  })

  it('files by lead id from a lead', async () => {
    render(
      <Harness
        hostId="h1"
        orgId="org1"
        subject={{ kind: 'lead', id: 'lead-key', email: 'jane@example.com' }}
        requestedAtMs={null}
      />,
    )
    fireEvent.click(item())
    fireEvent.change(screen.getByLabelText('Type the email address to confirm'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ hostId: 'h1', leadId: 'lead-key', email: 'jane@example.com' })
  })

  it('says so when a request was already waiting', async () => {
    answer = () => ({
      status: 200,
      payload: { ok: true, requestId: 'org1__k', pendingSinceMs: 5, alreadyPending: true },
    })
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    fireEvent.click(item())
    fireEvent.change(screen.getByLabelText('Type the email address to confirm'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))
    await waitFor(() =>
      expect(notices[0]?.message).toBe('An erasure was already pending for this person'),
    )
  })

  it('shows the route\'s refusal and keeps the dialog open', async () => {
    answer = () => ({ status: 403, payload: { error: 'Only a workspace admin can erase a person from the workspace' } })
    render(<Harness hostId="h1" orgId="org1" subject={contact} requestedAtMs={null} />)
    fireEvent.click(item())
    fireEvent.change(screen.getByLabelText('Type the email address to confirm'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))
    await waitFor(() =>
      expect(notices).toEqual([
        { message: 'Only a workspace admin can erase a person from the workspace', variant: 'error' },
      ]),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByTestId('erasure-pending-banner')).toBeNull()
  })
})
