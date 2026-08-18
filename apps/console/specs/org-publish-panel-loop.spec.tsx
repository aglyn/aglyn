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
 *
 * @jest-environment jsdom
 */

import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * Does changing the publish panel's artifact kind loop? (AGL-788)
 *
 * The console dev server throws "Maximum update depth exceeded" from this
 * select's onChange, and AGL-785 closed the same symptom once already.
 *
 * **What this establishes: the panel itself is clean.** It drives the exact dev
 * repro (component <-> layout, five rounds) both with and without StrictMode.
 * React's development build — which jest uses — enforces the update-depth limit
 * in both cases, so a render loop originating in this component would throw.
 * Neither does.
 *
 * **What it does NOT establish: that the dev-server symptom is benign.** Two
 * gaps, both deliberate and both worth knowing before trusting a green run
 * here:
 *
 * 1. The panel is rendered STANDALONE. On the real page it lives inside
 *    HubTabs, and AGL-785 diagnosed the loop as a diffuse HubTabs keepMounted
 *    settling-window race — so the suspected culprit isn't even in this tree.
 * 2. The Firestore hooks are mocked to resolve synchronously. The real
 *    `useFirestoreCollection` runs `setData([])` inside an effect before an
 *    `onSnapshot` subscription settles, which is the asynchronous window
 *    AGL-785 pointed at.
 *
 * So: a regression guard for a loop already "fixed" twice, and evidence that
 * this panel is not the origin. Settling AGL-788 still needs the production
 * runtime, or a harness that mounts the whole marketplace page.
 */

const firestoreCollections: Record<string, any[]> = {}

// The real `useFirestore()` hands back one long-lived Firestore instance, so
// a hook keyed on its identity re-runs only when the app itself changes it.
// Returning a fresh `{}` per call made that identity change on EVERY render,
// which re-fired `useConfirmedDoc`'s effect, which `setState`s unconditionally
// at its top — an infinite render loop manufactured entirely by the fixture.
// It surfaced when AGL-2078 gave this panel `useCurrentOrg`, and it does not
// fail: the loop runs through passive effects and microtasks, which starves
// jest's real-timer testTimeout, so the suite hangs instead of going red.
const FIRESTORE = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  limit: () => ({}),
  query: (ref: any) => ref,
  where: () => ({}),
}))

// The two data hooks resolve from the query's path, so each picker gets its own
// list — the point is to exercise the real component, not a stubbed shell.
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (factory: () => any) => {
    const ref = factory()
    const path: string = ref?.path ?? ''
    const key = Object.keys(firestoreCollections).find((k) => path.endsWith(k))
    return { data: key ? firestoreCollections[key] : [] }
  },
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: { handle: 'test-org', $id: 'org-1' } }),
}))

import OrgPublishPanel from '../components/org-publish-panel.component'

describe('OrgPublishPanel kind switching (AGL-788)', () => {
  beforeEach(() => {
    firestoreCollections['components'] = [
      { $id: 'c1', displayName: 'Site Footer' },
    ]
    firestoreCollections['layouts'] = [{ $id: 'l1', displayName: 'Main' }]
    firestoreCollections['datasets'] = [{ $id: 'd1', displayName: 'Leads' }]
    firestoreCollections['emailTemplates'] = [
      { $id: 'order-receipt', versionId: 'v1' },
    ]
  })

  const panel = (
    <OrgPublishPanel
      orgId="org-1"
      hosts={[
        { id: 'h1', label: 'Northwind Coffee' },
        { id: 'h2', label: 'Second Site' },
      ]}
    />
  )
  const renderPanel = () => render(panel)
  // Next.js leaves `reactStrictMode` at its App Router default (on), so dev
  // double-invokes render and effects and production does not. Rendering the
  // SAME element both ways makes StrictMode the only variable between the two
  // results — which is what turns "it didn't throw" into an attribution.
  const renderPanelStrict = () => render(<StrictMode>{panel}</StrictMode>)

  const selectKind = (label: string) => {
    fireEvent.mouseDown(
      screen.getByRole('combobox', { name: /What to publish/ }),
    )
    fireEvent.click(screen.getByRole('option', { name: label }))
  }

  it('renders without looping', () => {
    expect(() => renderPanel()).not.toThrow()
    expect(screen.getByText('Publish to the marketplace')).toBeTruthy()
  })

  it('survives switching across every artifact kind', () => {
    renderPanel()
    // The dev-server repro is component -> layout; the rest are included so a
    // future loop in any one arm is caught by the same guard.
    expect(() => {
      selectKind('A layout')
      selectKind('A dataset schema')
      selectKind('An email template')
      selectKind('This entire site (as a template)')
      selectKind('A component')
    }).not.toThrow()
  })

  it('switching back and forth repeatedly does not loop', () => {
    renderPanel()
    expect(() => {
      for (let round = 0; round < 5; round += 1) {
        selectKind('A layout')
        selectKind('A component')
      }
    }).not.toThrow()
  })

  // The other half of the experiment. If the panel survives the same
  // interaction UNDER StrictMode too, then StrictMode is not sufficient to
  // trigger it here and this harness does not reproduce the dev server — the
  // remaining suspect being live Firestore subscriptions settling
  // asynchronously, which the mocks resolve synchronously. Either outcome is
  // informative, so this asserts the behaviour rather than a hoped-for result.
  it('behaves the same under StrictMode (attribution check)', () => {
    renderPanelStrict()
    expect(() => {
      for (let round = 0; round < 5; round += 1) {
        selectKind('A layout')
        selectKind('A component')
      }
    }).not.toThrow()
  })
})
