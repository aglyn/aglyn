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

import { fireEvent, render, screen } from '@testing-library/react-native'

/*
 * The reads are mocked at `@aglyn/mobile-core`: the list hook records what
 * it was asked to plan, and documents come from a table here.
 */
const mockListCalls: Array<Record<string, any>> = []
let mockListResult: Record<string, any> = {}
let mockDocs: Record<string, Record<string, unknown> | null> = {}
let mockWindowSize = { width: 390, height: 844 }

jest.mock('firebase/firestore', () => ({}))
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = jest.requireActual('react')
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default
  const MockScrollView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: () => undefined, scrollToEnd: () => undefined, getScrollableNode: () => null, getScrollResponder: () => null, getNativeScrollRef: () => null, flashScrollIndicators: () => undefined }))
    const { children, refreshControl: _refresh, contentContainerStyle, ...rest } = props
    return React.createElement(View, rest, React.createElement(View, { style: contentContainerStyle }, children))
  })
  MockScrollView.Context = React.createContext(null)
  return { __esModule: true, default: MockScrollView }
})
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }))
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindowSize, scale: 2, fontScale: 1 }),
}))
jest.mock('@aglyn/mobile-core', () => ({
  searchWords: (text: string) => text.split(/\s+/).filter(Boolean),
  useMobileListQuery: (options: Record<string, any>) => {
    mockListCalls.push(options)
    return {
      rows: [],
      ready: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      plan: { notices: [], refused: [] },
      ...mockListResult,
    }
  },
  useLiveDoc: (_firestore: unknown, path: readonly string[] | null) => {
    if (!path || !path.every(Boolean)) return { data: null, ready: false, error: null }
    const data = mockDocs[path.join('/')]
    return { data: data ? { ...data, $id: path[path.length - 1] } : null, ready: true, error: null }
  },
}))

import {
  getMobileDeepLinks,
  getMobileQuickActions,
  getMobileScreen,
  registerMobileScreen,
  resetMobileRegistry,
  resolveMobileLink,
  type MobilePluginContext,
} from '@aglyn/mobile-plugin-host'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { planListQuery } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { FORM_LIST_QUERY } from '../lib/constants/form-list-query'
import { FormDetail } from './form-detail'
import FormsListScreen, { formRowSummary } from './forms-list-screen'
import { registerFormsMobile } from './index'
import { formsRequest } from './use-forms'

const HOST = 'site-1'

function makeContext(overrides: Partial<MobilePluginContext> = {}) {
  return {
    uid: 'u-1',
    orgId: 'org-1',
    hostId: HOST,
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: {},
    api: { request: jest.fn() },
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    ...overrides,
  } as unknown as MobilePluginContext & { navigate: jest.Mock; openConsolePath: jest.Mock }
}

const form = (id: string, data: Record<string, unknown> = {}) => ({
  $id: id,
  displayName: 'Contact us',
  slug: 'contact-us',
  retired: false,
  routing: { lead: true },
  stats: { submissions: 12, leads: 7, views: 340, lastSubmissionAtMs: Date.UTC(2026, 9, 6) },
  ...data,
})

beforeEach(() => {
  mockListCalls.length = 0
  mockListResult = {}
  mockDocs = {}
  mockWindowSize = { width: 390, height: 844 }
  resetMobileRegistry()
})

describe('the Forms mobile registration', () => {
  beforeEach(() => registerFormsMobile())

  it('registers the forms list, one form and the Form submissions quick action', async () => {
    expect(getMobileScreen('forms.list')?.requiresSite).toBe(true)
    expect(getMobileScreen('forms.form')?.requiresSite).toBe(true)
    expect(getMobileQuickActions()).toEqual([
      expect.objectContaining({ id: 'forms.submissions', title: 'Form submissions', screen: 'forms.list' }),
    ])
  })

  it("opens the console's Forms pages natively", async () => {
    expect(resolveMobileLink('https://app.aglyn.com/acme/hosts/shop/forms', getMobileDeepLinks())).toEqual({
      kind: 'screen',
      screen: 'forms.list',
      params: { orgSlug: 'acme', hostSlug: 'shop' },
    })
    expect(resolveMobileLink('/acme/hosts/shop/forms/contact', getMobileDeepLinks())).toEqual({
      kind: 'screen',
      screen: 'forms.form',
      params: { orgSlug: 'acme', hostSlug: 'shop', formId: 'contact' },
    })
  })
})

describe('the forms query', () => {
  it("is the console's: Status and the search on one query, in document order", async () => {
    const plan = planListQuery(FORM_LIST_QUERY, formsRequest('false', 'contact'), nameSearchNormalizers)
    expect(plan.refused).toEqual([])
    expect(plan.filters).toEqual(
      expect.arrayContaining([
        { path: 'retired', op: '==', value: false },
        { path: 'searchTokens', op: 'array-contains', value: 'contact' },
      ]),
    )
    expect(plan.orderBy).toEqual({ path: '__name__', direction: 'asc' })
  })

  it('summarizes what a form collected', async () => {
    expect(formRowSummary(form('a', { stats: { submissions: null } }))).toBe('No submissions yet')
    expect(formRowSummary(form('a', { stats: { submissions: 1 } }))).toBe('1 submission')
  })
})

describe('the forms list', () => {
  it('shows a skeleton while loading', async () => {
    await render(<FormsListScreen params={{}} context={makeContext()} />)
    expect(screen.getByTestId('forms-loading')).toBeTruthy()
  })

  it('says why it is empty, and when it could not load', async () => {
    mockListResult = { ready: true, rows: [] }
    const { unmount } = await render(<FormsListScreen params={{}} context={makeContext()} />)
    expect(screen.getByText('No forms yet')).toBeTruthy()
    await unmount()
    mockListResult = { ready: true, rows: [], error: new Error('denied') }
    await render(<FormsListScreen params={{}} context={makeContext()} />)
    expect(screen.getByText("Could not load this site's forms")).toBeTruthy()
  })

  it("reads the site's forms and asks Status on the query", async () => {
    mockListResult = { ready: true, rows: [form('contact')] }
    await render(<FormsListScreen params={{}} context={makeContext()} />)
    expect(mockListCalls[0]).toMatchObject({ path: ['hosts', HOST, 'forms'], declaration: FORM_LIST_QUERY })
    expect(screen.getByText('Contact us')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('forms-status-true'))
    expect(mockListCalls[mockListCalls.length - 1].request.clauses).toEqual([
      { field: 'status', op: 'equals', value: 'true' },
    ])
  })

  it('pushes a form on a phone', async () => {
    mockListResult = { ready: true, rows: [form('contact')] }
    const context = makeContext()
    await render(<FormsListScreen params={{}} context={context} />)
    await fireEvent.press(screen.getByTestId('form-row-contact'))
    expect(context.navigate).toHaveBeenCalledWith('forms.form', { formId: 'contact' })
  })

  it('shows the list and the form side by side on a tablet', async () => {
    mockWindowSize = { width: 1180, height: 820 }
    mockListResult = { ready: true, rows: [form('contact')] }
    mockDocs = { [`hosts/${HOST}/forms/contact`]: form('contact') }
    const context = makeContext()
    await render(<FormsListScreen params={{}} context={context} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('form-row-contact'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(screen.getByText('What this form has collected')).toBeTruthy()
  })
})

describe('one form', () => {
  it("shows the console's figures and hands its submissions to the Inbox's reader", async () => {
    registerMobileScreen({ pluginId: 'inbox', id: 'inbox.submissions', title: 'Inbox', load: async () => ({ default: () => null }) })
    mockDocs = { [`hosts/${HOST}/forms/contact`]: form('contact') }
    const context = makeContext()
    await render(<FormDetail context={context} formId="contact" />)
    expect(screen.getByTestId('form-submissions')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('340')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('form-show-submissions'))
    expect(context.navigate).toHaveBeenCalledWith('inbox.submissions', { formId: 'contact', formName: 'Contact us' })
  })

  it('says the Inbox is off when nothing reads submissions', async () => {
    mockDocs = { [`hosts/${HOST}/forms/contact`]: form('contact') }
    await render(<FormDetail context={makeContext()} formId="contact" />)
    expect(screen.getByTestId('form-no-reader')).toBeTruthy()
    expect(screen.queryByTestId('form-show-submissions')).toBeNull()
  })

  it('says a gone form is gone', async () => {
    await render(<FormDetail context={makeContext()} formId="gone" />)
    expect(screen.getByText('This form is no longer on the site')).toBeTruthy()
  })
})
