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
 * A CHECK NOBODY ANSWERED IS NOT A FAILED CHECK.
 *
 * `verifySendingDomain` has three outcomes and the third one — a resolver
 * that did not answer — writes only the check time and leaves the stored
 * status exactly where it was. The route says so with a `503`.
 *
 * The expensive mistake this surface could make is collapsing that into the
 * failure arm, because the two demand opposite actions from opposite people:
 * `failed` means "your records are not published, go add them", and
 * `inconclusive` means "our lookup did not complete, do nothing". A customer
 * whose DNS is perfect, told the first, goes and edits a zone that has
 * nothing wrong with it — and the most likely thing they change is the record
 * that was already right.
 *
 * So the assertions come in pairs: the notice IS shown, and the failure copy
 * is NOT. Either alone would pass against a component that renders nothing.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SendingDomainDetail } from './sending-domain-detail'

const BASE_PATH = '/acme/hosts/site/emails/sending'
const DOMAIN = 'acme.com'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/${DOMAIN}`,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: async () => true }),
}))

/** What the stored record says, staged per case. */
let record: Record<string, unknown> = {}
/** What the next `verify` answers with. */
let verifyAnswer: { status: number; payload: Record<string, unknown> } = {
  status: 200,
  payload: { verified: true, status: 'verified', missing: [] },
}

beforeEach(() => {
  record = {
    domain: DOMAIN,
    status: 'records-issued',
    records: [
      {
        type: 'TXT',
        name: `send.${DOMAIN}`,
        value: 'v=spf1 include:amazonses.com ~all',
        purpose: 'spf',
        required: true,
        note: 'Authorizes our infrastructure.',
      },
    ],
    lastMissing: null,
  }
  verifyAnswer = {
    status: 200,
    payload: { verified: true, status: 'verified', missing: [] },
  }
  ;(global as any).fetch = jest.fn(async (url: string, init: any) => {
    const method = String(init?.method ?? 'GET')
    if (String(url).includes('sending-identity')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          orgId: 'org-1',
          selected: 'platform',
          localPart: 'hello',
          identity: 'Sending as noreply@aglyn.com on the shared platform domain.',
          identitySource: 'platform',
          refusal: null,
          options: [],
          domains: [],
          canManage: true,
          entitled: true,
        }),
      } as any
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      if (body.action === 'verify') {
        return {
          ok: verifyAnswer.status < 400,
          status: verifyAnswer.status,
          json: async () => verifyAnswer.payload,
        } as any
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ domains: [record] }),
    } as any
  })
})

const mount = async () => {
  render(
    <SendingDomainDetail
      hostId="host-1"
      domain={DOMAIN}
      basePath={BASE_PATH}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const check = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Check DNS'))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The sentence that means "your records are not there". */
const FAILURE_COPY = /records are not published yet|not published yet/i
/** The sentence that means "we could not ask". */
const UNREACHABLE_COPY = /could not reach DNS/i

describe('an unreachable resolver is reported as unreachable', () => {
  beforeEach(() => {
    verifyAnswer = {
      status: 503,
      payload: {
        error:
          'We could not reach DNS to check those records. Nothing has ' +
          'changed — try again in a few minutes.',
        status: 'records-issued',
      },
    }
  })

  it('says the lookup did not complete', async () => {
    await mount()
    await check()

    expect(screen.getByText('DNS unreachable')).toBeTruthy()
    expect(screen.getByText(UNREACHABLE_COPY)).toBeTruthy()
  })

  it('does NOT say the records are missing', async () => {
    await mount()
    await check()

    // The whole point. `records-issued` is a state whose own copy is "the
    // records below are yours to add" — a instruction, not an accusation —
    // and nothing anywhere on the page may claim we looked and they were
    // absent, because we did not manage to look.
    expect(screen.queryByText(FAILURE_COPY)).toBeNull()
    expect(screen.queryByText('Records not found')).toBeNull()
  })

  it('leaves the stored state exactly where it was', async () => {
    await mount()

    const before = screen.getByText('Publish the records')
    await check()

    // The record was not written, so the chip must not move. A surface that
    // assigned the check result into the status would show a state the
    // database does not hold — and the next reload would silently change it
    // back, which reads as the console losing the customer's progress.
    expect(screen.getByText('Publish the records')).toBe(before)
  })
})

describe('a conclusive failure IS reported as a failure', () => {
  it('says the records are not there, and names them', async () => {
    /*
     * The control for the two negative assertions above.
     *
     * Without this case, "does NOT say the records are missing" would pass
     * against a component that never renders the failure copy under any
     * circumstances — which is a different bug with the same test result.
     */
    record = {
      ...record,
      status: 'failed',
      lastMissing: [`TXT:send.${DOMAIN}`],
    }

    await mount()

    expect(screen.getByText('Records not found')).toBeTruthy()
    expect(screen.getByText(FAILURE_COPY)).toBeTruthy()
  })
})

describe('the four stored states each get their own sentence', () => {
  const stateOf = async (over: Record<string, unknown>) => {
    record = { ...record, ...over }
    await mount()
  }

  it('a claim with no key says the wait is ours, not the customer’s', async () => {
    await stateOf({ status: 'requested', records: [], pendingProvider: true })

    // The honest degradation when no issuing credential is configured. An
    // empty records table would read as our bug; this says so in words, and
    // points the next action at us rather than at their registrar.
    expect(screen.getByText('Waiting on a signing key')).toBeTruthy()
    expect(screen.getByText(/nothing you can change at your registrar/i)).toBeTruthy()
  })

  it('a refused key request is distinguished from a missing credential', async () => {
    await stateOf({
      status: 'requested',
      records: [],
      pendingProvider: true,
      lastIssueError: 'http-403:restricted_api_key',
    })

    // Two different people's problems: one is "this deployment cannot issue
    // keys at all", the other is "the provider refused this domain". Reading
    // the same sentence for both would send an operator hunting for a
    // credential that is present.
    expect(screen.getByText('Key request failed')).toBeTruthy()
    expect(screen.getByText(/http-403:restricted_api_key/)).toBeTruthy()
  })

  it('a verified domain says mail can leave', async () => {
    await stateOf({ status: 'verified' })

    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.getByText(/Mail from this site can leave/i)).toBeTruthy()
  })

  it('records-issued asks for DNS work without claiming anything failed', async () => {
    await stateOf({ status: 'records-issued' })

    expect(screen.getByText('Publish the records')).toBeTruthy()
    expect(screen.queryByText('Records not found')).toBeNull()
  })
})
