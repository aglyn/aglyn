/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.aglyn.com/"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored.
 *
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
 * Admin-bar stub arming (AGL-1829). The stub is the only code an anonymous
 * visitor pays for, so what arms it — and what must NOT — is the contract:
 *
 * - presence hint cookie → arms AUTO (silent probe, no pill);
 * - no signal at all → nothing renders and the bar chunk is never mounted;
 * - hint + a remembered disconnect → stays dark (the opt-out holds);
 * - `?aglyn-edit` → arms MANUAL and clears the opt-out (explicit beats
 *   remembered);
 * - a stored token → arms MANUAL;
 * - the chord → arms MANUAL and clears the opt-out.
 */

import { act, render, screen } from '@testing-library/react'
import {
  editOptOutStorageKey,
  editTokenStorageKey,
} from '../app/[host]/admin-bar/admin-bar-shared'
import AdminBarStub from '../app/[host]/admin-bar/admin-bar-stub'

// The stub loads the bar through next/dynamic; the marker below stands in
// for the whole chunk so this suite pins ARMING, not the bar itself.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function MockAdminBar(props: { autoConnect?: boolean }) {
      return <div data-testid="admin-bar" data-auto={String(props.autoConnect)} />
    },
}))

const HOST = 'host-1'

function renderStub() {
  return render(
    <AdminBarStub hostId={HOST} consoleOrigin="https://app.aglyn.com" />,
  )
}

describe('AdminBarStub arming (AGL-1829)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.cookie = 'aglyn_editor=; Max-Age=0; Path=/'
    window.history.replaceState({}, '', '/')
    // Deterministic idle: run the idle check synchronously on request.
    window.requestIdleCallback = ((callback: IdleRequestCallback) => {
      callback({} as IdleDeadline)
      return 1
    }) as typeof window.requestIdleCallback
    window.cancelIdleCallback = (() => undefined) as typeof window.cancelIdleCallback
  })

  it('arms AUTO from the presence hint', () => {
    document.cookie = 'aglyn_editor=1; Path=/'
    renderStub()
    expect(screen.getByTestId('admin-bar').dataset.auto).toBe('true')
  })

  it('renders nothing without any signal', () => {
    const { container } = renderStub()
    expect(container.innerHTML).toBe('')
  })

  it('stays dark when the editor disconnected, hint or not', () => {
    document.cookie = 'aglyn_editor=1; Path=/'
    window.localStorage.setItem(editOptOutStorageKey(HOST), '1')
    const { container } = renderStub()
    expect(container.innerHTML).toBe('')
  })

  it('?aglyn-edit arms MANUAL and clears the opt-out', () => {
    window.localStorage.setItem(editOptOutStorageKey(HOST), '1')
    window.history.replaceState({}, '', '/?aglyn-edit')
    renderStub()
    expect(screen.getByTestId('admin-bar').dataset.auto).toBe('false')
    expect(window.localStorage.getItem(editOptOutStorageKey(HOST))).toBeNull()
  })

  it('a stored token arms MANUAL', () => {
    window.localStorage.setItem(
      editTokenStorageKey(HOST),
      JSON.stringify({ token: 't-1', expiresAtMs: Date.now() + 60_000 }),
    )
    renderStub()
    expect(screen.getByTestId('admin-bar').dataset.auto).toBe('false')
  })

  it('the chord arms MANUAL and clears the opt-out', () => {
    window.localStorage.setItem(editOptOutStorageKey(HOST), '1')
    renderStub()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyE',
          metaKey: true,
          shiftKey: true,
        }),
      )
    })
    expect(screen.getByTestId('admin-bar').dataset.auto).toBe('false')
    expect(window.localStorage.getItem(editOptOutStorageKey(HOST))).toBeNull()
  })
})
