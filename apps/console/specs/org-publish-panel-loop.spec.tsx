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

import { fireEvent, render, screen } from '@testing-library/react'

/**
 * Does changing the publish panel's artifact kind loop? (AGL-788)
 *
 * The console dev server throws "Maximum update depth exceeded" from this
 * select's onChange. AGL-785 closed the same symptom as a dev-only StrictMode
 * artifact, and it is still firing — so the open question is whether the panel
 * has a genuine render loop or whether StrictMode's double-invoke is pushing a
 * borderline-but-correct component over React's limit.
 *
 * This renders the panel WITHOUT StrictMode and drives the same interaction.
 * React's development build (which jest uses) still enforces the update-depth
 * limit, so a genuine loop throws here; a StrictMode-only artifact cannot,
 * because nothing double-invokes. That makes this a decisive experiment rather
 * than a smoke test — and a regression guard for a loop already "fixed" twice.
 */

const firestoreCollections: Record<string, any[]> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
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

  const renderPanel = () =>
    render(
      <OrgPublishPanel
        orgSlug="test-org"
        orgId="org-1"
        hosts={[
          { id: 'h1', label: 'Northwind Coffee' },
          { id: 'h2', label: 'Second Site' },
        ]}
      />,
    )

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
})
