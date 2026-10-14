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
 * "Maximum update depth exceeded" while typing in Assist (AGL-3616).
 *
 * Production reported minified React error #185 on a site's Dashboard,
 * thrown from the chat box's own `onChange`, and the first keystrokes typed
 * into the panel were lost with it. React 19 counts every commit that leaves
 * an update pending as a nested one, and resets the count only on a commit
 * that leaves none. The chat box was controlled by the panel's own state, so
 * every keystroke was a commit of the WHOLE panel — the thread, the AI jobs
 * list, the usage strip, the model switch. Any part of that tree that leaves
 * an update pending after its commit (the AGL-3423 cases were MUI fields
 * setting a value they already held from a passive effect) turns each
 * keystroke into a nested update, and on a page that is still busy the
 * browser delivers queued keystrokes back to back. The 51st keystroke's
 * `setState` throws, and the keystroke it carried is dropped, which is the
 * lost text.
 *
 * The chat box now keeps what is typed in the text field itself: a
 * keystroke commits nothing but the moment the box goes from empty to not
 * (the Send button's state), and the panel around it never redraws for one.
 *
 * The burst runs against the PRODUCTION builds of React and MUI, in a module
 * registry of their own, as the AGL-3423 typing specs do: in development
 * MUI's `FormControl` hands its inputs a new context on every render and
 * would measure the development build. The keystrokes are dispatched in one
 * task and outside `act`, which is how a browser delivers queued input.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))
jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/acme/hosts/maple-street-bakery',
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined }),
}))
const mockUser = { uid: 'viewer', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))
/**
 * The AI jobs list, standing in for any part of the panel that leaves an
 * update pending after each commit it takes part in. It sets a value it
 * already holds from a passive effect, as MUI's `InputBase` does with its
 * `FormControl` (AGL-3423): right after a commit React cannot bail that out
 * early, so it stays pending. It also counts the panel's redraws: it draws
 * once per panel render.
 */
let mockDrawerRenders = 0
const mockDrawerProps = new WeakSet<object>()
// The React whose renderer draws the panel: the production burst swaps in
// its own registry's, so the stand-in's hooks reach the right dispatcher.
let mockReact: typeof import('react') = jest.requireActual('react')
jest.mock('./assist-jobs-drawer.component', () => {
  return {
    __esModule: true,
    AssistJobsDrawer: function AssistJobsDrawer(props: object) {
      const react = mockReact
      // A redraw by the panel hands it new props; its own update does not.
      if (!mockDrawerProps.has(props)) mockDrawerRenders += 1
      mockDrawerProps.add(props)
      const [, setSeen] = react.useState(true)
      react.useEffect(() => {
        setSeen(true)
      })
      return null
    },
  }
})

import '../declarations'
import { AssistPanelComponent } from './assist-panel.component'
import { resetAiJobsStoreForTests } from './ai-jobs-store'
import { resetAiUsageMetersForTests } from './use-ai-usage-meter'

const PANEL_PROPS = {
  orgId: 'org-1',
  org: { plan: 'pro', billingStatus: 'active', seatAddons: { aiAddon: true } } as never,
  orgReady: true,
  scopedOrgId: 'org-1',
  orgSlug: 'acme',
  hostId: 'host-1',
  productName: 'Aglyn',
  assistVisible: true,
  assistStaffPreview: false,
  generativeVisible: true,
  isStaff: false,
  aiPermissions: { loaded: true, use: true, generate: true },
}

/** The usage meter the last answer carried, as the browser keeps it. */
const METER = {
  month: new Date().toISOString().slice(0, 7),
  state: 'ok',
  pool: { used: 120, limit: 1000 },
  mine: { used: 40, limit: null, scope: 'org', mode: 'soft' },
  last: null,
}

/** A thread from earlier in the session, as the panel restores it. */
const THREAD = [
  { role: 'user', text: 'How do I publish?' },
  {
    role: 'assistant',
    text: 'Open [Publish](/acme/hosts/maple-street-bakery/publish) and press it.',
    docs: [{ title: 'Publishing', url: '/docs/publishing' }],
    exchangeId: 'ex-1',
  },
]

beforeEach(() => {
  mockDrawerRenders = 0
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jobs: [] }),
  }))
  sessionStorage.clear()
  sessionStorage.setItem('aglyn-assist:org-1', JSON.stringify(THREAD))
  localStorage.clear()
  // Someone who has asked before: the usage strip is drawn under the thread.
  localStorage.setItem('aglyn-ai-meter:viewer:org-1', JSON.stringify(METER))
  resetAiJobsStoreForTests()
  resetAiUsageMetersForTests()
})

describe('typing in Assist (AGL-3616)', () => {
  it('takes a burst of keystrokes without exceeding React’s update depth', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    // Widened: the Next typings declare `NODE_ENV` read-only.
    const env = process.env as Record<string, string | undefined>
    const environment = env['NODE_ENV']
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT
    const errors: string[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(String(event.error?.message ?? event.message))
      event.preventDefault()
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    env['NODE_ENV'] = 'production'
    scope.IS_REACT_ACT_ENVIRONMENT = false
    window.addEventListener('error', onError)
    let unmount: () => void = () => undefined
    try {
      let react!: typeof import('react')
      let client!: typeof import('react-dom/client')
      let Panel!: typeof AssistPanelComponent
      jest.isolateModules(() => {
        react = jest.requireActual('react')
        client = jest.requireActual('react-dom/client')
        jest.requireActual('../declarations')
        Panel = (
          jest.requireActual('./assist-panel.component') as typeof import('./assist-panel.component')
        ).AssistPanelComponent
      })
      mockReact = react
      const root = client.createRoot(host)
      unmount = () => root.unmount()
      root.render(react.createElement(Panel, PANEL_PROPS))
      await new Promise((resolve) => setTimeout(resolve, 50))
      within(document.body).getByLabelText(/Open Aglyn Assist/).click()
      await new Promise((resolve) => setTimeout(resolve, 50))
      const box = within(document.body).getByPlaceholderText('How do I…') as HTMLTextAreaElement
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      for (let typed = 1; typed <= 80; typed += 1) {
        setValue?.call(box, 'x'.repeat(typed))
        box.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(errors).toEqual([])
      expect(box.value).toBe('x'.repeat(80))
      // The thread restored around the box is still drawn.
      expect(within(document.body).getByText('How do I publish?')).toBeTruthy()
    } finally {
      unmount()
      mockReact = jest.requireActual('react')
      window.removeEventListener('error', onError)
      host.remove()
      env['NODE_ENV'] = environment
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment
    }
    // The isolated registry loads React, MUI and the panel a second time.
  }, 120_000)

  it('keeps every keystroke without redrawing the panel, and sends what was typed', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url === '/api/assist/chat'
        ? { ok: false, status: 500, json: async () => ({ error: 'unavailable' }) }
        : { ok: true, status: 200, json: async () => ({ jobs: [] }) },
    )
    render(<AssistPanelComponent {...PANEL_PROPS} />)
    fireEvent.click(screen.getByLabelText(/Open Aglyn Assist/))
    const box = (await screen.findByPlaceholderText('How do I…')) as HTMLTextAreaElement
    const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    const before = mockDrawerRenders
    let text = ''
    for (const ch of 'How do I add a menu page?') {
      text += ch
      fireEvent.change(box, { target: { value: text } })
    }
    expect(box.value).toBe('How do I add a menu page?')
    expect(send.disabled).toBe(false)
    // Going from empty to not redraws the Send button; no keystroke redraws
    // the thread or the AI jobs list around it.
    expect(mockDrawerRenders).toBe(before)

    fireEvent.change(box, { target: { value: '' } })
    expect(send.disabled).toBe(true)
    fireEvent.change(box, { target: { value: '  How do I add a menu page?  ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('How do I add a menu page?')
    expect(box.value).toBe('')
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([url]) => url === '/api/assist/chat')).toBe(true),
    )
    const [, init] = mockFetch.mock.calls.find(([url]) => url === '/api/assist/chat') ?? []
    expect(JSON.parse(String((init as RequestInit).body)).question).toBe('How do I add a menu page?')
  })
})
