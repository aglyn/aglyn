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

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { SigningForm, type SignableWaiver } from './signing-form.component'
import { WaiverSignFlow } from './waiver-sign-flow.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

/**
 * The signing form and the flow around it (AGL-4042): the merchant's words
 * rendered as text, never as markup; the boxes and the consent sentence a
 * signer must agree to; a refusal before the press; and the share page or
 * site element opening straight to the one published waiver, or listing
 * several to choose from.
 */

const WAIVER: SignableWaiver = {
  id: 'waiver-1',
  version: 2,
  title: 'Rider release',
  body: '## The risks\n\nMotocross is **dangerous**.\n\n- Wear a helmet',
  checkboxes: [{ id: 'read', label: 'I have read this waiver.' }],
  allowMinors: true,
  validityText: 'Good for one visit (the day it is signed)',
}

async function settled(ui: ReactElement) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return result
}

describe('the signing form', () => {
  it('shows the waiver’s words as text, its boxes, how long it lasts and the consent sentence', async () => {
    await settled(
      <SigningForm siteName="Acme Motocross" waiver={WAIVER} consentText="I agree to sign electronically." adultAge={18} mode="online" submit={jest.fn()} />,
    )
    expect(screen.getByRole('heading', { name: 'Rider release' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'The risks' })).toBeTruthy()
    expect(screen.getByText('dangerous').tagName).not.toBe('P')
    expect(document.body.textContent).not.toContain('**')
    expect(screen.getByLabelText('I have read this waiver.')).toBeTruthy()
    expect(screen.getByLabelText('I agree to sign electronically.')).toBeTruthy()
    expect(screen.getByText('Good for one visit (the day it is signed)')).toBeTruthy()
    expect(screen.getByLabelText('I’m also signing for riders under 18')).toBeTruthy()
  })

  it('opens the minors section, and leaves it out of a waiver that takes none', async () => {
    const { unmount } = await settled(
      <SigningForm siteName="Acme" waiver={WAIVER} consentText="Consent." adultAge={18} mode="online" submit={jest.fn()} />,
    )
    fireEvent.click(screen.getByLabelText('I’m also signing for riders under 18'))
    expect(screen.getByLabelText(/Minor’s full name/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add another minor' })).toBeTruthy()
    unmount()
    await settled(
      <SigningForm siteName="Acme" waiver={{ ...WAIVER, allowMinors: false }} consentText="Consent." adultAge={18} mode="online" submit={jest.fn()} />,
    )
    expect(screen.queryByLabelText('I’m also signing for riders under 18')).toBeNull()
  })

  it('says what is missing before anything is sent', async () => {
    const submit = jest.fn()
    await settled(<SigningForm siteName="Acme" waiver={WAIVER} consentText="Consent." adultAge={18} mode="online" submit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign waiver' }))
    expect(await screen.findByText('Enter your full name.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Jordan Lee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign waiver' }))
    expect(await screen.findByText(/Enter your email address/)).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('asks the window’s signer for no email, and carries a hidden honeypot', async () => {
    await settled(<SigningForm siteName="Acme" waiver={WAIVER} consentText="Consent." adultAge={18} mode="at_window" submit={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Jordan Lee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign waiver' }))
    expect(await screen.findByText('Enter your date of birth.')).toBeTruthy()
    const honeypot = document.querySelector('input[tabindex="-1"]')
    expect(honeypot?.closest('[aria-hidden="true"]')).toBeTruthy()
  })
})

describe('choosing a waiver to sign', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  })
  const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
  const ONE = { site: { name: 'Acme Motocross' }, waiver: WAIVER, consent: { text: 'Consent.', version: 1 }, adultAge: 18 }

  it('opens the only published waiver straight to its form', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('waiverId=') ? answer(ONE) : answer({ site: { name: 'Acme Motocross' }, waivers: [{ id: 'waiver-1', title: 'Rider release' }] }),
    )
    await settled(<WaiverSignFlow hostId="host-1" mode="online" />)
    expect(await screen.findByRole('heading', { name: 'Rider release' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose a different waiver' })).toBeNull()
  })

  it('lists several to choose from, then signs the one chosen', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('waiverId=')
        ? answer(ONE)
        : answer({ site: { name: 'Acme Motocross' }, waivers: [{ id: 'waiver-1', title: 'Rider release' }, { id: 'waiver-2', title: 'Pit pass' }] }),
    )
    await settled(<WaiverSignFlow hostId="host-1" mode="online" heading="Pick yours" />)
    expect(await screen.findByRole('heading', { name: 'Pick yours' })).toBeTruthy()
    fireEvent.click(screen.getByText('Rider release'))
    expect(await screen.findByRole('button', { name: 'Choose a different waiver' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('waiverId=waiver-1'))).toBe(true)
  })

  it('says so when a link names a waiver that is not taking signatures', async () => {
    fetchMock.mockImplementation(() => answer({ error: 'This waiver is not taking signatures right now.' }, 404))
    await settled(<WaiverSignFlow hostId="host-1" waiverId="gone" mode="online" />)
    expect(await screen.findByText('This waiver is not taking signatures right now.')).toBeTruthy()
  })
})
