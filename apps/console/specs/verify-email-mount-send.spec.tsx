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
 * AGL-2584 — the page's side of the mount cooldown.
 *
 * `/verify-email` asks for a link on every mount, so leaving the tab and
 * coming back to see whether the mail arrived asked for a second one, and
 * Identity Platform's per-account throttle turned that into an alarming error
 * about a mail that had genuinely been sent.
 *
 * The cooldown itself is the route's — the throttle is per account, so a
 * marker held in this browser would not see a link minted from a phone or a
 * second browser. What the page owes the route is the distinction: which of
 * these sends is a mount, and which is a person asking. And what it owes the
 * person is that a suppressed mount looks like the ordinary "we sent you a
 * link" screen, because it is one.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import VerifyEmail from '../app/(auth)/verify-email/page'

let mockCurrentUser: Record<string, unknown> | null = null
let mockSigninCheck: {
  status: 'loading' | 'success'
  data?: { signedIn: boolean; user: Record<string, unknown> | null }
} = { status: 'loading' }

jest.mock('firebase/auth', () => ({ applyActionCode: jest.fn() }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
  useSigninCheck: () => mockSigninCheck,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/loading-text.component', () => ({
  LoadingTextComponent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/background-image.component', () => ({
  BackgroundImageComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))
jest.mock('@aglyn/shared-ui-theme', () => ({ mergeSxProps: () => ({}) }))
jest.mock('@aglyn/aglyn', () => ({ parseOnboardingPlanIntent: () => null }))
jest.mock('@aglyn/shared-util-next', () => ({
  ...jest.requireActual('@aglyn/shared-util-next'),
  continueParam: (value: string) => `continue=${value}`,
  useContinueUrl: () => ['', '', jest.fn()],
  useContinueUrlDecoded: () => ['', jest.fn()],
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: jest.fn(),
  hardNavigate: jest.fn(),
}))
jest.mock('../components/auth-form.component', () => ({
  __esModule: true,
  default: ({
    headingTop,
    headingBottom,
    paperAfter,
    children,
  }: Record<string, ReactNode>) => (
    <div>
      <div>{headingTop}</div>
      <div>{headingBottom}</div>
      {children}
      {paperAfter}
    </div>
  ),
}))

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** The bodies of every POST the page made, parsed. */
const sentBodies = (): Record<string, unknown>[] =>
  (global.fetch as jest.Mock).mock.calls
    .filter(([url]) => String(url).includes('/api/auth/send-verification'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? '{}')))

/** What the route answers next. */
let nextResponse: { status: number; payload: Record<string, unknown> }

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/verify-email')
  nextResponse = { status: 200, payload: { ok: true } }
  const sessionUser = {
    uid: 'session-user',
    email: 'person@example.com',
    emailVerified: false,
    getIdToken: jest.fn(async () => 'token'),
    reload: jest.fn(async () => undefined),
  }
  mockCurrentUser = sessionUser
  mockSigninCheck = {
    status: 'success',
    data: { signedIn: true, user: sessionUser },
  }
  global.fetch = jest.fn(async () => ({
    ok: nextResponse.status < 400,
    status: nextResponse.status,
    json: async () => nextResponse.payload,
  })) as unknown as typeof fetch
})

describe('the page tells the route which kind of send this is', () => {
  it('marks the send it fires from a mount', async () => {
    render(<VerifyEmail />)
    await flush()

    expect(sentBodies()).toEqual([{ auto: true }])
  })

  it('does not mark the one a person asks for', async () => {
    render(<VerifyEmail />)
    await flush()

    fireEvent.click(screen.getByText('Resend verification email'))
    await flush()

    // The button is the affordance for a mail that genuinely did not arrive.
    // Carrying the mount's flag would put it behind the mount's cooldown.
    expect(sentBodies()).toEqual([{ auto: true }, { auto: false }])
  })
})

describe('a suppressed mount is not a failure', () => {
  it('shows the "we sent a link" screen, with no error', async () => {
    // What the route answers a mount inside the cooldown: a link is already
    // on its way, so there is nothing to report and nothing to retry.
    nextResponse = {
      status: 200,
      payload: { ok: true, alreadySent: true, retryAfterSeconds: 540 },
    }

    render(<VerifyEmail />)
    await flush()

    expect(screen.getByText(/We sent a verification link to/)).toBeTruthy()
    expect(screen.getByText('person@example.com')).toBeTruthy()
    // The bug, stated as an assertion: reopening the tab used to be met with
    // a sentence saying the mail could not be sent.
    expect(screen.queryByText(/couldn’t send/)).toBeNull()
    expect(screen.queryByText(/Too many requests/)).toBeNull()
    // And the remedy stays reachable for a mail that really was lost.
    expect(screen.getByText('Resend verification email')).toBeTruthy()
  })

  it('still reports a real refusal', async () => {
    // The cooldown must not have made the page deaf: a 429 from the per-uid
    // budget is a genuine "wait", and it still has to arrive.
    nextResponse = { status: 429, payload: {} }

    render(<VerifyEmail />)
    await flush()

    expect(screen.getByText(/Too many requests/)).toBeTruthy()
  })
})
