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

import {
  InteractionsContext,
  type InteractionsContextValue,
} from '@aglyn/besigner-ui'
import { render } from '@testing-library/react'
import { useContext } from 'react'
import InteractionsProvider from './interactions-provider.component'

// Override only the query builders — the rest of the module (Timestamp
// et al.) must stay real, other libs subclass it at import time.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: jest.fn(() => 'collection-ref'),
  doc: jest.fn(() => 'doc-ref'),
  limit: jest.fn((n: number) => n),
  query: jest.fn(() => 'query-ref'),
  setDoc: jest.fn(() => Promise.resolve()),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

// The builder dialog drags the whole canvas dep graph in — irrelevant to
// the context-shape contract under test.
jest.mock('./interaction-builder-dialog.component', () => ({
  __esModule: true,
  default: () => null,
  PickModeBanner: () => null,
}))

const buildQueries: Array<() => unknown> = []
/**
 * Creating an action/entry is a SERVER call since AGL-2266, so this closed-world
 * factory has to name the hook or the component throws and every assertion
 * below reads the crash as the behaviour under test. A `jest.fn` rather than an
 * inert arrow: these suites are about writes that must NOT happen, and this is
 * the one write that would now happen somewhere else.
 */
const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => mockCreateResource,
  useFirestoreCollection: (buildQuery: () => unknown) => {
    buildQueries.push(buildQuery)
    return { data: [], status: 'success', error: undefined }
  },
}))

describe('InteractionsProvider disabled mode (AGL-587)', () => {
  beforeEach(() => {
    buildQueries.length = 0
    jest.clearAllMocks()
  })

  function renderProbe(disabled?: boolean): InteractionsContextValue {
    let seen: InteractionsContextValue = {}
    function Probe() {
      seen = useContext(InteractionsContext)
      return null
    }
    render(
      <InteractionsProvider hostId="h1" screenId="s1" disabled={disabled}>
        <Probe />
      </InteractionsProvider>,
    )
    return seen
  }

  it('provides an empty context for email documents — the props form gates the Interactions section on the creator callbacks', () => {
    const value = renderProbe(true)
    expect(value.onCreateInteraction).toBeUndefined()
    expect(value.onEditInteraction).toBeUndefined()
    expect(value.onCreateSectionExperiment).toBeUndefined()
    expect(value.onToggleInteraction).toBeUndefined()
    expect(value.onDeleteInteraction).toBeUndefined()
    expect(value.automations).toBeUndefined()
    // No Firestore subscriptions open: every query factory yields null.
    expect(buildQueries.length).toBeGreaterThan(0)
    for (const buildQuery of buildQueries) {
      expect(buildQuery()).toBeNull()
    }
  })

  it('keeps full capabilities for screens (and layouts)', () => {
    const value = renderProbe(undefined)
    expect(typeof value.onCreateInteraction).toBe('function')
    expect(typeof value.onEditInteraction).toBe('function')
    expect(typeof value.onCreateSectionExperiment).toBe('function')
    expect(value.automations).toEqual([])
    // Subscriptions build real queries.
    for (const buildQuery of buildQueries) {
      expect(buildQuery()).toBe('query-ref')
    }
  })
})
