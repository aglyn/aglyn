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

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

/*
 * The reads are mocked at this plugin's own hooks (`./use-submissions`):
 * the list hook records the spec it was asked for, so a spec can hold the
 * query the console's card would run. Writes go through a recorded
 * `firebase/firestore` and a recorded API client.
 */
const mockListSpecs: unknown[] = []
let mockList: Record<string, any> = {}
let mockSubmissions: Record<string, Record<string, unknown> | null> = {}
let mockSites: Record<string, Record<string, unknown>> = {}
let mockForms: Record<string, Record<string, unknown>> = {}
let mockReplies: Record<string, any> = { replies: [], more: false, ready: true }
let mockAccess: Record<string, unknown> = { loaded: true, orgWide: false }
let mockWindowSize = { width: 390, height: 844 }
const mockWrites: Array<{ kind: string; path: string; data?: unknown }> = []

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: async (ref: { path: string }, data: unknown) => {
    mockWrites.push({ kind: 'update', path: ref.path, data })
  },
  deleteDoc: async (ref: { path: string }) => {
    mockWrites.push({ kind: 'delete', path: ref.path })
  },
}))
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
jest.mock('@aglyn/mobile-core', () => {
  class ConsoleApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    ConsoleApiError,
    searchWords: (text: string) => text.split(/\s+/).filter(Boolean),
    useOrgAccess: () => mockAccess,
  }
})
jest.mock('./use-submissions', () => ({
  SENT_REPLIES_LIMIT: 10,
  useSubmissionList: (_firestore: unknown, spec: unknown) => {
    mockListSpecs.push(spec)
    return { rows: [], plan: null, ready: false, error: null, hasMore: false, loadMore: jest.fn(), ...mockList }
  },
  useSubmission: (_firestore: unknown, hostId: string | null, id: string | null) => {
    if (!hostId || !id) return { data: null, ready: false, error: null }
    const data = mockSubmissions[`${hostId}/${id}`]
    return { data: data ? { ...data, $id: id } : null, ready: true, error: null }
  },
  useSubmissionSite: (_firestore: unknown, hostId: string | null) => ({
    data: hostId && mockSites[hostId] ? { ...mockSites[hostId], $id: hostId } : null,
    ready: true,
    error: null,
  }),
  useSentReplies: () => mockReplies,
  useSubmissionForm: (_firestore: unknown, hostId: string | null, formId: string | null) => ({
    data: hostId && formId && mockForms[`${hostId}/${formId}`] ? { ...mockForms[`${hostId}/${formId}`], $id: formId } : null,
    ready: true,
    error: null,
  }),
  useAccountEmail: () => 'owner@example.test',
}))

import {
  getMobileDeepLinks,
  getMobileScreen,
  getMobileTabs,
  resetMobileRegistry,
  resolveMobileLink,
  type MobilePluginContext,
} from '@aglyn/mobile-plugin-host'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { planListQuery } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { registerInboxMobile } from './index'
import { SubmissionDetail } from './submission-detail'
import { orderedSubmissionFields, submissionListSpec, submissionPermissions } from './submission-query'
import SubmissionsScreen, { linkedSubmissionSite } from './submissions-screen'

const ORG = 'org-1'
const HOST = 'site-1'
const UID = 'u-1'

function makeContext(overrides: Partial<MobilePluginContext> = {}) {
  const request = jest.fn(async (_path: string, _init?: Record<string, any>): Promise<any> => ({}))
  return {
    uid: UID,
    orgId: ORG,
    hostId: HOST,
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: {},
    api: { request },
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    ...overrides,
  } as unknown as MobilePluginContext & { api: { request: typeof request }; navigate: jest.Mock }
}

const row = (id: string, data: Record<string, unknown> = {}) => ({
  $id: id,
  hostId: HOST,
  orgId: ORG,
  formId: 'contact',
  formName: 'Contact us',
  fields: { name: 'Priya Nair', email: 'priya@lumen.co', message: 'Do you ship to Canada?' },
  read: false,
  createdAt: { toMillis: () => Date.now() - 5 * 60_000 },
  ...data,
})

/** Answers each alert with the button named `press`, recording that it was shown. */
function answerAlerts(press: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === press)?.onPress?.()
  })
}

beforeEach(() => {
  mockListSpecs.length = 0
  mockWrites.length = 0
  mockList = {}
  mockSubmissions = {}
  mockForms = {}
  mockSites = { [HOST]: { displayName: 'Lumen', subdomain: 'lumen', memberRoles: { [UID]: 'admin' } } }
  mockReplies = { replies: [], more: false, ready: true }
  mockAccess = { loaded: true, orgWide: false }
  mockWindowSize = { width: 390, height: 844 }
  jest.restoreAllMocks()
})

describe('the Inbox mobile registration', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerInboxMobile()
  })

  it('registers the list, the reader and the Inbox tab', async () => {
    expect(getMobileScreen('inbox.submissions')?.requiresSite).toBe(true)
    expect(getMobileScreen('inbox.submission')?.requiresSite).toBe(true)
    expect(getMobileTabs()).toEqual([
      expect.objectContaining({ id: 'inbox.tab', icon: 'mail-outline', order: 30, screen: 'inbox.submissions' }),
    ])
    expect(getMobileDeepLinks().map((link) => link.id).sort()).toEqual(['inbox.page', 'inbox.submissionsPage'])
  })

  it("opens the console's record address for one submission natively", async () => {
    expect(
      resolveMobileLink('https://app.aglyn.com/acme/hosts/shop/inbox/submissions?submission=s1', getMobileDeepLinks()),
    ).toEqual({
      kind: 'screen',
      screen: 'inbox.submissions',
      params: { submission: 's1', orgSlug: 'acme', hostSlug: 'shop' },
    })
  })

  it("opens a new-submission notification's host link natively", async () => {
    // `pluginRecordPageLink('formSubmission', hostId, id)`, as form-submit.ts stores it.
    expect(resolveMobileLink('/site-9/inbox/submissions?submission=s1', getMobileDeepLinks())).toEqual({
      kind: 'screen',
      screen: 'inbox.submissions',
      params: { submission: 's1', orgSlug: 'site-9' },
    })
    expect(resolveMobileLink('/site-9/inbox', getMobileDeepLinks())).toMatchObject({ kind: 'screen', screen: 'inbox.submissions' })
  })

  it("opens the workspace's Inbox natively and leaves the other sections to the console", async () => {
    expect(resolveMobileLink('/acme/inbox/submissions', getMobileDeepLinks())).toMatchObject({
      kind: 'screen',
      params: { orgSlug: 'acme' },
    })
    expect(resolveMobileLink('/acme/hosts/shop/inbox/contacts', getMobileDeepLinks())).toEqual({
      kind: 'console',
      path: '/acme/hosts/shop/inbox/contacts',
    })
  })
})

describe('submissionListSpec', () => {
  const plan = (spec: ReturnType<typeof submissionListSpec>) =>
    spec ? planListQuery(spec.declaration, spec.request, nameSearchNormalizers) : null

  it("asks a site's submissions, newest first, with Read and the search on the query", async () => {
    const spec = submissionListSpec({ scope: 'site', hostId: HOST, orgId: ORG, read: 'false', search: ['canada'] })
    expect(spec?.source).toEqual({ kind: 'collection', path: ['hosts', HOST, 'formSubmissions'] })
    const planned = plan(spec)
    expect(planned?.refused).toEqual([])
    expect(planned?.filters).toEqual(
      expect.arrayContaining([
        { path: 'read', op: '==', value: false },
        { path: 'searchTokens', op: 'array-contains', value: 'canada' },
      ]),
    )
    expect(planned?.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
  })

  it("narrows one form's submissions by the formId scope", async () => {
    const planned = plan(submissionListSpec({ scope: 'site', hostId: HOST, orgId: ORG, formId: 'contact', read: 'all', search: [] }))
    expect(planned?.filters).toEqual([{ path: 'formId', op: '==', value: 'contact' }])
  })

  it("lists every site's through the collection group, narrowed to the org as the rules require", async () => {
    const spec = submissionListSpec({ scope: 'org', hostId: HOST, orgId: ORG, read: 'all', search: [] })
    expect(spec?.source).toEqual({ kind: 'group', collectionId: 'formSubmissions' })
    expect(plan(spec)?.filters).toEqual([{ path: 'orgId', op: '==', value: ORG }])
  })

  it('asks nothing without a subject', async () => {
    expect(submissionListSpec({ scope: 'site', hostId: null, orgId: ORG, read: 'all', search: [] })).toBeNull()
    expect(submissionListSpec({ scope: 'org', hostId: HOST, orgId: null, read: 'all', search: [] })).toBeNull()
  })
})

describe('what a member may do', () => {
  it('reads the host roles the rules and the reply route read', async () => {
    expect(submissionPermissions('admin')).toEqual({ canWrite: true, canReply: true })
    expect(submissionPermissions('author')).toEqual({ canWrite: true, canReply: false })
    expect(submissionPermissions('viewer')).toEqual({ canWrite: false, canReply: false })
  })

  it('takes a host link’s first segment as the site', async () => {
    const context = { hostId: HOST, orgSlug: 'acme' }
    expect(linkedSubmissionSite({ submission: 's1', orgSlug: 'site-9' }, context)).toBe('site-9')
    expect(linkedSubmissionSite({ submission: 's1', orgSlug: 'acme', hostSlug: 'shop' }, context)).toBe(HOST)
    expect(linkedSubmissionSite({ orgSlug: 'site-9' }, context)).toBeNull()
  })
})

describe('orderedSubmissionFields', () => {
  it("puts the values in the form's declared order, under its labels, and keeps the rest after", async () => {
    expect(
      orderedSubmissionFields({ message: 'Hi', email: 'a@b.co', legacy: 'x', name: 'Ann' }, [
        { fieldName: 'name', label: 'Your name' },
        { fieldName: 'email' },
        { fieldName: 'phone', label: 'Phone' },
        { fieldName: 'message', label: 'Message' },
      ]),
    ).toEqual([
      { key: 'name', label: 'Your name', value: 'Ann' },
      { key: 'email', label: 'email', value: 'a@b.co' },
      { key: 'message', label: 'Message', value: 'Hi' },
      { key: 'legacy', label: 'legacy', value: 'x' },
    ])
  })
})

describe('the Inbox list', () => {
  it('shows a skeleton while loading', async () => {
    await render(<SubmissionsScreen params={{}} context={makeContext()} />)
    expect(screen.getByTestId('inbox-loading')).toBeTruthy()
  })

  it('says why it is empty', async () => {
    mockList = { ready: true, rows: [] }
    await render(<SubmissionsScreen params={{}} context={makeContext()} />)
    expect(screen.getByText('No form submissions yet')).toBeTruthy()
  })

  it('says when it could not load', async () => {
    mockList = { ready: true, error: new Error('denied') }
    await render(<SubmissionsScreen params={{}} context={makeContext()} />)
    expect(screen.getByText('Could not load these submissions')).toBeTruthy()
  })

  it('lists senders, marks unread rows and pushes the reader on a phone', async () => {
    mockList = { ready: true, rows: [row('s1'), row('s2', { read: true, fields: { email: 'sam@x.co' } })] }
    const context = makeContext()
    await render(<SubmissionsScreen params={{}} context={context} />)
    expect(screen.getByText('Priya Nair')).toBeTruthy()
    expect(screen.getByText('sam@x.co')).toBeTruthy()
    expect(screen.getByTestId('inbox-unread-s1')).toBeTruthy()
    expect(screen.queryByTestId('inbox-unread-s2')).toBeNull()
    await fireEvent.press(screen.getByTestId('inbox-row-s1'))
    expect(context.navigate).toHaveBeenCalledWith('inbox.submission', { hostId: HOST, id: 's1' })
  })

  it('asks the Read filter on the query', async () => {
    mockList = { ready: true, rows: [] }
    await render(<SubmissionsScreen params={{}} context={makeContext()} />)
    await fireEvent.press(screen.getByTestId('inbox-read-false'))
    expect(mockListSpecs[mockListSpecs.length - 1]).toMatchObject({
      request: { clauses: [{ field: 'read', op: 'equals', value: 'false' }] },
    })
  })

  it("scopes to the form the Forms screens hand over", async () => {
    mockList = { ready: true, rows: [] }
    await render(<SubmissionsScreen params={{ formId: 'contact', formName: 'Contact us' }} context={makeContext()} />)
    expect(screen.getByText('Submissions to Contact us')).toBeTruthy()
    expect(mockListSpecs[mockListSpecs.length - 1]).toMatchObject({ request: { base: [{ path: 'formId', value: 'contact' }] } })
  })

  it("offers every site's to an org-wide member", async () => {
    mockAccess = { loaded: true, orgWide: true }
    mockList = { ready: true, rows: [] }
    await render(<SubmissionsScreen params={{}} context={makeContext()} />)
    await fireEvent.press(screen.getByTestId('inbox-scope-org'))
    expect(mockListSpecs[mockListSpecs.length - 1]).toMatchObject({ source: { kind: 'group' } })
  })

  it('opens a linked submission on arrival', async () => {
    mockList = { ready: true, rows: [] }
    const context = makeContext()
    await render(<SubmissionsScreen params={{ submission: 's7', orgSlug: 'site-9' }} context={context} />)
    expect(context.navigate).toHaveBeenCalledWith('inbox.submission', { hostId: 'site-9', id: 's7' })
  })

  it('shows the list and the reader side by side on a tablet', async () => {
    mockWindowSize = { width: 1180, height: 820 }
    mockList = { ready: true, rows: [row('s1')] }
    mockSubmissions = { [`${HOST}/s1`]: row('s1') }
    const context = makeContext()
    await render(<SubmissionsScreen params={{}} context={context} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    expect(screen.getByText('Pick a submission to read it here')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('inbox-row-s1'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('inbox-field-message')).toBeTruthy()
  })
})

describe('the submission reader', () => {
  const open = async (overrides: Partial<MobilePluginContext> = {}) => {
    const context = makeContext(overrides)
    await render(<SubmissionDetail context={context} hostId={HOST} submissionId="s1" />)
    return context
  }

  it('shows every field as sent, what the route did, and marks it read on opening', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { path: '/contact', routing: { dataset: { name: 'Leads', recordId: 'r1' } } }) }
    mockForms = { [`${HOST}/contact`]: { fields: [{ fieldName: 'message', label: 'Your question' }, { fieldName: 'name' }] } }
    await open()
    expect(screen.getByTestId('inbox-field-name')).toBeTruthy()
    expect(screen.getByText('Your question')).toBeTruthy()
    expect(screen.getByText('Do you ship to Canada?')).toBeTruthy()
    expect(screen.getByText('Saved to Inbox')).toBeTruthy()
    expect(screen.getByText('Added to “Leads” dataset')).toBeTruthy()
    expect(screen.getByTestId('inbox-link-page')).toBeTruthy()
    await waitFor(() =>
      expect(mockWrites).toEqual([{ kind: 'update', path: `hosts/${HOST}/formSubmissions/s1`, data: { read: true } }]),
    )
  })

  it('says a gone submission is gone', async () => {
    await open()
    expect(screen.getByText('That submission is no longer in the Inbox.')).toBeTruthy()
  })

  it('marks it unread with the one field the rules allow', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    await open()
    await fireEvent.press(screen.getByTestId('inbox-toggle-read'))
    await waitFor(() =>
      expect(mockWrites).toContainEqual({ kind: 'update', path: `hosts/${HOST}/formSubmissions/s1`, data: { read: false } }),
    )
  })

  it('deletes only after the console’s confirm, then asks the forms plugin to recount', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    const alert = answerAlerts('Delete')
    const context = await open()
    await fireEvent.press(screen.getByTestId('inbox-delete'))
    expect(alert).toHaveBeenCalledWith('Delete this submission?', 'The submission is removed permanently.', expect.any(Array), expect.any(Object))
    expect(mockWrites).toContainEqual({ kind: 'delete', path: `hosts/${HOST}/formSubmissions/s1` })
    expect(context.api.request).toHaveBeenCalledWith('/api/forms/stats', {
      method: 'POST',
      body: { hostId: HOST, formIds: ['contact'] },
    })
  })

  it('does nothing when the delete is cancelled', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    answerAlerts('Cancel')
    const context = await open()
    await fireEvent.press(screen.getByTestId('inbox-delete'))
    expect(mockWrites.filter((write) => write.kind === 'delete')).toEqual([])
    expect(context.api.request).not.toHaveBeenCalled()
  })

  it('offers no writes to a viewer', async () => {
    mockSites[HOST] = { displayName: 'Lumen', memberRoles: { [UID]: 'viewer' } }
    mockSubmissions = { [`${HOST}/s1`]: row('s1') }
    await open()
    expect(screen.queryByTestId('inbox-delete')).toBeNull()
    expect(screen.queryByTestId('inbox-reply-send')).toBeNull()
    expect(mockWrites).toEqual([])
  })

  it('replies through the console’s reply route, with the site-named default subject', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    const context = await open()
    context.api.request.mockResolvedValueOnce({ sent: true, to: 'priya@lumen.co' })
    expect(screen.getByText('To priya@lumen.co')).toBeTruthy()
    expect(screen.getByTestId('inbox-reply-subject').props.value).toBe('Re: your message to Lumen')
    await fireEvent.changeText(screen.getByTestId('inbox-reply-message'), 'Yes, we do.')
    await fireEvent.press(screen.getByTestId('inbox-reply-send'))
    expect(context.api.request).toHaveBeenCalledWith('/api/inbox/reply', {
      method: 'POST',
      body: { hostId: HOST, submissionId: 's1', subject: 'Re: your message to Lumen', message: 'Yes, we do.' },
    })
    expect(screen.getByTestId('inbox-reply-status').props.children).toBe('Reply sent to priya@lumen.co')
  })

  it("shows the route's refusal", async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    const context = await open()
    const { ConsoleApiError } = jest.requireMock('@aglyn/mobile-core')
    context.api.request.mockRejectedValueOnce(
      new ConsoleApiError('This address unsubscribed from this site, so it cannot be mailed.', 409),
    )
    await fireEvent.changeText(screen.getByTestId('inbox-reply-message'), 'Hello')
    await fireEvent.press(screen.getByTestId('inbox-reply-send'))
    expect(screen.getByText('This address unsubscribed from this site, so it cannot be mailed.')).toBeTruthy()
  })

  it('says there is nobody to reply to without an email field', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true, fields: { name: 'Anon', message: 'Hi' } }) }
    await open()
    expect(screen.getByText('This submission has no email field, so there is nobody to reply to.')).toBeTruthy()
  })

  it('lists the replies already sent', async () => {
    mockSubmissions = { [`${HOST}/s1`]: row('s1', { read: true }) }
    mockReplies = { replies: [{ $id: 'r1', to: 'priya@lumen.co', message: 'Thanks!', sentAtMs: 1 }], more: true, ready: true }
    await open()
    expect(screen.getByText('Replies sent')).toBeTruthy()
    expect(screen.getByText('Thanks!')).toBeTruthy()
    expect(screen.getByText('Showing the 10 most recent. This thread has more.')).toBeTruthy()
  })
})
