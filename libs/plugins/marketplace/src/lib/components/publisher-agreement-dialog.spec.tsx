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
 * THE AGREEMENT, ASKED FOR WHERE THE ACTION WAS (AGL-3407).
 *
 * A publish refused for the Marketplace Publisher Agreement used to answer
 * with a sentence naming a tab. These drive the dialog that replaced it and
 * the gate every publish surface sends through, against the real request
 * builders with only the network mocked — so what is asserted is the request
 * that would reach the accept route and the publish route, not a stub's idea
 * of it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { PUBLISHER_AGREEMENT_VERSION } from '@aglyn/aglyn/app-utils/publisher-agreement'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import PublisherAgreementDialog from './publisher-agreement-dialog.component'
import usePublisherAgreementGate, {
  type PublisherAgreementGatedResult,
} from './use-publisher-agreement-gate'

const calls: Array<{ url: string; init?: { method?: string; body?: string } }> = []
/** The roster the members route answers with; null makes it fail. */
let roster: Array<Record<string, unknown>> | null = []
let acceptStatus = 200
/** What the publish route answers, one entry per call, in order. */
let publishAnswers: Array<{ status: number; body: Record<string, unknown> }> = []

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (
    _user: unknown,
    url: string,
    init?: { method?: string; body?: string },
  ) => {
    calls.push({ url, init })
    const reply = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    })
    if (url.startsWith('/api/orgs/members')) {
      return roster ? reply(200, { members: roster }) : reply(500, {})
    }
    if (url === '/api/marketplace/publisher-profile') {
      return reply(
        acceptStatus,
        acceptStatus < 400
          ? { ok: true }
          : { error: 'Only an organization owner or admin can accept' },
      )
    }
    const next = publishAnswers.shift() ?? { status: 200, body: { version: 2 } }
    return reply(next.status, next.body)
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'me', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: undefined, status: 'loading' }),
}))

const REFUSAL = {
  error: 'The Marketplace Publisher Agreement has changed since your organization accepted it.',
  agreement: {
    required: PUBLISHER_AGREEMENT_VERSION,
    accepted: '2026-08-18.1',
    state: 'outdated',
    orgId: 'org-1',
  },
}

beforeEach(() => {
  calls.length = 0
  roster = [{ $id: 'me', role: 'admin', displayName: 'Me' }]
  acceptStatus = 200
  publishAnswers = []
})

const acceptCalls = () =>
  calls.filter((call) => call.url === '/api/marketplace/publisher-profile')

describe('the agreement dialog', () => {
  it('accepts through the same route and body the Publisher Profile uses', async () => {
    const onAccepted = jest.fn()
    render(
      <PublisherAgreementDialog
        open
        orgId="org-1"
        standing={{ state: 'none', accepted: null }}
        continueWith="publish"
        onAccepted={onAccepted}
        onClose={jest.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept and publish' }))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(acceptCalls()).toHaveLength(1)
    expect(JSON.parse(String(acceptCalls()[0].init?.body))).toEqual({
      action: 'accept-agreement',
      orgId: 'org-1',
      version: PUBLISHER_AGREEMENT_VERSION,
    })
    // Who may accept was asked as a role query, not read off a whole roster.
    const rosterCall = calls.find((call) => call.url.startsWith('/api/orgs/members'))
    expect(decodeURIComponent(String(rosterCall?.url))).toContain(
      '"field":"role","op":"isAnyOf","value":"owner,admin"',
    )
  })

  it('says what changed since the version the org accepted', async () => {
    render(
      <PublisherAgreementDialog
        open
        orgId="org-1"
        standing={{ state: 'outdated', accepted: '2026-08-18.1' }}
        onAccepted={jest.fn()}
        onClose={jest.fn()}
      />,
    )
    expect(
      await screen.findByText('What changed since version 2026-08-18.1'),
    ).toBeTruthy()
    expect(screen.getByText(/Travis County, Texas/)).toBeTruthy()
    // Offered before any action, so the button names only the acceptance.
    expect(
      await screen.findByRole('button', { name: 'Accept the current version' }),
    ).toBeTruthy()
  })

  it('shows someone who cannot accept who can, and no accept action', async () => {
    roster = [
      { $id: 'owner-1', role: 'owner', displayName: 'Ada Owner', email: 'ada@example.com' },
      { $id: 'admin-1', role: 'admin', email: 'bo@example.com' },
    ]
    render(
      <PublisherAgreementDialog
        open
        orgId="org-1"
        standing={{ state: 'none', accepted: null }}
        continueWith="publish"
        onAccepted={jest.fn()}
        onClose={jest.fn()}
      />,
    )
    expect(
      await screen.findByText(/Ada Owner \(ada@example\.com\), bo@example\.com/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('leaves the decision to the route when the roster cannot answer, and shows its refusal', async () => {
    roster = null
    acceptStatus = 403
    const onAccepted = jest.fn()
    render(
      <PublisherAgreementDialog
        open
        orgId="org-1"
        standing={{ state: 'none', accepted: null }}
        onAccepted={onAccepted}
        onClose={jest.fn()}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept on behalf of this organization' }),
    )
    expect(
      await screen.findByText('Only an organization owner or admin can accept'),
    ).toBeTruthy()
    expect(onAccepted).not.toHaveBeenCalled()
  })
})

/** A surface that publishes through the gate, as every publish surface does. */
function Harness(props: { onResult: (result: PublisherAgreementGatedResult) => void }) {
  const gate = usePublisherAgreementGate({})
  const [body] = useState(() => JSON.stringify({ hostId: 'host-1', displayName: 'Hero' }))
  return (
    <>
      <button
        onClick={() =>
          void gate
            .send(() =>
              authorizedFetch(null, '/api/marketplace/publish', {
                method: 'POST',
                body,
              }),
            )
            .then(props.onResult)
        }
      >
        {'Send'}
      </button>
      {gate.dialog}
    </>
  )
}

describe('the gate a publish surface sends through', () => {
  it('opens the agreement on the structured refusal and, once accepted, sends the same request again', async () => {
    publishAnswers = [
      { status: 412, body: REFUSAL },
      { status: 200, body: { version: 3 } },
    ]
    const onResult = jest.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept and publish' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    const publishes = calls.filter((call) => call.url === '/api/marketplace/publish')
    expect(publishes).toHaveLength(2)
    expect(publishes[1].init?.body).toBe(publishes[0].init?.body)
    // The org came from the refusal: a host-scoped publish names no org.
    expect(JSON.parse(String(acceptCalls()[0].init?.body)).orgId).toBe('org-1')
    const result = onResult.mock.calls[0][0] as PublisherAgreementGatedResult
    expect(result.declined).toBe(false)
    expect(result.payload).toEqual({ version: 3 })
  })

  it('answers a closed dialog as declined, without sending again', async () => {
    publishAnswers = [{ status: 412, body: REFUSAL }]
    const onResult = jest.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(onResult.mock.calls[0][0]).toMatchObject({ declined: true })
    expect(calls.filter((call) => call.url === '/api/marketplace/publish')).toHaveLength(1)
    expect(acceptCalls()).toHaveLength(0)
  })

  it('reads the structured field, not the prose', async () => {
    // The same sentence with no `agreement` is some other refusal: no dialog.
    publishAnswers = [{ status: 412, body: { error: REFUSAL.error } }]
    const onResult = jest.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(onResult.mock.calls[0][0]).toMatchObject({ declined: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
