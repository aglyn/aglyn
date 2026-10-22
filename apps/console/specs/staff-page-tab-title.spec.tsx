/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

import { render } from '@testing-library/react'

/**
 * A plugin's staff page names itself in the browser tab (AGL-3005).
 *
 * `/admin/[staffPage]` is the staff area's generic plugin route. Its server
 * layout titles the tab with the id from the URL — `assist-signals · Staff
 * page · …` — because the staff registry only fills on the client, and a
 * server layout that reached it would pull plugin components into the server
 * compile. The page resolves the registered page on the client anyway, so it
 * publishes the page's label as the tab's subject, the way the staff org and
 * user pages publish a loaded name.
 *
 * The subject STORE is asserted, not `document.title`: the rewrite from
 * subject to tab is pinned against the real component in
 * `entity-tab-title.spec.tsx`.
 */

const mockStaffPageId = 'signals-board'
let mockResolvedPage: Record<string, unknown> | undefined
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ staffPage: mockStaffPageId }),
  notFound: () => mockNotFound(),
}))

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  resolveConsoleStaffPage: () => mockResolvedPage,
}))

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ICON_VARIANT_SYMBOL_SECURE: { path: '' },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  resolveDocsHelpTopic: () => undefined,
}))

jest.mock('../constants/route-links', () => ({
  __esModule: true,
  Route: {
    ADMIN_OVERVIEW: '/admin',
    ADMIN_STAFF_PAGE: '/admin/[staffPage]',
    ADMIN_ORG_DETAIL: '/admin/orgs/[orgId]',
  },
  buildRoute: (route: string, params?: { staffPage?: string; orgId?: string }) =>
    route
      .replace('[staffPage]', params?.staffPage ?? '')
      .replace('[orgId]', params?.orgId ?? ''),
}))

// The shared staff page reads the viewer's ROLE to hand it to a plugin
// (AGL-3080). Not this file's subject, and reaching the real hook would drag
// the Firebase provider into a spec about a document title.
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  default: () => true,
  useIsStaff: () => true,
  useStaffRole: () => 'super',
}))

jest.mock('../constants/staff-plugins', () => ({
  __esModule: true,
  STAFF_PLUGIN_IDS: ['staff-test-plugin'],
}))

jest.mock('../constants/shared', () => ({
  __esModule: true,
  CONTENT_MAX_WIDTH: 'lg',
}))

import AdminStaffPluginPage from '../app/(app)/admin/[staffPage]/page'
import {
  getDocumentSubject,
  resetDocumentSubject,
} from '../components/document-subject'

/** A page as the staff registry answers it, with any field overridden. */
const registeredPage = (overrides: Record<string, unknown> = {}) => ({
  id: mockStaffPageId,
  label: 'Signals board',
  Component: () => null,
  ...overrides,
})

describe("a plugin's staff page names itself in the tab (AGL-3005)", () => {
  beforeEach(() => {
    resetDocumentSubject()
    mockNotFound.mockClear()
    mockResolvedPage = registeredPage()
  })

  afterEach(() => {
    resetDocumentSubject()
    jest.restoreAllMocks()
  })

  it('states its premise: nothing is published before the page renders', () => {
    // The instrument before it is trusted: a subject already in the store
    // would let every assertion below pass without the page.
    expect(getDocumentSubject()).toBeNull()
  })

  it('publishes the label against the id the layout titled the tab with', () => {
    render(<AdminStaffPluginPage />)
    expect(getDocumentSubject()).toEqual({
      id: 'signals-board',
      name: 'Signals board',
    })
  })

  it('names the page by its label, not a header title that carries the brand', () => {
    // The title template already appends the brand, so a branded header title
    // would say it twice in a tab that shows about twenty characters.
    mockResolvedPage = registeredPage({
      header: { title: 'Northwind Signals Board' },
    })
    render(<AdminStaffPluginPage />)
    expect(getDocumentSubject()?.name).toBe('Signals board')
  })

  it('does not strand the label in a tab that has navigated away', () => {
    const view = render(<AdminStaffPluginPage />)
    view.unmount()
    expect(getDocumentSubject()).toBeNull()
  })

  it('publishes nothing for an id no plugin registered', () => {
    mockResolvedPage = undefined
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    // Whether `render` rethrows the not-found throw depends on the React
    // version; either way the page must ask for the 404 and commit no effect.
    try {
      render(<AdminStaffPluginPage />)
    } catch {
      // The not-found throw, surfaced by the renderer.
    }
    expect(mockNotFound).toHaveBeenCalled()
    expect(getDocumentSubject()).toBeNull()
  })
})
