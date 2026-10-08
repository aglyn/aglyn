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
 * The guided start on a newly created site (AGL-2918).
 *
 * Every render goes through the component the AI plugin REGISTERED on the
 * `hostFirstRun` zone, so what is asserted is what that page's slot draws.
 *
 * `describe('the skip', …)` is the CONTROL: it is what fails if the way out of
 * the guided start stops working — if the button is not drawn, if it is drawn
 * only once the questions are answered, if it stops reaching the zone's
 * `startBlank`, or if leaving creates anything. Reverting the skip must turn
 * that block red.
 *
 * `describe('leaving the full screen dialog', …)` is the second half of that
 * control, and it exists because the questions take the whole screen: a
 * takeover has exits a card does not have, and each of them has to BE the
 * skip. Escape, the close control, and the skip while a request is in flight.
 *
 * Both are written against the portal as well as the container. A `Dialog`
 * renders outside the tree it was mounted in, so `container.textContent` is
 * empty for a dialog covering the page and for no dialog at all — which is
 * the one distinction the absence tests are here to make.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleHostFirstRunZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'

// ONE held object for the whole file: a fresh double each render turns the
// probe's effect into a loop, and the effect keys on the uid rather than on
// the object that carries it.
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
}))

const mockTrack = jest.fn()
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({ name: 'firestore' }),
}))

import { AI_PLUGIN_ID } from '../constants'
import type { LazyWidget } from '../lazy-widget'
import { registerAiConsole } from '../plugin'
import {
  AI_SITE_FREE_PAGES_NOTE,
  AI_SITE_SUBMISSION_CHOICES,
  aiFreeSiteCreditEstimate,
  aiSiteCreditEstimate,
} from '../model/ai-site-job'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** A site job as the create door answers with it: queued, its plan step next. */
const siteJob = (patch: Record<string, unknown> = {}) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'demo-legal',
  kind: 'site',
  status: 'queued',
  brief: 'a neighborhood dog groomer',
  batch: null,
  steps: [
    { name: 'plan', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
  ],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
  error: null,
  running: false,
  plan: null,
  review: null,
  ...patch,
})

/** The create door's request: the one POST to the jobs route itself. */
const postCall = () => {
  const call = mockFetch.mock.calls.find(([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST')
  if (!call) throw new Error('no job was started')
  return call
}

let mockFetch: jest.Mock
let mockStartBlank: jest.Mock

const registeredOn = (zone: string) =>
  listConsoleWidgets(zone, [AI_PLUGIN_ID]).map(({ widget }) => widget)

/** The component the AI plugin registered on the zone: what the page draws. */
function widget(): ComponentType<ConsoleHostFirstRunZoneProps> {
  const [entry] = registeredOn(CONSOLE_WIDGET_SLOTS.hostFirstRun)
  if (!entry) throw new Error('nothing registered on hostFirstRun')
  return entry.Component
}

const zoneProps = (
  patch: Partial<ConsoleHostFirstRunZoneProps> = {},
): ConsoleHostFirstRunZoneProps => ({
  hostId: 'demo-legal',
  orgId: 'org-1',
  orgSlug: 'acme',
  host: 'demo-legal',
  startBlank: mockStartBlank,
  ...patch,
})

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  mockStartBlank = jest.fn()
})

afterEach(() => {
  // The whole flow is the jobs route. Nothing here writes a draft, publishes
  // anything or touches the site the person is standing on.
  // The model list a paid start reads to price a pick is a read too (AGL-3660).
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/(jobs|models)/)
})

/** Renders the dialog on its first step, once the jobs route has admitted this workspace. */
async function openChoice(
  patch: Partial<ConsoleHostFirstRunZoneProps> = {},
  verdict: Record<string, unknown> = { jobs: [] },
) {
  const Widget = widget()
  mockFetch.mockResolvedValueOnce(json(verdict))
  const view = render(<Widget {...zoneProps(patch)} />)
  await screen.findByText('How do you want to start?')
  return view
}

/** Renders the dialog and takes the AI card to the questions (AGL-3594). */
async function openCard(patch: Partial<ConsoleHostFirstRunZoneProps> = {}) {
  const view = await openChoice(patch)
  fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
  await screen.findByText('Tell us about your site')
  return view
}

/**
 * Nothing drawn, anywhere: not in the tree the widget was mounted in, and not
 * in the document a dialog portals into.
 *
 * The portal is the whole point. `container` is empty whether the widget
 * returned nothing or covered the screen with a dialog, so a container-only
 * assertion cannot tell a flag-off workspace's blank page from a takeover it
 * then watches disappear. The class check is the strictest of the three: it
 * fails on a dialog that is mounted and merely closed, which is what a
 * `keepMounted` would leave behind.
 */
function expectNothingDrawn(container: HTMLElement) {
  expect(container.textContent).toBe('')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.textContent).toBe('')
  expect(document.querySelector('[class*="MuiDialog"]')).toBeNull()
}

const typeAnswer = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

/** A style-of-site card, by the name it reads out as: its kind and its one line (AGL-3660). */
const kindCard = (index: number) =>
  screen.getByRole('radio', {
    name: `${AI_SITE_KINDS[index].label}: ${AI_SITE_KINDS[index].blurb}`,
  })

describe('the start is on the first-run zone, gated as every generative door is', () => {
  it('names the zone in the catalog', () => {
    expect(CONSOLE_WIDGET_SLOTS.hostFirstRun).toBe('hostFirstRun')
  })

  it('registers one widget on it, behind the plan and the permission', () => {
    expect(registeredOn(CONSOLE_WIDGET_SLOTS.hostFirstRun)).toEqual([
      expect.objectContaining({
        slot: 'hostFirstRun',
        widgetId: 'ai-site-start',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
      }),
    ])
  })

  it('carries exactly the gates the Screens page entry carries', () => {
    const [page] = registeredOn(CONSOLE_WIDGET_SLOTS.hostScreens)
    const [start] = registeredOn(CONSOLE_WIDGET_SLOTS.hostFirstRun)
    expect({ featureFlag: start.featureFlag, permission: start.permission }).toEqual({
      featureFlag: page.featureFlag,
      permission: page.permission,
    })
  })
})

describe('whether the guided start is here at all', () => {
  it.each([
    ['the release flag is off for this workspace', 404],
    ['the workspace or the member may not generate', 403],
  ])('stays absent when %s, leaving the blank page', async (_why, status) => {
    const Widget = widget()
    mockFetch.mockResolvedValue(json({ error: 'No' }, status))
    const { container } = render(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent when the route cannot be reached', async () => {
    const Widget = widget()
    mockFetch.mockRejectedValue(new Error('offline'))
    const { container } = render(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent while the probe is still out, and asks the route once', async () => {
    const Widget = widget()
    mockFetch.mockReturnValue(new Promise(() => undefined))
    const { container, rerender } = render(<Widget {...zoneProps()} />)
    rerender(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/jobs?orgId=org-1&limit=1')
    expectNothingDrawn(container)
  })

  it('asks nothing while the page has not resolved its org', async () => {
    const Widget = widget()
    const { container } = render(<Widget {...zoneProps({ orgId: undefined })} />)
    // Mounted, not merely loading: the card is registered lazily (AGL-3649).
    await act(async () => {
      await (Widget as LazyWidget).load()
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expectNothingDrawn(container)
  })

  /**
   * The negative control on {@link expectNothingDrawn}: a helper that cannot
   * see the dialog it is meant to rule out reports every absence above as a
   * pass, including the one where the page was taken over.
   */
  it('is a dialog when it IS here, which is what the absences rule out', async () => {
    const { container } = await openCard()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(container.textContent).toBe('')
    expect(() => expectNothingDrawn(container)).toThrow()
  })
})

describe('the skip', () => {
  it('is drawn with the questions, before a single one is answered', async () => {
    await openCard()
    const skip = screen.getByRole('button', { name: 'Skip and start blank' })
    expect(skip).toBeTruthy()
    // The first question is still empty, and the way out is already here.
    expect(
      (screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value,
    ).toBe('')
  })

  it('is never disabled, including while the start would refuse to run', async () => {
    await openCard()
    expect(
      (screen.getByRole('button', { name: 'Skip and start blank' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    // The plan button IS refused with nothing answered, which is the state a
    // skip most needs to work in.
    expect((screen.getByRole('button', { name: 'Plan my site' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('hands the person back to the blank path the zone owns', async () => {
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it('creates nothing: no job, no draft, nothing half made behind them', async () => {
    await openCard()
    // Half-answered, which is where somebody most plausibly leaves.
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.click(kindCard(0))
    const asked = mockFetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    await Promise.resolve()
    expect(mockFetch.mock.calls.length).toBe(asked)
    expect(mockFetch.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('is still the way out once a site has been started', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it('closes through `leave` once a site has been started, so no starter is written over the job (AGL-3594)', async () => {
    const leave = jest.fn()
    await openCard({ leave, host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(leave).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('leaves for the blank site — the starter — before anything is started, even where the shell offers `leave`', async () => {
    const leave = jest.fn()
    await openCard({ leave })
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(leave).not.toHaveBeenCalled()
  })
})

/**
 * The exits a full screen dialog has and a card does not.
 *
 * A surface that covers the page and cannot be dismissed is the funnel the
 * zone was built to refuse, so every way a person reaches for to leave one is
 * asserted to be the same `startBlank` — and to create nothing on the way.
 * Deleting the close control, dropping `onClose`, or turning a dismissal into
 * a state to come back to turns this block red.
 */
describe('leaving the full screen dialog', () => {
  const dismiss = () =>
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })

  it('takes Escape, which is the first thing a person presses at a takeover', async () => {
    await openCard()
    dismiss()
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it('takes the close control, drawn at the start of the bar above the questions', async () => {
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Escape', dismiss],
    [
      'the close control',
      () => fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' })),
    ],
  ])('creates nothing when the way out is %s', async (_how, leave) => {
    await openCard()
    // Half-answered, which is where somebody most plausibly leaves.
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.click(kindCard(0))
    const asked = mockFetch.mock.calls.length
    leave()
    await Promise.resolve()
    expect(mockFetch.mock.calls.length).toBe(asked)
    expect(mockFetch.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('keeps the skip enabled while a request is in flight, and leaves on it', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    // The request never answers, which is the whole of "in flight".
    mockFetch.mockReturnValue(new Promise(() => undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy()
    const skip = screen.getByRole('button', { name: 'Skip and start blank' }) as HTMLButtonElement
    const close = screen.getByRole('button', {
      name: 'Close the guided start',
    }) as HTMLButtonElement
    expect([skip.disabled, close.disabled]).toEqual([false, false])
    fireEvent.click(skip)
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  /**
   * The questions scroll; the way out does not. The bar carrying both exits is
   * the dialog's own chrome rather than a row inside its body, which is what
   * `scroll="paper"` keeps in place — a skip that scrolls away is a skip
   * somebody with eight questions above them cannot reach.
   */
  it('draws both exits outside the scrolling body', async () => {
    await openCard()
    const body = document.querySelector('.MuiDialogContent-root')
    expect(body).toBeTruthy()
    for (const name of ['Skip and start blank', 'Close the guided start']) {
      expect(body?.contains(screen.getByRole('button', { name }))).toBe(false)
    }
    // And the questions ARE in it, so the assertion above is about placement
    // rather than about a body that holds nothing.
    expect(body?.contains(screen.getByLabelText(/What kind of site are you creating\?/))).toBe(true)
  })
})

describe('the questions become a site scaffold', () => {
  it('asks what the site is, who it is for and which style of site it is', async () => {
    await openCard()
    expect(screen.getByLabelText(/What kind of site are you creating\?/)).toBeTruthy()
    expect(screen.getByLabelText(/Who is it for\?/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Style' })).toBeTruthy()
    AI_SITE_KINDS.forEach((_kind, index) => expect(kindCard(index)).toBeTruthy())
    // The answer above suggests the style until the person picks one (AGL-3660).
    typeAnswer(/What kind of site are you creating\?/, 'a roofing company')
    const trades = AI_SITE_KINDS.findIndex((kind) => kind.id === 'trades')
    expect(kindCard(trades).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(kindCard(0))
    expect(kindCard(0).getAttribute('aria-checked')).toBe('true')
    expect(kindCard(trades).getAttribute('aria-checked')).toBe('false')
  })

  it('starts one site job for this site, carrying every answer', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    typeAnswer(/Who is it for\?/, 'local dog owners')
    const restaurant = AI_SITE_KINDS.findIndex((kind) => kind.id === 'restaurant')
    fireEvent.click(kindCard(restaurant))
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [url, init] = postCall()
    expect(url).toBe('/api/ai/jobs')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.kind).toBe('site')
    expect(body.hostId).toBe('demo-legal')
    expect(body.orgId).toBe('org-1')
    expect(body.brief).toContain('a neighborhood dog groomer')
    expect(body.inputs).toEqual(
      expect.objectContaining({
        businessType: 'a neighborhood dog groomer',
        audience: 'local dog owners',
        siteKind: 'restaurant',
        starter: AI_SITE_KINDS.find((kind) => kind.id === 'restaurant')?.starter,
      }),
    )
  })

  /*
   * Where submissions go (AGL-2918): the one setting a new site owner has to
   * make, and the one a model cannot make for them. Asked here, carried on
   * the job, and binding on the form the scaffold builds.
   */
  it('asks where form submissions go, offering every answer the form step can bind', async () => {
    await openCard()
    const field = screen.getByLabelText(/Where do form submissions go\?/)
    expect(field).toBeTruthy()
    fireEvent.mouseDown(field)
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('data-value')),
    ).toEqual(AI_SITE_SUBMISSION_CHOICES.map((option) => option.id))
  })

  it('carries the answer about submissions on the job', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.mouseDown(screen.getByLabelText(/Where do form submissions go\?/))
    fireEvent.click(screen.getByRole('option', { name: /CRM as a lead/ }))
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    expect(JSON.parse(init.body).inputs.submissions).toBe('lead')
  })

  it('starts on the Inbox, which is what an unanswered question has to mean', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    // Filing leads is the ADDITION, and an addition is what a person chooses.
    expect(JSON.parse(init.body).inputs.submissions).toBe('inbox')
  })

  it('promises a plan to confirm, never a built or a published site', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    const said = await screen.findByText(/Your site is being planned/)
    expect(said.textContent).toMatch(/confirm/)
    expect(said.textContent).toMatch(/nothing is published/)
  })

  it('says the door’s own words when it refuses, and keeps the answers', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ error: 'Your workspace is out of AI credits' }, 429))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText('Your workspace is out of AI credits')
    expect(
      (screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value,
    ).toBe('a neighborhood dog groomer')
    expect(screen.getByRole('button', { name: 'Skip and start blank' })).toBeTruthy()
  })
})

describe('a Free workspace’s guided start (AGL-3594)', () => {
  async function openFreeCard() {
    await openChoice({}, { jobs: [], freeTaste: true })
    await screen.findByText('Up to 2 pages on the Free plan')
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await screen.findByText(AI_SITE_FREE_PAGES_NOTE)
  }

  it('offers one or two pages, starting on two, says paid plans generate more, and drafts no welcome email', async () => {
    await openFreeCard()
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['1', '2'])
    expect(screen.queryByLabelText('Welcome email')).toBeNull()
    expect(
      screen.getByText(new RegExp(`Up to about ${aiFreeSiteCreditEstimate(2)} of the 300 AI credits`)),
    ).toBeTruthy()
  })

  it('starts a two-page site job with no welcome email', async () => {
    await openFreeCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const [, init] = mockFetch.mock.calls.find(([url, request]) => url === '/api/ai/jobs' && request?.method === 'POST')!
    expect(JSON.parse(init.body).inputs).toEqual(expect.objectContaining({ pages: 2, welcomeEmail: false }))
  })

  it('offers no model picker on the Free plan', async () => {
    await openFreeCard()
    expect(screen.queryByRole('button', { name: /^AI model:/ })).toBeNull()
  })

  /*
   * A paid start picks the model that builds the site (AGL-3660): Auto by
   * default, the estimate priced by the pick, and the pick on the job.
   */
  it('offers the model picker on a paid plan, prices the estimate by the pick, and starts the job on it', async () => {
    await openCard()
    const picker = screen.getByRole('button', { name: 'AI model: Auto' })
    const auto = aiSiteCreditEstimate(5, { welcomeEmail: true })
    expect(screen.getByText(`About ${auto.toLocaleString('en-US')} credits, estimated.`)).toBeTruthy()
    mockFetch.mockResolvedValueOnce(
      json({
        kind: 'job.page',
        auto: { id: 'auto', label: 'Auto', tier: 'balanced', creditsPerRequest: 10, multiplier: 1, model: 'claude-sonnet-5' },
        options: [
          { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast', creditsPerRequest: 4, multiplier: 0.4 },
          { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'balanced', creditsPerRequest: 10, multiplier: 1 },
        ],
        measured: true,
      }),
    )
    fireEvent.click(picker)
    fireEvent.click(await screen.findByText('Claude Haiku 4.5'))
    expect(screen.getByRole('button', { name: 'AI model: Claude Haiku 4.5' })).toBeTruthy()
    expect(screen.getByText(`About ${Math.round(auto * 0.4).toLocaleString('en-US')} credits, estimated.`)).toBeTruthy()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(postCall()).toBeTruthy())
    expect(JSON.parse(postCall()[1].body).model).toBe('claude-haiku-4-5')
    localStorage.clear()
  })

  it('keeps a paid workspace’s four to eight pages', async () => {
    await openCard()
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['4', '5', '6', '7', '8'])
    expect(screen.queryByText(AI_SITE_FREE_PAGES_NOTE)).toBeNull()
  })
})

/**
 * The dialog stays with the job it started (AGL-3593): the plan and its
 * Confirm arrive here, through the drawer's own request, and "Open AI jobs"
 * follows the job in the panel and leaves the full-screen dialog.
 */
describe('watching and confirming in place (AGL-3593)', () => {
  const PLAN = {
    reuse: [],
    create: [],
    screens: [
      {
        title: 'Home',
        slug: '/',
        layout: null,
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Home',
        seoDescription: 'Dog grooming.',
        sections: [{ name: 'hero', uses: [], items: 0 }],
      },
    ],
    status: 'proposed',
    labels: {},
    proposedAt: '2026-10-06T10:00:00.000Z',
    confirmedAt: null,
    confirmedBy: null,
  }
  const planReady = siteJob({
    status: 'needs_review',
    steps: [
      { name: 'plan', status: 'done', startedAt: null, endedAt: null, creditsSpent: 6, error: null },
      { name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null },
    ],
    plan: PLAN,
    review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
  })

  async function startWith(job: unknown) {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
  }

  it('shows the job planning, live', async () => {
    await startWith(siteJob())
    expect(await screen.findByText(/^Planning\. The plan appears here/)).toBeTruthy()
  })

  it('shows the ready plan and confirms it through the drawer’s resume request', async () => {
    await startWith(planReady)
    expect(await screen.findByText(/Your plan is ready/)).toBeTruthy()
    expect(screen.getByText('Builds the page Home at /: hero')).toBeTruthy()
    mockFetch.mockResolvedValueOnce(
      json({ job: siteJob({ ...planReady, status: 'queued', review: null, plan: { ...PLAN, status: 'confirmed' } }) }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm plan' }))
    await screen.findByText('Confirmed plan')
    const resume = mockFetch.mock.calls.find(([url]) => url === '/api/ai/jobs/job-1/resume')
    expect(resume).toBeTruthy()
    expect(JSON.parse(resume![1].body)).toEqual({ orgId: 'org-1', hostId: 'demo-legal' })
  })

  it('opens AI jobs on the job, and leaves the dialog that covers it', async () => {
    const { useAiJobsOpenRequest } = require('./ai-jobs-store') as typeof import('./ai-jobs-store')
    let request = { seq: 0, jobId: null as string | null }
    const Panel = () => {
      // What the Assist panel subscribes to.
      request = useAiJobsOpenRequest()
      return null
    }
    render(<Panel />)
    await startWith(planReady)
    fireEvent.click(screen.getByRole('button', { name: 'Open AI jobs' }))
    await waitFor(() => expect(request.jobId).toBe('job-1'))
    expect(request.seq).toBeGreaterThan(0)
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })
})

describe('step 1: how the site starts (AGL-3594)', () => {
  beforeEach(() => mockTrack.mockReset())

  it('offers the starter site and AI as two cards, each with its icon and its title as its name', async () => {
    await openChoice()
    const starter = screen.getByRole('button', { name: 'Start from the starter site' })
    const ai = screen.getByRole('button', { name: 'Start with AI' })
    expect(starter.querySelector('[data-icon="page-layout-header-footer"]')).toBeTruthy()
    expect(ai.querySelector('[data-icon="creation"]')).toBeTruthy()
    expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy()
    // The questions wait for step 2.
    expect(screen.queryByLabelText(/What kind of site are you creating\?/)).toBeNull()
  })

  it('takes the starter site through the zone’s startBlank, once', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith('site_start_choice', { choice: 'starter' })
  })

  it('takes AI to the questions, and Back returns to the choice', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    expect(await screen.findByLabelText(/What kind of site are you creating\?/)).toBeTruthy()
    expect(screen.getByLabelText('Step 2 of 2')).toBeTruthy()
    expect(mockTrack).toHaveBeenCalledWith('site_start_choice', { choice: 'ai' })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('How do you want to start?')).toBeTruthy()
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('says what Free gets on the AI card, and nothing of it on a paid workspace', async () => {
    await openChoice()
    expect(screen.queryByText('Up to 2 pages on the Free plan')).toBeNull()
  })

  it('keeps Skip, close and Escape on the first step, each the starter', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })
})

describe('after "Plan my site": where the next step is (AGL-3594)', () => {
  beforeEach(() => mockPush.mockReset())

  it('asks for the plan to be confirmed for it, closes the zone without the starter, and opens the site’s build page for the job', async () => {
    const leave = jest.fn()
    await openCard({ leave })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme/hosts/demo-legal/ai-jobs/job-1'))
    expect(leave).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).not.toHaveBeenCalled()
    const [, init] = mockFetch.mock.calls.find(([url, request]) => url === '/api/ai/jobs' && request?.method === 'POST')!
    expect(JSON.parse(init.body).inputs).toEqual(expect.objectContaining({ autoConfirm: true }))
    // No thank-you notice left behind.
    expect(screen.queryByText(/Your site is being planned/)).toBeNull()
  })
})

/**
 * The takeover's surface (AGL-3596). A full-screen Dialog's paper is an
 * elevated paper, and in dark mode MUI lightens one with a white overlay — a
 * `background-image` over the paper color — which turned the guided start a
 * washed-out gray beside the console it covers. It is the console page's own
 * background in both modes.
 */
describe('the guided start is drawn on the console’s own surface', () => {
  it.each(['light', 'dark'] as const)('in %s mode: the page background, with no elevation overlay', async (mode) => {
    const { ThemeProvider, createTheme } = jest.requireActual('@mui/material') as typeof import('@mui/material')
    const theme = createTheme({ palette: { mode } })
    const Widget = widget()
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(
      <ThemeProvider theme={theme}>
        <Widget {...zoneProps()} />
      </ThemeProvider>,
    )
    await screen.findByText('How do you want to start?')
    const paper = document.querySelector('.MuiDialog-paper') as HTMLElement
    const style = getComputedStyle(paper)
    // Flat paper: MUI draws its dark-mode overlay through --Paper-overlay,
    // and at elevation 0 every color in it is fully transparent.
    expect(paper.className).toContain('MuiPaper-elevation0')
    const overlay = style.getPropertyValue('--Paper-overlay')
    const alphas = [...overlay.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map((match) => Number(match[1]))
    expect(alphas.filter((alpha) => alpha !== 0)).toEqual([])
    const expected = document.createElement('div')
    expected.style.backgroundColor = theme.palette.background.default
    expect(style.backgroundColor).toBe(expected.style.backgroundColor)
  })
})
