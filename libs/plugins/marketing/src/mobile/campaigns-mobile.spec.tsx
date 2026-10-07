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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'

/*
 * The data layer is mocked at `@aglyn/mobile-core`: the list and the
 * documents come from tables here, and the list hook records the query it
 * was asked to plan, so a spec can hold the declaration and the request.
 */
const mockListCalls: Array<Record<string, any>> = []
let mockListResult: Record<string, any> = {}
let mockDocs: Record<string, Record<string, unknown> | null> = {}
let mockAccess: Record<string, unknown> = { loaded: true, orgWide: true }
let mockWindowSize = { width: 390, height: 844 }

jest.mock('firebase/firestore', () => ({}))
// RN 0.86's ScrollView loads codegen specs this jest does not transform; a plain
// container stands in for it (FlatList and Screen render through it).
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
// The same for Modal, which the Sheet opens.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = jest.requireActual('react')
  const View = jest.requireActual('react-native/Libraries/Components/View/View').default
  const MockModal = (props: Record<string, any>) => (props.visible ? React.createElement(View, null, props.children) : null)
  return { __esModule: true, default: MockModal }
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
    return { rows: [], ready: false, error: null, hasMore: false, loadMore: jest.fn(), ...mockListResult }
  },
  useLiveDoc: (_firestore: unknown, path: readonly string[] | null) => {
    if (!path || !path.every(Boolean)) return { data: null, ready: false, error: null }
    const key = path.join('/')
    const data = mockDocs[key]
    return { data: data ? { $id: path[path.length - 1], ...data } : null, ready: true, error: null }
  },
  useOrgAccess: () => mockAccess,
}))

import {
  getMobileDeepLinks,
  getMobileQuickActions,
  getMobileScreen,
  resetMobileRegistry,
  resolveMobileLink,
  type MobilePluginContext,
} from '@aglyn/mobile-plugin-host'
import { campaignEmailsListQuery } from '../lib/model/campaign-list-query'
import { CampaignSendDetail } from './campaign-send-detail'
import { campaignSendControls, testMessageFromRecord, type CampaignSendRecord } from './campaign-sends'
import CampaignsListScreen from './campaigns-list-screen'
import { registerMarketingMobile } from './index'

const ORG = 'org-1'
const HOST = 'site-1'
const UID = 'u-1'

function makeContext(overrides: Partial<MobilePluginContext> = {}) {
  const request = jest.fn(async (_path: string, _init?: Record<string, any>): Promise<any> => ({}))
  const context = {
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
  } as unknown as MobilePluginContext & { api: { request: typeof request } }
  return context
}

const sendPath = (id: string) => `orgs/${ORG}/campaigns/${id}`

function seedSend(id: string, data: Record<string, unknown>) {
  mockDocs[sendPath(id)] = { hostId: HOST, visibleTo: [`host:${HOST}`], subject: 'Fall sale', ...data }
}

/** Presses the alert's confirm button, recording that it was shown. */
function acceptAlerts() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.[1]?.onPress?.()
  })
}

beforeEach(() => {
  mockListCalls.length = 0
  mockListResult = {}
  mockDocs = { [`hosts/${HOST}`]: { memberRoles: { [UID]: 'admin' } } }
  mockAccess = { loaded: true, orgWide: true }
  mockWindowSize = { width: 390, height: 844 }
  jest.restoreAllMocks()
})

describe('the Marketing mobile registration', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerMarketingMobile()
  })

  it('registers the list, the email screen and the quick action', async () => {
    expect(getMobileScreen('marketing.campaigns')?.title).toBe('Email campaigns')
    expect(getMobileScreen('marketing.campaign')).toBeTruthy()
    expect(getMobileQuickActions().map((action) => action.id)).toEqual(['marketing.open'])
    expect(getMobileQuickActions()[0].screen).toBe('marketing.campaigns')
  })

  it.each([
    ['https://app.aglyn.com/acme/hosts/shop/emails/messages', 'marketing.campaigns', {}],
    ['https://app.aglyn.com/acme/emails/messages/send-9', 'marketing.campaign', { emailId: 'send-9' }],
    // The staff hold notice's link for a held campaign email.
    ['/org/emails/messages/send-9', 'marketing.campaign', { emailId: 'send-9' }],
    ['https://app.aglyn.com/acme/hosts/shop/marketing/campaigns', 'marketing.campaigns', {}],
    ['https://app.aglyn.com/acme/marketing/campaigns/c-1', 'marketing.campaign', { campaignId: 'c-1' }],
  ])('opens %s natively', (link, screenId, params) => {
    const target = resolveMobileLink(link, getMobileDeepLinks())
    expect(target).toMatchObject({ kind: 'screen', screen: screenId, params })
  })

  it('leaves the composer to the console', async () => {
    expect(resolveMobileLink('/acme/hosts/shop/emails/messages/send-9/edit', getMobileDeepLinks())).toEqual({
      kind: 'console',
      path: '/acme/hosts/shop/emails/messages/send-9/edit',
    })
  })
})

describe('the email list', () => {
  it('plans the console Emails query under the site, with its status and search', async () => {
    await render(<CampaignsListScreen context={makeContext()} params={{}} />)
    expect(screen.getByTestId('campaigns-loading')).toBeTruthy()
    let last = mockListCalls[mockListCalls.length - 1]
    expect(last.path).toEqual(['orgs', ORG, 'campaigns'])
    expect(last.declaration).toBe(campaignEmailsListQuery(false))
    expect(last.request).toEqual({ clauses: [], search: [], base: [{ path: 'hostId', op: '==', value: HOST }] })

    mockListResult = { ready: true }
    await fireEvent.press(screen.getByTestId('campaigns-status-scheduled'))
    await fireEvent.changeText(screen.getByTestId('campaigns-search'), 'fall sale')
    last = mockListCalls[mockListCalls.length - 1]
    expect(last.request.clauses).toEqual([{ field: 'status', op: 'equals', value: 'scheduled' }])
    expect(last.request.search).toEqual(['fall', 'sale'])
    expect(screen.getByText('No emails match')).toBeTruthy()
  })

  it('reads the whole workspace for an org-wide member with no site, and asks others for a site', async () => {
    const { unmount } = await render(<CampaignsListScreen context={makeContext({ hostId: null })} params={{}} />)
    const last = mockListCalls[mockListCalls.length - 1]
    expect(last.declaration).toBe(campaignEmailsListQuery(true))
    expect(last.request.base).toEqual([])
    expect(last.enabled).toBe(true)
    await unmount()
    mockAccess = { loaded: true, orgWide: false }
    await render(<CampaignsListScreen context={makeContext({ hostId: null })} params={{}} />)
    expect(screen.getByText('Choose a site to see its emails')).toBeTruthy()
  })

  it('says when there are none, and when the read failed', async () => {
    mockListResult = { ready: true }
    const { unmount } = await render(<CampaignsListScreen context={makeContext()} params={{}} />)
    expect(screen.getByText('No emails yet')).toBeTruthy()
    await unmount()
    mockListResult = { ready: true, error: new Error('Missing or insufficient permissions.') }
    await render(<CampaignsListScreen context={makeContext()} params={{}} />)
    expect(screen.getByText('Could not load emails')).toBeTruthy()
  })

  it('draws each row by what the email is doing, and pushes its report on a phone', async () => {
    mockListResult = {
      ready: true,
      rows: [
        { $id: 'a', subject: 'Spring', status: 'draft' },
        { $id: 'b', subject: 'Batching', status: 'scheduled', stats: { sent: 500, audienceSize: 900 }, resume: { remaining: 400, nextAtMs: 9e12 } },
      ],
    }
    const context = makeContext()
    await render(<CampaignsListScreen context={context} params={{}} />)
    expect(screen.getByText('Spring')).toBeTruthy()
    expect(screen.getByText(/Sending — reached 500 of 900/)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('campaign-a'))
    expect(context.navigate).toHaveBeenCalledWith('marketing.campaign', { emailId: 'a' })
  })

  it('shows the list and the report side by side on a tablet', async () => {
    mockWindowSize = { width: 1180, height: 820 }
    mockListResult = { ready: true, rows: [{ $id: 'a', subject: 'Spring', status: 'draft' }] }
    seedSend('a', { subject: 'Spring', status: 'draft' })
    const context = makeContext()
    await render(<CampaignsListScreen context={context} params={{}} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    expect(screen.getByText('Pick an email to see it here')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('campaign-a'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('campaign-unsent')).toBeTruthy()
  })
})

describe("an email's report", () => {
  it('reads the stats the way the console does: denominators named, unrecorded as a dash', async () => {
    seedSend('s1', {
      status: 'sent',
      sentAt: { seconds: 1_790_000_000 },
      audience: 'list',
      listName: 'Newsletter',
      sentAs: { from: 'hello@acme.test', fromName: 'Acme' },
      stats: { recipients: 1000, sent: 1000, delivered: 980, bounced: 20, uniqueOpens: 490, opens: 700, clicks: 120, uniqueClicks: 98, clickTracked: true, unsubscribes: 3 },
    })
    mockDocs[`${sendPath('s1')}/reports/links`] = { links: { a: { url: 'https://acme.test/sale', clicks: 90 } } }
    await render(<CampaignSendDetail context={makeContext()} sendId="s1" />)
    expect(screen.getByText('Newsletter')).toBeTruthy()
    expect(screen.getByText('hello@acme.test')).toBeTruthy()
    expect(screen.getByText('980')).toBeTruthy()
    expect(screen.getByText('50.0% · 490 of 980 delivered')).toBeTruthy()
    expect(screen.getByText('10.0% · 98 of 980 delivered')).toBeTruthy()
    expect(screen.getByText('98.0% · 980 of 1,000 sent')).toBeTruthy()
    expect(screen.getByText('https://acme.test/sale')).toBeTruthy()
    // A sent email's one act is reaching more people.
    expect(screen.getByTestId('campaign-follow-up')).toBeTruthy()
    expect(screen.queryByTestId('campaign-send-now')).toBeNull()
  })

  it('withholds rates whose denominator was never recorded', async () => {
    seedSend('s2', { status: 'sent', stats: { sent: 100, recipients: 100, uniqueOpens: 10 } })
    await render(<CampaignSendDetail context={makeContext()} sendId="s2" />)
    expect(screen.getAllByText('— not enough recorded to compute').length).toBeGreaterThan(3)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('has no report while unsent, and offers no action to a site viewer', async () => {
    seedSend('d1', { status: 'draft' })
    mockDocs[`hosts/${HOST}`] = { memberRoles: { [UID]: 'viewer' } }
    await render(<CampaignSendDetail context={makeContext()} sendId="d1" />)
    expect(screen.getByTestId('campaign-unsent')).toBeTruthy()
    expect(screen.queryByTestId('campaign-send-now')).toBeNull()
    expect(screen.queryByTestId('campaign-test')).toBeNull()
    expect(screen.getByText(/Only an admin or editor/)).toBeTruthy()
  })

  it('sends a held email nowhere and says why', async () => {
    seedSend('h1', { status: 'scheduled', sendAtMs: 9e12, staffReview: { state: 'held', reference: 'HS-1' } })
    await render(<CampaignSendDetail context={makeContext()} sendId="h1" />)
    expect(screen.getByText(/held for review before it sends/)).toBeTruthy()
    expect(screen.queryByTestId('campaign-send-now')).toBeNull()
    expect(screen.queryByTestId('campaign-test')).toBeNull()
    // Withdrawing it stays the merchant's.
    expect(screen.getByTestId('campaign-cancel')).toBeTruthy()
  })

  it('offers a container its console page', async () => {
    mockDocs[`orgs/${ORG}/emailCampaigns/c-1`] = { name: 'Spring launch' }
    const context = makeContext()
    await render(<CampaignSendDetail context={context} sendId="c-1" />)
    await fireEvent.press(screen.getByText('Open in the console'))
    expect(context.openConsolePath).toHaveBeenCalledWith('/marketing/campaigns/c-1', 'site')
  })

  it('opens the composer in the console to write it', async () => {
    seedSend('d1', { status: 'draft' })
    const context = makeContext()
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await fireEvent.press(screen.getByTestId('campaign-write'))
    expect(context.openConsolePath).toHaveBeenCalledWith('/emails/messages/d1/edit', 'site')
  })
})

describe('sending', () => {
  it('counts first, confirms with the count, then sends through the console route', async () => {
    seedSend('d1', { status: 'scheduled', sendAtMs: 9e12 })
    const context = makeContext()
    context.api.request.mockImplementation(async (_path, init) => (init?.body?.dryRun ? { sendable: 42 } : { sent: 42 }))
    const alert = acceptAlerts()
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-send-now'))
    })
    expect(context.api.request.mock.calls[0]).toEqual([
      '/api/campaigns/send',
      { method: 'POST', body: { action: 'sendNow', campaignId: 'd1', dryRun: true, hostId: HOST } },
    ])
    expect(alert).toHaveBeenCalledWith(
      'Send this email now?',
      'This sends it to 42 people straight away, instead of at the time it is scheduled for. It cannot be taken back once it goes.',
      expect.any(Array),
      expect.any(Object),
    )
    await waitFor(() => expect(context.api.request).toHaveBeenCalledTimes(2))
    expect(context.api.request.mock.calls[1]).toEqual([
      '/api/campaigns/send',
      { method: 'POST', body: { action: 'sendNow', campaignId: 'd1', hostId: HOST } },
    ])
    expect(await screen.findByText('Sent to 42 recipients')).toBeTruthy()
  })

  it('sends nothing when the confirmation is declined', async () => {
    seedSend('d1', { status: 'draft' })
    const context = makeContext()
    context.api.request.mockResolvedValue({ sendable: 3 })
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.())
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-send-now'))
    })
    expect(context.api.request).toHaveBeenCalledTimes(1)
  })

  it("shows the route's refusal", async () => {
    seedSend('d1', { status: 'draft' })
    const context = makeContext()
    context.api.request.mockRejectedValue(new Error('You have used this month’s email allowance'))
    const alert = acceptAlerts()
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-send-now'))
    })
    expect(alert).not.toHaveBeenCalled()
    expect(screen.getByTestId('campaign-notice').props.children).toBe('You have used this month’s email allowance')
  })

  it('reaches more people with a follow-up, naming who already has it', async () => {
    seedSend('s1', { status: 'sent', stats: { sent: 10 } })
    const context = makeContext()
    context.api.request.mockImplementation(async (_p, init) =>
      init?.body?.dryRun ? { sendable: 5, alreadyReached: 10 } : { sent: 5 },
    )
    const alert = acceptAlerts()
    await render(<CampaignSendDetail context={context} sendId="s1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-follow-up'))
    })
    expect(alert.mock.calls[0][0]).toBe('Send this email to more people?')
    expect(alert.mock.calls[0][1]).toContain('The 10 who already received it')
    await waitFor(() =>
      expect(context.api.request.mock.calls[1][1]).toEqual({
        method: 'POST',
        body: { action: 'followUp', campaignId: 's1', hostId: HOST },
      }),
    )
  })

  it('cancels a scheduled email after the console’s confirmation', async () => {
    seedSend('c1', { status: 'scheduled', sendAtMs: 9e12 })
    const context = makeContext()
    const alert = acceptAlerts()
    await render(<CampaignSendDetail context={context} sendId="c1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-cancel'))
    })
    expect(alert.mock.calls[0][0]).toBe('Cancel this scheduled email?')
    expect(context.api.request).toHaveBeenCalledWith('/api/campaigns/send', {
      method: 'POST',
      body: { action: 'cancel', campaignId: 'c1', hostId: HOST },
    })
  })

  it('names the site the send is sent as on the workspace', async () => {
    mockDocs[`hosts/site-2`] = { memberRoles: { [UID]: 'editor' } }
    seedSend('d1', { status: 'draft', hostId: 'site-2' })
    const context = makeContext({ hostId: null })
    context.api.request.mockResolvedValue({ sendable: 1 })
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await act(async () => {
      await fireEvent.press(screen.getByTestId('campaign-send-now'))
    })
    expect(context.api.request.mock.calls[0][1].body.hostId).toBe('site-2')
  })
})

describe('a test send', () => {
  it('asks who it may go to, then mails the stored message to the one address chosen', async () => {
    seedSend('d1', {
      status: 'draft',
      subject: 'Hello',
      body: 'Hi {{firstName|there}}',
      fromName: 'Acme',
      emailCampaignId: 'c-1',
    })
    const context = makeContext()
    context.api.request.mockImplementation(async (_p, init) =>
      init?.body?.action === 'proofOptions'
        ? {
            recipients: [
              { email: 'me@acme.test', label: 'You', self: true },
              { email: 'pat@acme.test', label: 'Pat', self: false },
            ],
            personas: [{ email: 'lee@x.test', name: 'Lee', source: 'lead' }],
          }
        : { to: 'pat@acme.test', test: true },
    )
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await fireEvent.press(screen.getByTestId('campaign-test'))
    expect(await screen.findByText('me@acme.test (you)')).toBeTruthy()
    expect(context.api.request.mock.calls[0]).toEqual([
      '/api/campaigns/send',
      { method: 'POST', body: { action: 'proofOptions', hostId: HOST } },
    ])
    await fireEvent.press(screen.getByTestId('test-to-pat@acme.test'))
    await fireEvent.press(screen.getByTestId('test-persona-lee@x.test'))
    expect(screen.getByTestId('test-summary').props.children).toContain('We will send one copy to pat@acme.test')
    await act(async () => {
      await fireEvent.press(screen.getByTestId('test-send'))
    })
    expect(context.api.request.mock.calls[1]).toEqual([
      '/api/campaigns/send',
      {
        method: 'POST',
        body: {
          subject: 'Hello',
          body: 'Hi {{firstName|there}}',
          fromName: 'Acme',
          replyTo: '',
          preheader: '',
          emailCampaignId: 'c-1',
          action: 'test',
          to: 'pat@acme.test',
          personaEmail: 'lee@x.test',
          hostId: HOST,
        },
      },
    ])
    expect(await screen.findByText('Sent to pat@acme.test.')).toBeTruthy()
  })

  it("shows the route's refusal of a test", async () => {
    seedSend('d1', { status: 'draft', subject: 'Hello', body: 'x' })
    const context = makeContext()
    context.api.request.mockImplementation(async (_p, init) => {
      if (init?.body?.action === 'proofOptions') return { recipients: [{ email: 'me@acme.test', label: 'You', self: true }] }
      throw new Error('Verify your email to continue')
    })
    await render(<CampaignSendDetail context={context} sendId="d1" />)
    await fireEvent.press(screen.getByTestId('campaign-test'))
    await screen.findByText('me@acme.test (you)')
    await act(async () => {
      await fireEvent.press(screen.getByTestId('test-send'))
    })
    expect(screen.getByTestId('test-error').props.children).toBe('Verify your email to continue')
  })
})

describe('the controls and the test message', () => {
  it('match the console email page state by state', async () => {
    const of = (send: Partial<CampaignSendRecord>) => campaignSendControls({ $id: 'x', ...send } as CampaignSendRecord)
    expect(of({ status: 'draft' })).toMatchObject({ sendNow: true, cancel: false, compose: true, followUp: false })
    expect(of({ status: 'scheduled' })).toMatchObject({ sendNow: true, cancel: true, compose: true })
    expect(of({ status: 'sent', stats: { sent: 3 } })).toMatchObject({ sendNow: false, followUp: true, compose: false })
    expect(
      of({ status: 'scheduled', stats: { sent: 3 }, resume: { remaining: 2, nextAtMs: 5 } }),
    ).toMatchObject({ sendNow: false, stop: true, cancel: false, compose: false })
    expect(of({ status: 'canceled' })).toMatchObject({ sendNow: false, followUp: false, cancel: false, stop: false })
  })

  it('sends a designed email’s text half and never a body beside its template', async () => {
    expect(
      testMessageFromRecord({ $id: 'x', subject: '', body: 'stale', templateScreenId: 't1', plainText: 'Text' } as CampaignSendRecord),
    ).toEqual({ subject: 'Test send', body: '', fromName: '', replyTo: '', preheader: '', templateScreenId: 't1', plainText: 'Text' })
  })
})
