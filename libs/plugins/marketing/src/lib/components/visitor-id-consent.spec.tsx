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
 * The experiment visitor id honors the consent gate (AGL-1498): on a
 * consent-gated site, `aglyn:visitor` persists in localStorage only when the
 * recorded state grants analytics — otherwise it degrades to sessionStorage
 * (stable within the visit, gone with the tab) and any lingering local copy
 * is cleaned up. The id never leaves the browser either way; what is gated
 * is the INDEFINITE identifier, not the experiment.
 */
import { storeVisitorConsent, VISITOR_ID_STORAGE_KEY } from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import { MarketingSiteRuntime } from './site-runtime'

const HOST_ID = 'host-1'

const GA_HOST = {
  $id: HOST_ID,
  analytics: { gaMeasurementId: 'G-TEST1234' },
}

function renderExperiments(host: Record<string, any> | null) {
  return render(
    <MarketingSiteRuntime
      hostId={HOST_ID}
      screens={{}}
      page={{
        announcementBar: null,
        popup: null,
        automationOverlays: null,
        clientAutomations: [],
        data: host ? { host } : undefined,
        experiments: [
          {
            id: 'exp-1',
            target: 'screen',
            // Draft: the runner assigns no variant and sends no beacons, but
            // it MUST still resolve the visitor id — which is exactly the
            // behavior under test, with no fetch noise.
            status: 'draft',
            variants: [{ id: 'a' }],
            payloads: { a: null },
          },
        ],
      }}
    />,
  )
}

describe('experiment visitor id vs the consent gate (AGL-1498)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('no consent machinery (no GA): the id persists in localStorage as always', () => {
    renderExperiments({ $id: HOST_ID }).unmount()
    expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeTruthy()
    expect(window.sessionStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
  })

  it('gated site, no grant: sessionStorage only — no indefinite identifier', () => {
    renderExperiments(GA_HOST).unmount()
    expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeTruthy()
  })

  it('gated site, granted (implied or accepted): localStorage persistence', () => {
    storeVisitorConsent(HOST_ID, { status: 'implied', country: 'US' })
    renderExperiments(GA_HOST).unmount()
    expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeTruthy()
  })

  it('a legacy local id migrates DOWN to sessionStorage and keeps its value', () => {
    window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-legacy')
    renderExperiments(GA_HOST).unmount()
    expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe(
      'v-legacy',
    )
  })

  it('a session id promotes UP once consent grants, keeping the assignment', () => {
    window.sessionStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-session')
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'DE' })
    renderExperiments(GA_HOST).unmount()
    expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe(
      'v-session',
    )
  })
})
