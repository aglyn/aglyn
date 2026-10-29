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
  // The upgrade link Bring my site draws on a Free plan is an AppLink (AGL-3976).
  usePathname: () => '/acme/hosts',
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
  aiFreeCreditsNoneLeftText,
  aiFreeSiteCreditRange,
  aiFreeSitePrompt,
  aiSiteCreditRange,
} from '../model/ai-site-job'
import { AI_CREDITS_CONFIRM_CODE, aiCreditsPromptText, aiCreditRangeText } from '../model/ai-credit-estimate'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import { AI_SITE_START_ANSWERS, aiSiteStartBrief, aiSiteStartInputs, type AiSiteStartAnswers } from '../model/ai-site-start'
import { AI_SITE_STYLE_PREVIEW_ALTS } from './ai-site-style-previews'
import { resetAiModelOptionReadsForTests } from './use-ai-model-choice'

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

/** The jobs route's POSTs that only check (AGL-3859): asked before "Create site" makes the site. */
const checkCalls = () =>
  mockFetch.mock.calls.filter(
    ([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST' && JSON.parse(init.body).check === true,
  )

/** The create door's request: the one POST to the jobs route that starts the job. */
const postCall = () => {
  const call = mockFetch.mock.calls.find(
    ([url, init]) => url === '/api/ai/jobs' && init?.method === 'POST' && JSON.parse(init.body).check !== true,
  )
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
  // Bring my site's ownership door is the AI plugin's too (AGL-3976).
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/(jobs|models|site-import\/ownership)/)
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

/** Each question step's heading (AGL-3898). */
const HEADINGS = {
  kind: 'What are you building?',
  audience: 'Who is it for?',
  style: 'Choose a style',
  details: 'A few details',
  review: 'Review your site',
} as const

type QuestionStep = keyof typeof HEADINGS

/** The step on screen, by its heading. */
const onStep = (step: QuestionStep) => screen.findByRole('heading', { level: 1, name: HEADINGS[step] })

/** Renders the dialog and takes the AI card to the first question (AGL-3594, AGL-3898). */
async function openCard(patch: Partial<ConsoleHostFirstRunZoneProps> = {}) {
  const view = await openChoice(patch)
  fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
  await onStep('kind')
  return view
}

/** Next, or "Back to review" on a step opened from the review's Edit. */
const pressNext = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Back to review)$/ }))

/**
 * From the first question, types what kind of site it is and walks forward
 * with Next to `target`, leaving every other answer as it starts (AGL-3898).
 */
async function answerTo(target: Exclude<QuestionStep, 'kind'>, siteType = 'a neighborhood dog groomer') {
  typeAnswer(/What kind of site are you creating\?/, siteType)
  for (const step of ['audience', 'style', 'details', 'review'] as const) {
    pressNext()
    await onStep(step)
    if (step === target) return
    // Nothing is chosen for a person (AGL-4049): the walk clicks "Pick for me".
    if (step === 'style') fireEvent.click(pickForMe())
  }
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

/** "Pick for me", the style card that leaves the kind to the first answer (AGL-3898). */
const pickForMe = () => screen.getByRole('radio', { name: /^Pick for me: From your answer: / })

/** A kind-of-site card on the first question, by its title (AGL-3898). */
const typeCard = (title: string) => screen.getByRole('radio', { name: title })

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
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/jobs?orgId=org-1&limit=1&siteImport=1')
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
    // Next IS refused with nothing answered, which is the state a skip most
    // needs to work in.
    pressNext()
    expect(await screen.findByText('Say what kind of site this is.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Skip and start blank' }) as HTMLButtonElement).disabled,
    ).toBe(false)
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
    fireEvent.click(typeCard('Restaurant or cafe'))
    const asked = mockFetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    await Promise.resolve()
    expect(mockFetch.mock.calls.length).toBe(asked)
    expect(mockFetch.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('is still the way out once a site has been started', async () => {
    await openCard({ host: null })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it('closes through `leave` once a site has been started, so no starter is written over the job (AGL-3594)', async () => {
    const leave = jest.fn()
    await openCard({ leave, host: null })
    await answerTo('review')
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
    fireEvent.click(typeCard('Restaurant or cafe'))
    const asked = mockFetch.mock.calls.length
    leave()
    await Promise.resolve()
    expect(mockFetch.mock.calls.length).toBe(asked)
    expect(mockFetch.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('keeps the skip enabled while a request is in flight, and leaves on it', async () => {
    await openCard()
    await answerTo('review')
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

/**
 * Escape is the menu's before it is the dialog's, and a brief is never traded
 * for the starter by a dismissal (AGL-3660, 2026-10-08).
 *
 * In production a person filled in the brief, opened the model menu, pressed
 * Escape to close it — and the whole guided start closed through
 * `startBlank`, so the site was silently given the starter and the brief was
 * gone. Escape and the close control are dismissals, not a choice: with a
 * brief typed they ask first, and "Keep editing" is the answer they default
 * to. Skip is still the starter, at once, because it says so.
 */
describe('a dismissal never trades a typed brief for the starter', () => {
  const MODELS = {
    kind: 'job.page',
    auto: { id: 'auto', label: 'Auto', tier: 'balanced', creditsPerRequest: 10, multiplier: 1, model: 'm' },
    options: [{ id: 'fast-model', label: 'Fast model', tier: 'fast', creditsPerRequest: 4, multiplier: 0.4 }],
    measured: true,
  }
  const escapeOn = (element: Element) => fireEvent.keyDown(element, { key: 'Escape', code: 'Escape' })
  const briefField = () => screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement
  const LEAVE_QUESTION = 'Leave without your answers?'

  afterEach(() => {
    localStorage.clear()
    // The options read is shared by every mount; the next case reads afresh.
    resetAiModelOptionReadsForTests()
  })

  it('closes only the model menu on Escape, and keeps the dialog and the brief', async () => {
    await openCard()
    await answerTo('style')
    fireEvent.click(kindCard(1))
    pressNext()
    await onStep('details')
    pressNext()
    await onStep('review')
    mockFetch.mockResolvedValueOnce(json(MODELS))
    fireEvent.click(screen.getByRole('button', { name: 'AI model: Auto' }))
    await screen.findByText('Fast model')
    escapeOn(screen.getByRole('menu'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(mockStartBlank).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: LEAVE_QUESTION })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: HEADINGS.review })).toBeTruthy()
    expect(screen.getByText('a neighborhood dog groomer')).toBeTruthy()
    expect(screen.getByText(AI_SITE_KINDS[1].label)).toBeTruthy()
  })

  it('closes only an open select’s list on Escape', async () => {
    await openCard()
    await answerTo('details')
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    escapeOn(await screen.findByRole('listbox'))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(mockStartBlank).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: LEAVE_QUESTION })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: HEADINGS.details })).toBeTruthy()
  })

  it.each([
    ['Escape', () => escapeOn(screen.getByRole('dialog', { name: 'Start your site' }))],
    [
      'the close control',
      () => fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' })),
    ],
  ])('asks before %s leaves a typed brief, and Keep editing keeps it', async (_how, dismiss) => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    dismiss()
    await screen.findByRole('dialog', { name: LEAVE_QUESTION })
    expect(mockStartBlank).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LEAVE_QUESTION })).toBeNull())
    expect(mockStartBlank).not.toHaveBeenCalled()
    expect(briefField().value).toBe('a neighborhood dog groomer')
  })

  it('takes a second Escape as Keep editing, never as the starter', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    escapeOn(screen.getByRole('dialog', { name: 'Start your site' }))
    escapeOn(await screen.findByRole('dialog', { name: LEAVE_QUESTION }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LEAVE_QUESTION })).toBeNull())
    expect(mockStartBlank).not.toHaveBeenCalled()
    expect(briefField().value).toBe('a neighborhood dog groomer')
  })

  it('focuses Keep editing, so Enter on the question keeps the brief too', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    await screen.findByRole('dialog', { name: LEAVE_QUESTION })
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' })),
    )
  })

  it('leaves for the starter only when the person says so in the question', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Leave and start blank' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
  })

  it('keeps Skip a deliberate starter, with no question, brief or none', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: LEAVE_QUESTION })).toBeNull()
  })

  it('opens no model menu from a style card', async () => {
    await openCard()
    await answerTo('style')
    for (const index of [0, 1, 2]) fireEvent.click(kindCard(index))
    expect(screen.queryByRole('menu')).toBeNull()
    pressNext()
    await onStep('details')
    pressNext()
    await onStep('review')
    expect(
      screen.getByRole('button', { name: 'AI model: Auto' }).getAttribute('aria-expanded'),
    ).toBe('false')
  })
})

describe('the questions become a site scaffold', () => {
  it('asks what the site is, who it is for and which style of site it is, one step each', async () => {
    await openCard()
    expect(screen.getByLabelText(/What kind of site are you creating\?/)).toBeTruthy()
    expect(screen.queryByLabelText(/Who is it for\?/)).toBeNull()
    typeAnswer(/What kind of site are you creating\?/, 'a roofing company')
    pressNext()
    await onStep('audience')
    expect(screen.getByLabelText(/Who is it for\?/)).toBeTruthy()
    pressNext()
    await onStep('style')
    AI_SITE_KINDS.forEach((_kind, index) => expect(kindCard(index)).toBeTruthy())
    // Nothing is chosen until the person clicks a card (AGL-4049): not a
    // style, and not "Pick for me", which names the one the answer suggests
    // (AGL-3660, AGL-3898).
    expect(pickForMe().getAttribute('aria-checked')).toBe('false')
    AI_SITE_KINDS.forEach((_kind, index) => expect(kindCard(index).getAttribute('aria-checked')).toBe('false'))
    expect(pickForMe().getAttribute('aria-label')).toBe('Pick for me: From your answer: Home services & trades')
    // Next does not go forward without one, and says why.
    pressNext()
    expect(await screen.findByText('Choose a style, or Pick for me.')).toBeTruthy()
    await onStep('style')
    fireEvent.click(kindCard(0))
    expect(kindCard(0).getAttribute('aria-checked')).toBe('true')
    expect(pickForMe().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(pickForMe())
    expect(pickForMe().getAttribute('aria-checked')).toBe('true')
  })

  it("names Music & bands for a band's site as it is typed, and Business only when nothing is named", async () => {
    await openCard()
    typeAnswer(
      /What kind of site are you creating\?/,
      'A website for an indie folk band from Asheville — tour dates, new album, merch and booking',
    )
    pressNext()
    await onStep('audience')
    pressNext()
    await onStep('style')
    expect(pickForMe().getAttribute('aria-label')).toBe('Pick for me: From your answer: Music & bands')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('audience')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('kind')
    typeAnswer(/What kind of site are you creating\?/, 'a folk trio with a new record out')
    pressNext()
    await onStep('audience')
    pressNext()
    await onStep('style')
    expect(pickForMe().getAttribute('aria-label')).toBe('Pick for me: From your answer: Music & bands')
  })

  it('shows each style as a picture of its own kind of page, lazily, at a fixed size (AGL-3898)', async () => {
    await openCard()
    await answerTo('style')
    const alts = new Set<string>()
    for (const [index, kind] of AI_SITE_KINDS.entries()) {
      const picture = kindCard(index).querySelector('img') as HTMLImageElement
      expect(picture).toBeTruthy()
      // Each says what its own page shows, so no two styles read alike to a screen reader.
      expect(picture.getAttribute('alt')).toBe(AI_SITE_STYLE_PREVIEW_ALTS[kind.id])
      alts.add(picture.getAttribute('alt') as string)
      expect(picture.getAttribute('loading')).toBe('lazy')
      expect([picture.getAttribute('width'), picture.getAttribute('height')]).toEqual(['800', '800'])
    }
    expect(alts.size).toBe(AI_SITE_KINDS.length)
    // "Pick for me" is no style, so it has no picture of one.
    expect(pickForMe().querySelector('img')).toBeNull()
  })

  it('starts one site job for this site, carrying every answer', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    pressNext()
    await onStep('audience')
    typeAnswer(/Who is it for\?/, 'local dog owners')
    pressNext()
    await onStep('style')
    const restaurant = AI_SITE_KINDS.findIndex((kind) => kind.id === 'restaurant')
    fireEvent.click(kindCard(restaurant))
    pressNext()
    await onStep('details')
    pressNext()
    await onStep('review')
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
    await answerTo('details')
    const field = screen.getByLabelText(/Where do form submissions go\?/)
    expect(field).toBeTruthy()
    fireEvent.mouseDown(field)
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('data-value')),
    ).toEqual(AI_SITE_SUBMISSION_CHOICES.map((option) => option.id))
  })

  it('carries the answer about submissions on the job', async () => {
    await openCard({ host: null })
    await answerTo('details')
    fireEvent.mouseDown(screen.getByLabelText(/Where do form submissions go\?/))
    fireEvent.click(screen.getByRole('option', { name: /CRM as a lead/ }))
    pressNext()
    await onStep('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    expect(JSON.parse(init.body).inputs.submissions).toBe('lead')
  })

  it('starts on the Inbox, which is what an unanswered question has to mean', async () => {
    await openCard({ host: null })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    // Filing leads is the ADDITION, and an addition is what a person chooses.
    expect(JSON.parse(init.body).inputs.submissions).toBe('inbox')
  })

  it('says the site is built and published for them, and can be edited or unpublished', async () => {
    await openCard({ host: null })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    const said = await screen.findByText(/Your site is being planned/)
    // The guided start confirms its own plan (AGL-3594) and the site goes live.
    expect(said.textContent).toMatch(/built and published for you/)
    expect(said.textContent).toMatch(/edit or unpublish it/)
    expect(said.textContent).not.toMatch(/nothing is published|confirm/)
  })

  it('says the door’s own words when it refuses, and keeps the answers', async () => {
    await openCard({ host: null })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ error: 'Your workspace is out of AI credits' }, 429))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText('Your workspace is out of AI credits')
    expect(screen.getByText('a neighborhood dog groomer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit kind of site' }))
    await onStep('kind')
    expect(
      (screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value,
    ).toBe('a neighborhood dog groomer')
    expect(screen.getByRole('button', { name: 'Skip and start blank' })).toBeTruthy()
  })
})

describe('the places people clicked that did nothing (2026-10-18)', () => {
  it('goes back to a step already answered from the progress, keeping the answers', async () => {
    await openCard({ host: null })
    await answerTo('style')
    // Only the steps behind are controls (MUI draws a stepper's buttons as
    // tabs); the ones ahead are labels.
    expect(screen.queryByRole('tab', { name: 'Back to review' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Back to details' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Back to your site' }))
    await onStep('kind')
    expect(
      (screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value,
    ).toBe('a neighborhood dog groomer')
  })

  it('from the review, a step in the progress is Edit: its Next returns to the review', async () => {
    await openCard({ host: null })
    await answerTo('review')
    fireEvent.click(screen.getByRole('tab', { name: 'Back to audience' }))
    await onStep('audience')
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }))
    await onStep('review')
  })

  it('edits an answer from anywhere on its row, not only the word Edit', async () => {
    await openCard({ host: null })
    await answerTo('review')
    // The answer itself, which is where people clicked.
    fireEvent.click(screen.getByText('a neighborhood dog groomer'))
    await onStep('kind')
  })
})

describe('a Free workspace’s guided start (AGL-3594)', () => {
  async function openFreeCard(freeCredits?: Record<string, unknown>) {
    await openChoice({}, { jobs: [], freeTaste: true, ...(freeCredits ? { freeCredits } : {}) })
    await screen.findByText('Up to 2 pages on the Free plan')
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
  }

  it('offers one or two pages, starting on two, says paid plans generate more, and drafts no welcome email', async () => {
    await openFreeCard()
    await answerTo('details')
    expect(screen.getByText(AI_SITE_FREE_PAGES_NOTE)).toBeTruthy()
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['1', '2'])
    expect(screen.queryByLabelText('Welcome email')).toBeNull()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    pressNext()
    await onStep('review')
    // About what it is likely to cost, and at most (AGL-3722).
    expect(screen.getByText('About 113 credits (up to 243), of the 300 AI credits you get free each month.')).toBeTruthy()
    expect(screen.queryByText('Welcome email')).toBeNull()
  })

  it('quotes what is left of the month, shared across the owner’s Free workspaces, and when it resets (AGL-3660)', async () => {
    await openFreeCard({ left: 290, total: 300, resetsOn: '2026-11-01' })
    await answerTo('review')
    expect(
      screen.getByText(
        `${aiCreditRangeText(aiFreeSiteCreditRange(2))}. You have 290 of your 300 free AI credits left this month, until November 1.`,
      ),
    ).toBeTruthy()
    // It fits: no prompt.
    expect(screen.queryByText(/Build what fits/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Plan my site' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('asks before a site past what is left, starts nothing until the go-ahead, then starts it confirmed (AGL-3722)', async () => {
    await openFreeCard({ left: 70, total: 300, resetsOn: '2026-11-01' })
    await answerTo('review')
    const prompt = aiFreeSitePrompt({ left: 70, resetsOn: '2026-11-01' }, 2)!
    const warning = screen.getByRole('alert', { name: 'More than your credits left' })
    expect(warning.textContent).toContain(aiCreditsPromptText(prompt, 'site'))
    expect(warning.textContent).toContain(
      'This site is about 113 credits (up to 243). You have 70 left, so it will build as much as it can and pause when your credits run out.',
    )
    expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe('/acme/billing#plans')
    // Plan my site alone starts nothing: only an explicit choice does.
    const start = screen.getByRole('button', { name: 'Plan my site' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Build what fits' }))
    await waitFor(() => expect(postCall()).toBeTruthy())
    const body = JSON.parse(postCall()[1].body)
    expect(body.creditsConfirmed).toBe(true)
    expect(body.inputs).toEqual(expect.objectContaining({ pages: 2 }))
  })

  it('offers the home page first, as a one-page start, with what it is likely to cost (AGL-3722)', async () => {
    await openFreeCard({ left: 120, total: 300, resetsOn: '2026-11-01' })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    const first = screen.getByRole('button', { name: 'Build the home page first' })
    expect(first.textContent).toContain(`About ${aiFreeSiteCreditRange(1).likely} credits`)
    fireEvent.click(first)
    await waitFor(() => expect(postCall()).toBeTruthy())
    const body = JSON.parse(postCall()[1].body)
    expect(body.inputs).toEqual(expect.objectContaining({ pages: 1 }))
    expect(body.creditsConfirmed).toBe(true)
  })

  it('stops only when nothing is left at all, with when the credits renew and Upgrade', async () => {
    await openFreeCard({ left: 0, total: 300, resetsOn: '2026-11-01' })
    // Said from the first question, not only once the questions are answered.
    expect(screen.getByText(aiFreeCreditsNoneLeftText('2026-11-01'))).toBeTruthy()
    await answerTo('review')
    expect(screen.getByText(aiFreeCreditsNoneLeftText('2026-11-01'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Build what fits' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Plan my site' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a stale dialog meets the door’s prompt and can still build what fits (AGL-3722)', async () => {
    await openFreeCard()
    await answerTo('review')
    const prompt = aiFreeSitePrompt({ left: 60, resetsOn: '2026-11-01' }, 2)!
    mockFetch.mockResolvedValueOnce(json({ error: aiCreditsPromptText(prompt, 'site'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt }, 409))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    expect(await screen.findByRole('button', { name: 'Build what fits' })).toBeTruthy()
    // Nothing started: the dialog stays on its answers, Plan my site held.
    expect((screen.getByRole('button', { name: 'Plan my site' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('starts a two-page site job with no welcome email', async () => {
    await openFreeCard()
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const [, init] = mockFetch.mock.calls.find(([url, request]) => url === '/api/ai/jobs' && request?.method === 'POST')!
    expect(JSON.parse(init.body).inputs).toEqual(expect.objectContaining({ pages: 2, welcomeEmail: false }))
  })

  it('offers no model picker on the Free plan', async () => {
    await openFreeCard()
    await answerTo('review')
    expect(screen.queryByRole('button', { name: /^AI model:/ })).toBeNull()
  })

  /*
   * A paid start picks the model that builds the site (AGL-3660): Auto by
   * default, the estimate priced by the pick, and the pick on the job.
   */
  it('offers the model picker on a paid plan, prices the estimate by the pick, and starts the job on it', async () => {
    await openCard()
    await answerTo('review')
    const picker = screen.getByRole('button', { name: 'AI model: Auto' })
    const auto = aiSiteCreditRange(5, { welcomeEmail: true })
    expect(screen.getByText(`${aiCreditRangeText(auto)}, estimated.`)).toBeTruthy()
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
    expect(
      screen.getByText(
        `${aiCreditRangeText({ likely: Math.round(auto.likely * 0.4), p90: Math.round(auto.p90 * 0.4), ceiling: Math.round(auto.ceiling * 0.4) })}, estimated.`,
      ),
    ).toBeTruthy()
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(postCall()).toBeTruthy())
    expect(JSON.parse(postCall()[1].body).model).toBe('claude-haiku-4-5')
    localStorage.clear()
  })

  it('keeps a paid workspace’s four to eight pages', async () => {
    await openCard()
    await answerTo('details')
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
    await answerTo('review')
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
    expect(screen.getByLabelText('Step 1 of 6')).toBeTruthy()
    // The questions wait for step 2.
    expect(screen.queryByLabelText(/What kind of site are you creating\?/)).toBeNull()
  })

  it('takes the starter site through the zone’s startBlank, once, in the style chosen (AGL-4049)', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    expect(mockTrack).toHaveBeenCalledWith('site_start_choice', { choice: 'starter' })
    // It asks a style first, with nothing chosen and nothing started.
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a style' })).toBeTruthy()
    expect(mockStartBlank).not.toHaveBeenCalled()
    AI_SITE_KINDS.forEach((_kind, index) => expect(kindCard(index).getAttribute('aria-checked')).toBe('false'))
    // No "Pick for me" here: the starter has no answers to pick from.
    expect(screen.queryByRole('radio', { name: /^Pick for me/ })).toBeNull()
    const use = screen.getByRole('button', { name: 'Use this style' })
    expect((use as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(use)
    expect(mockStartBlank).not.toHaveBeenCalled()
    const trades = AI_SITE_KINDS.findIndex((kind) => kind.id === 'trades')
    fireEvent.click(kindCard(trades))
    expect(kindCard(trades).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Use this style' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).toHaveBeenCalledWith({ style: 'trades' })
  })

  it('goes Back from the style to the choice, starting nothing', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    await screen.findByRole('heading', { level: 1, name: 'Choose a style' })
    fireEvent.click(kindCard(0))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('How do you want to start?')).toBeTruthy()
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('takes AI to the questions, and Back returns to the choice', async () => {
    await openChoice()
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    expect(await screen.findByLabelText(/What kind of site are you creating\?/)).toBeTruthy()
    expect(screen.getByLabelText('Step 2 of 6')).toBeTruthy()
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
    await answerTo('review')
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
 * A site staff are building for a client (AGL-3958): the one-screen build has
 * asked the business details already, created the site and gathered the
 * owner's photos. The start opens on its review with those answers, passes
 * the rest of the intake to the job, and stays on the build's screen.
 */
describe('a site staff are building for a client (AGL-3958)', () => {
  const intake = {
    businessName: 'Harbor Plumbing',
    whatTheyDo: 'a family plumbing business',
    towns: 'Austin and Round Rock',
    phone: '(512) 555-0123',
    email: 'owner@example.com',
    hours: 'Mon–Fri 8–5',
    ownerWords: 'Three generations fixing pipes the right way.',
  }
  beforeEach(() => mockPush.mockReset())

  it('opens on the review with the intake, starts the job with all of it, and stays on the screen', async () => {
    const onStarted = jest.fn()
    const ready = jest.fn()
    const leave = jest.fn()
    const Widget = widget()
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<Widget {...zoneProps({ leave, clientBuild: { intake, onStarted, ready } })} />)
    await onStep('review')
    expect(ready).toHaveBeenCalledWith(true)
    // The phone, email, towns and hours are rows of the review itself (AGL-3995).
    expect(screen.getByText('Also from the client’s details: Harbor Plumbing and the owner\'s own words.')).toBeTruthy()
    // The follow that replaces the review reads the job from the same route.
    mockFetch.mockResolvedValue(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ id: 'job-1' }))
    const body = JSON.parse(postCall()[1].body)
    expect(body.brief).toContain('a family plumbing business')
    expect(body.brief).toContain('The business is called Harbor Plumbing.')
    expect(body.brief).toContain('call (512) 555-0123 or email owner@example.com')
    expect(body.brief).toContain('Its hours are Mon–Fri 8–5.')
    expect(body.brief).toContain(`In the owner's own words: "${intake.ownerWords}"`)
    expect(body.inputs).toEqual(
      expect.objectContaining({
        businessType: 'a family plumbing business',
        businessName: 'Harbor Plumbing',
        city: 'Austin and Round Rock',
        autoConfirm: true,
      }),
    )
    // It follows the job here instead of opening the site's build page.
    expect(await screen.findByText(/Your site is being planned/)).toBeTruthy()
    expect(mockPush).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('sends the towns as the place only until the review is given an address (AGL-3995)', async () => {
    const Widget = widget()
    mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
    render(<Widget {...zoneProps({ clientBuild: { intake, onStarted: jest.fn(), ready: jest.fn() } })} />)
    await onStep('review')
    // The intake filled the Details step's own rows.
    const review = screen.getByRole('list', { name: 'Your answers' })
    expect(review.textContent).toContain('(512) 555-0123')
    expect(review.textContent).toContain('Austin, Round Rock')
    fireEvent.click(screen.getByRole('button', { name: 'Edit phone' }))
    await onStep('details')
    fireEvent.click(screen.getByRole('button', { name: /More details/ }))
    typeAnswer(/Street address/, '214 Main Street')
    typeAnswer(/City or town/, 'Round Rock')
    pressNext()
    await onStep('review')
    mockFetch.mockResolvedValue(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    expect(JSON.parse(postCall()[1].body).inputs).toEqual(
      expect.objectContaining({
        street: '214 Main Street',
        city: 'Round Rock',
        serviceArea: 'Austin\nRound Rock',
        businessName: 'Harbor Plumbing',
      }),
    )
  })

  it('tells the build when it will not draw', async () => {
    const ready = jest.fn()
    const Widget = widget()
    mockFetch.mockResolvedValueOnce(json({ error: 'Not found' }, 404))
    const { container } = render(<Widget {...zoneProps({ clientBuild: { intake, ready } })} />)
    await waitFor(() => expect(ready).toHaveBeenCalledWith(false))
    expectNothingDrawn(container)
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

/**
 * "Create site" draws the start before the site exists (AGL-3761).
 *
 * The site's name and address are the shell's fields, drawn on step 1, and
 * the site is created only by a choice that needs it: the starter or Skip
 * (`startBlank`), or Plan my site (`pendingSite.create`, then the job on the
 * site it made). The close control and Escape create nothing: they are
 * `leave`, and the question they ask with something typed says so.
 */
describe('before the site exists (AGL-3761)', () => {
  const LEAVE_QUESTION = 'Leave without your answers?'
  let leave: jest.Mock

  const pendingSite = (patch: Record<string, unknown> = {}) => ({
    fields: <div>{'The site’s name and address'}</div>,
    check: jest.fn(() => true),
    dirty: false,
    create: jest.fn(async () => ({ hostId: 'host-new', host: 'royal-styles', orgSlug: 'acme' })),
    created: null,
    ready: jest.fn(),
    ...patch,
  })
  const pendingProps = (site: ReturnType<typeof pendingSite>) =>
    ({ hostId: null, host: null, leave, pendingSite: site }) as Partial<ConsoleHostFirstRunZoneProps>

  beforeEach(() => {
    leave = jest.fn()
    mockPush.mockReset()
  })

  it('opens on a removed start’s answers, its name and address still to type (AGL-3936)', async () => {
    window.sessionStorage.setItem(
      'aglyn:ai-site-start:answers',
      JSON.stringify({ inputs: { businessType: 'trading card shop', audience: 'collectors', pages: 3 }, at: Date.now() }),
    )
    await openChoice(pendingProps(pendingSite()))
    // The first question is still where the site's name and address are asked.
    expect(screen.getByText('The site’s name and address')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
    expect((screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value).toBe('trading card shop')
    window.sessionStorage.clear()
  })

  it('draws the shell’s name and address on step 1, and tells the shell it is here', async () => {
    const site = pendingSite()
    await openChoice(pendingProps(site))
    expect(screen.getByText('The site’s name and address')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Your site' })).toBeTruthy()
    expect(site.ready).toHaveBeenCalledWith(true)
  })

  it('tells the shell when it will not draw, so the shell asks its own way', async () => {
    const Widget = widget()
    const site = pendingSite()
    mockFetch.mockResolvedValue(json({ error: 'No' }, 404))
    render(<Widget {...zoneProps(pendingProps(site))} />)
    await waitFor(() => expect(site.ready).toHaveBeenCalledWith(false))
  })

  it('closes through `leave` on the close control and Escape, never the starter', async () => {
    await openChoice(pendingProps(pendingSite()))
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(leave).toHaveBeenCalledTimes(2)
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('asks before a name typed is dropped, and says no site is created', async () => {
    await openChoice(pendingProps(pendingSite({ dirty: true })))
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    expect(await screen.findByText(LEAVE_QUESTION)).toBeTruthy()
    expect(screen.getByText('What you typed is not saved, and no site is created.')).toBeTruthy()
    expect(screen.queryByText(/starts your site from the starter site/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(leave).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('keeps both cards waiting on a name and address the shell will take', async () => {
    const site = pendingSite({ check: jest.fn(() => false) })
    await openChoice(pendingProps(site))
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    expect(site.check).toHaveBeenCalledTimes(2)
    expect(mockStartBlank).not.toHaveBeenCalled()
    expect(screen.getByText('How do you want to start?')).toBeTruthy()
  })

  it('takes the starter through startBlank in the style chosen, and frees the card when the shell could not create it', async () => {
    mockStartBlank.mockResolvedValueOnce(false)
    await openChoice(pendingProps(pendingSite()))
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    await screen.findByRole('heading', { level: 1, name: 'Choose a style' })
    // Nothing is chosen, and Create site waits for a style (AGL-4049).
    const create = screen.getByRole('button', { name: 'Create site' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(screen.getByText('Choose a style to continue.')).toBeTruthy()
    fireEvent.click(create)
    expect(mockStartBlank).not.toHaveBeenCalled()
    const yoga = AI_SITE_KINDS.findIndex((kind) => kind.id === 'yoga')
    fireEvent.click(kindCard(yoga))
    fireEvent.click(screen.getByRole('button', { name: 'Create site' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).toHaveBeenCalledWith({ style: 'yoga' })
    // The shell could not: back on step 1, where the name and address are.
    expect(await screen.findByText('How do you want to start?')).toBeTruthy()
    const starter = screen.getByRole('button', { name: 'Start from the starter site' })
    await waitFor(() => expect(starter.getAttribute('aria-busy')).toBeNull())
  })

  it('has no Skip before the site exists, and its style view closes with nothing created (AGL-4049)', async () => {
    await openChoice(pendingProps(pendingSite()))
    expect(screen.queryByRole('button', { name: 'Skip and start blank' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start from the starter site' }))
    await screen.findByRole('heading', { level: 1, name: 'Choose a style' })
    expect(screen.queryByRole('button', { name: 'Skip and start blank' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(leave).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('creates the site on Plan my site, then starts the job on it and opens its build page', async () => {
    const site = pendingSite()
    await openChoice(pendingProps(site))
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
    await answerTo('review')
    // Nothing is created by answering.
    expect(site.create).not.toHaveBeenCalled()
    mockFetch.mockResolvedValueOnce(json({ ok: true }))
    mockFetch.mockResolvedValueOnce(json({ job: siteJob({ hostId: 'host-new' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles/ai-jobs/job-1'))
    expect(site.create).toHaveBeenCalledTimes(1)
    // With the style card the questions took, "Pick for me", for the site to record (AGL-4049).
    expect(site.create).toHaveBeenCalledWith({ style: 'auto' })
    // Checked first, with no site yet (AGL-3859), then started on the site made.
    expect(checkCalls()).toHaveLength(1)
    expect(JSON.parse(checkCalls()[0][1].body)).toEqual(expect.objectContaining({ hostId: null, kind: 'site', check: true }))
    const [, init] = postCall()
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({ hostId: 'host-new', kind: 'site' }))
    expect(leave).toHaveBeenCalledTimes(1)
    expect(mockStartBlank).not.toHaveBeenCalled()
  })

  it('says a refused create, starts no job, and returns to the name when it is the address', async () => {
    const site = pendingSite({
      create: jest.fn(async () => ({ error: 'That subdomain is taken', address: true })),
    })
    await openChoice(pendingProps(site))
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ ok: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    expect(await screen.findByText('That subdomain is taken')).toBeTruthy()
    expect(await screen.findByText('How do you want to start?')).toBeTruthy()
    expect(() => postCall()).toThrow('no job was started')
  })

  /*
   * A start the jobs route would refuse, or would ask the Free go-ahead for,
   * is answered before any site exists (AGL-3859): a person who leaves there
   * leaves nothing behind.
   */
  it('creates no site when the check refuses the start, and says why', async () => {
    const site = pendingSite()
    await openChoice(pendingProps(site))
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ error: 'Too many AI jobs at once. Try again in a minute.' }, 429))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    expect(await screen.findByText('Too many AI jobs at once. Try again in a minute.')).toBeTruthy()
    expect(site.create).not.toHaveBeenCalled()
    expect(() => postCall()).toThrow('no job was started')
  })

  it('asks the Free go-ahead before the site exists, and creates it only once it is given', async () => {
    const site = pendingSite()
    await openChoice(pendingProps(site), { jobs: [], freeTaste: true })
    fireEvent.click(screen.getByRole('button', { name: 'Start with AI' }))
    await onStep('kind')
    await answerTo('review')
    const prompt = aiFreeSitePrompt({ left: 60, resetsOn: '2026-11-01' }, 2)!
    mockFetch.mockResolvedValueOnce(json({ error: aiCreditsPromptText(prompt, 'site'), code: AI_CREDITS_CONFIRM_CODE, credits: prompt }, 409))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    const fits = await screen.findByRole('button', { name: 'Build what fits' })
    expect(site.create).not.toHaveBeenCalled()
    mockFetch.mockResolvedValueOnce(json({ ok: true }))
    mockFetch.mockResolvedValueOnce(json({ job: siteJob({ hostId: 'host-new' }) }))
    fireEvent.click(fits)
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme/hosts/royal-styles/ai-jobs/job-1'))
    expect(site.create).toHaveBeenCalledTimes(1)
    expect(JSON.parse(postCall()[1].body)).toEqual(expect.objectContaining({ hostId: 'host-new', creditsConfirmed: true }))
  })

  it('gives a site it created, whose job could not start, the starter on the way out', async () => {
    const created = { hostId: 'host-new', host: 'royal-styles', orgSlug: 'acme' }
    await openChoice(pendingProps(pendingSite({ created })))
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
    expect(leave).not.toHaveBeenCalled()
  })
})

/**
 * One decision a step (AGL-3898): Back and Next walk the questions and keep
 * every answer, a step that cannot go forward says why beside the field and
 * puts the cursor in it, Enter in a text answer is Next, and each step's
 * heading takes the focus.
 */
describe('one decision a step (AGL-3898)', () => {
  beforeEach(() => mockTrack.mockReset())

  it('refuses Next without what kind of site it is, says why beside the field, and puts the cursor in it', async () => {
    await openCard()
    pressNext()
    const field = screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement
    expect(await screen.findByText('Say what kind of site this is.')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Say what kind of site this is.')
    expect(document.activeElement).toBe(field)
    expect(screen.getByRole('heading', { level: 1, name: HEADINGS.kind })).toBeTruthy()
    expect(mockTrack).toHaveBeenCalledWith('site_start_field_error', { step: 'kind', field: 'siteType', error: 'required' })
    // The reason goes once the answer is there.
    typeAnswer(/What kind of site are you creating\?/, 'a bakery')
    expect(screen.queryByText('Say what kind of site this is.')).toBeNull()
  })

  it('refuses an answer longer than the job takes, with the same words the start always used', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'x'.repeat(121))
    pressNext()
    expect(await screen.findByText('Keep what kind of site this is under 120 characters.')).toBeTruthy()
    expect(mockTrack).toHaveBeenCalledWith('site_start_field_error', { step: 'kind', field: 'siteType', error: 'too_long' })
  })

  it('takes Enter in a text answer as Next', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a bakery')
    fireEvent.keyDown(screen.getByLabelText(/What kind of site are you creating\?/), { key: 'Enter', code: 'Enter' })
    await onStep('audience')
    fireEvent.keyDown(screen.getByLabelText(/Who is it for\?/), { key: 'Enter', code: 'Enter' })
    await onStep('style')
  })

  it('moves the focus to each step’s heading as it is drawn', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a bakery')
    pressNext()
    const heading = await onStep('audience')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    const first = await onStep('kind')
    await waitFor(() => expect(document.activeElement).toBe(first))
  })

  it('keeps every answer when going back, and fills the kind of site from its card', async () => {
    await openCard()
    fireEvent.click(typeCard('Restaurant or cafe'))
    expect((screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value).toBe('a restaurant or cafe')
    expect(typeCard('Restaurant or cafe').getAttribute('aria-checked')).toBe('true')
    pressNext()
    await onStep('audience')
    typeAnswer(/Who is it for\?/, 'families nearby')
    pressNext()
    await onStep('style')
    fireEvent.click(kindCard(2))
    pressNext()
    await onStep('details')
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    fireEvent.click(await screen.findByRole('option', { name: '7' }))
    for (const step of ['style', 'audience', 'kind'] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      await onStep(step)
    }
    expect((screen.getByLabelText(/What kind of site are you creating\?/) as HTMLInputElement).value).toBe('a restaurant or cafe')
    pressNext()
    await onStep('audience')
    expect((screen.getByLabelText(/Who is it for\?/) as HTMLInputElement).value).toBe('families nearby')
    pressNext()
    await onStep('style')
    expect(kindCard(2).getAttribute('aria-checked')).toBe('true')
    pressNext()
    await onStep('details')
    expect(screen.getByLabelText('Pages').textContent).toBe('7')
  })

  it('opens a step from the review’s Edit and comes back to the review on its Next', async () => {
    await openCard()
    await answerTo('review')
    fireEvent.click(screen.getByRole('button', { name: 'Edit style' }))
    await onStep('style')
    fireEvent.click(kindCard(4))
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }))
    await onStep('review')
    expect(screen.getByText(AI_SITE_KINDS[4].label)).toBeTruthy()
  })

  it('draws the progress as six steps, and the step on screen', async () => {
    await openCard()
    expect(screen.getByLabelText('Step 2 of 6')).toBeTruthy()
    for (const label of ['Start', 'Your site', 'Audience', 'Style', 'Details', 'Review']) expect(screen.getByText(label)).toBeTruthy()
  })
})

/**
 * What the job reads is what it always read (AGL-3898). The steps hold the
 * same answers object the single form held and write the same values for the
 * same choices; only the review turns it into the job, through the same
 * builders. Pinned twice: against the builders, and against the literal
 * inputs, so the two cannot drift together.
 */
describe('the job’s inputs are unchanged by the steps (AGL-3898)', () => {
  async function plannedBody() {
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(postCall()).toBeTruthy())
    return JSON.parse(postCall()[1].body)
  }

  it('sends a picked style, an audience, leads and seven pages exactly as the single form did', async () => {
    await openCard({ host: null })
    typeAnswer(/What kind of site are you creating\?/, '  a neighborhood dog groomer ')
    pressNext()
    await onStep('audience')
    typeAnswer(/Who is it for\?/, 'local dog owners')
    pressNext()
    await onStep('style')
    fireEvent.click(kindCard(AI_SITE_KINDS.findIndex((kind) => kind.id === 'restaurant')))
    pressNext()
    await onStep('details')
    fireEvent.mouseDown(screen.getByLabelText(/Where do form submissions go\?/))
    fireEvent.click(screen.getByRole('option', { name: /CRM as a lead/ }))
    fireEvent.mouseDown(screen.getByLabelText('Pages'))
    fireEvent.click(await screen.findByRole('option', { name: '7' }))
    fireEvent.mouseDown(screen.getByLabelText('Welcome email'))
    fireEvent.click(await screen.findByRole('option', { name: 'No' }))
    pressNext()
    await onStep('review')
    const body = await plannedBody()
    const expected: AiSiteStartAnswers = {
      ...AI_SITE_START_ANSWERS,
      siteType: '  a neighborhood dog groomer ',
      audience: 'local dog owners',
      kind: 'restaurant',
      pages: 7,
      submissions: 'lead',
      welcomeEmail: false,
    }
    expect(body.brief).toBe(aiSiteStartBrief(expected))
    expect(body.inputs).toEqual({ ...aiSiteStartInputs(expected), autoConfirm: true })
    expect(body.inputs).toEqual({
      businessType: 'a neighborhood dog groomer',
      audience: 'local dog owners',
      starter: 'business',
      siteKind: 'restaurant',
      pages: 7,
      businessName: '',
      city: '',
      brand: '',
      submissions: 'lead',
      welcomeEmail: false,
      autoConfirm: true,
    })
  })

  it('sends "Pick for me" as no kind picked: the kind the answer suggests, as before', async () => {
    await openCard({ host: null })
    fireEvent.click(typeCard('Trades business'))
    await answerTo('review', 'a roofing company')
    const body = await plannedBody()
    const expected: AiSiteStartAnswers = { ...AI_SITE_START_ANSWERS, siteType: 'a roofing company' }
    expect(body.brief).toBe(aiSiteStartBrief(expected))
    expect(body.inputs).toEqual({ ...aiSiteStartInputs(expected), autoConfirm: true })
    expect(body.inputs).toEqual({
      businessType: 'a roofing company',
      audience: '',
      starter: 'business',
      siteKind: 'trades',
      pages: 5,
      businessName: '',
      city: '',
      brand: '',
      submissions: 'inbox',
      welcomeEmail: true,
      autoConfirm: true,
    })
  })

  it('sends a kind-of-site card as the words the chips always sent', async () => {
    await openCard({ host: null })
    fireEvent.click(typeCard('Restaurant or cafe'))
    for (const step of ['audience', 'style', 'details', 'review'] as const) {
      pressNext()
      await onStep(step)
      if (step === 'style') fireEvent.click(pickForMe())
    }
    const body = await plannedBody()
    expect(body.inputs.businessType).toBe('a restaurant or cafe')
    expect(body.inputs.siteKind).toBe('restaurant')
  })
})

/**
 * The funnel (AGL-3898): each step drawn and left, the step the start was
 * abandoned on, and never a word anybody typed.
 */
describe('the guided start reports where people get lost (AGL-3898)', () => {
  beforeEach(async () => {
    // A start the last case left open reports its own leaving a tick after it
    // is unmounted; let it, before counting this case's events.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 5))
    })
    mockTrack.mockReset()
  })
  const named = (name: string) => mockTrack.mock.calls.filter(([event]) => event === name).map(([, params]) => params)

  it('reports each step drawn, each step left forward and back, with the time spent on it', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a bakery')
    pressNext()
    await onStep('audience')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await onStep('kind')
    expect(named('site_start_step_viewed').map((params) => params.step)).toEqual(['choose', 'kind', 'audience', 'kind'])
    expect(named('site_start_step_viewed')[1]).toEqual({ step: 'kind', step_index: 1, step_count: 6 })
    expect(named('site_start_step_completed').map((params) => params.step)).toEqual(['choose', 'kind'])
    expect(named('site_start_step_back')).toEqual([{ step: 'audience', step_index: 2, duration_ms: expect.any(Number) }])
  })

  it('reports Skip as the start abandoned on the step it was on, once', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a bakery')
    pressNext()
    await onStep('audience')
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(named('site_start_abandoned')).toEqual([
      { step: 'audience', step_index: 2, reason: 'skip', duration_ms: expect.any(Number), total_ms: expect.any(Number) },
    ])
  })

  it('reports the close control as the start abandoned', async () => {
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Close the guided start' }))
    expect(named('site_start_abandoned')).toEqual([expect.objectContaining({ step: 'kind', reason: 'close' })])
  })

  it('reports no abandonment once the site is started, and the review as completed', async () => {
    const view = await openCard()
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    view.unmount()
    await act(async () => {
      await new Promise((done) => setTimeout(done, 5))
    })
    expect(named('site_start_step_completed').map((params) => params.step)).toEqual(['choose', 'kind', 'audience', 'style', 'details', 'review'])
    expect(named('site_start_abandoned')).toEqual([])
  })

  it('reports a page change under an unfinished start as abandoned', async () => {
    const view = await openCard()
    view.unmount()
    await act(async () => {
      await new Promise((done) => setTimeout(done, 5))
    })
    expect(named('site_start_abandoned')).toEqual([expect.objectContaining({ step: 'kind', reason: 'route' })])
  })

  it('never sends a word anybody typed', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'Zelda’s secret bakery')
    pressNext()
    await onStep('audience')
    typeAnswer(/Who is it for\?/, 'zelda@example.com and friends')
    pressNext()
    await onStep('style')
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    const sent = JSON.stringify(mockTrack.mock.calls)
    expect(sent).not.toMatch(/Zelda|zelda|bakery|friends/)
  })
})

/*
 * "Bring my site" on the choice step (AGL-3976): absent while its flag is off,
 * drawn DISABLED with the reason and an upgrade link where the workspace can
 * change what stands in the way, and otherwise the flow that proves the site
 * is the reader's before anything is read.
 */
describe('Bring my site on the first step', () => {
  const claim = (current: boolean) => ({
    domain: 'harbor-dental.com',
    status: current ? 'proven' : 'pending',
    current,
    provenMethod: current ? 'dns' : null,
    provenAt: current ? Date.parse('2026-10-19T12:00:00.000Z') : null,
    provenDetail: null,
    lastChecks: {},
    dns: { host: '_aglyn-challenge.harbor-dental.com', type: 'TXT', value: 'aglyn-domain-verification=tok123' },
    meta: { name: 'aglyn-site-verification', content: 'tok123', tag: '<meta name="aglyn-site-verification" content="tok123">' },
    email: { domain: 'harbor-dental.com', pendingAddress: null, expiresAt: null, attemptsLeft: null },
  })
  const card = () => screen.queryByRole('button', { name: /Bring my site/ })

  it('is not drawn while its release flag is off', async () => {
    await openChoice()
    expect(card()).toBeNull()
    expect(screen.getByRole('button', { name: 'Start with AI' })).toBeTruthy()
  })

  it('is drawn disabled on the Free plan, with the reason and a way to upgrade', async () => {
    await openChoice({}, { jobs: [], freeTaste: true, siteImport: 'plan' })
    const button = card() as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText('Bring your current website in, every page and photo, on any paid plan. Upgrade to bring yours in.').length).toBeGreaterThan(0)
    // The notice's action is a button-styled link to Billing's plans.
    const upgrade = screen.getByRole('button', { name: 'Upgrade' })
    expect(upgrade.getAttribute('href')).toBe('/acme/billing#plans')
    fireEvent.click(button)
    expect(screen.queryByText('Your current website')).toBeNull()
  })

  it('is drawn disabled for a member who cannot bring a site in, with no upgrade to offer', async () => {
    await openChoice({}, { jobs: [], siteImport: 'role' })
    expect((card() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('Only the workspace owner or an admin can bring a site in.').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('asks the address, proves the site is the reader’s, then reads it on a new job: nothing built yet', async () => {
    await openChoice({}, { jobs: [], siteImport: 'ready' })
    fireEvent.click(card() as HTMLElement)
    await screen.findByRole('heading', { level: 1, name: 'Bring my site' })
    typeAnswer('Website address', 'https://www.harbor-dental.com/')
    // Not yet verified: the three ways are shown, and Next waits for one.
    mockFetch.mockResolvedValueOnce(json({ claim: claim(false) }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Add a DNS record')
    expect(screen.getByText('Add a tag to your home page')).toBeTruthy()
    expect(screen.getByText('Get a code by email')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    mockFetch.mockResolvedValueOnce(json({ result: { method: 'dns', status: 'proven', message: 'Found the DNS record. Your site is verified.', claim: claim(true) } }))
    fireEvent.click(screen.getByRole('button', { name: 'Check the DNS record' }))
    await screen.findByText('Verified')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('button', { name: 'Read my site' })
    mockFetch.mockResolvedValueOnce(json({ job: siteJob({ id: 'import-1', kind: 'import' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Read my site' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme/hosts/demo-legal/ai-jobs/import-1'))
    const [ownershipUrl, ownershipInit] = mockFetch.mock.calls[1]
    expect(ownershipUrl).toBe('/api/ai/site-import/ownership')
    expect(JSON.parse(ownershipInit.body)).toEqual({ orgId: 'org-1', action: 'claim', domain: 'https://www.harbor-dental.com/' })
    expect(JSON.parse(postCall()[1].body)).toEqual({
      orgId: 'org-1',
      hostId: 'demo-legal',
      kind: 'import',
      brief: 'Bring in harbor-dental.com',
      inputs: { domain: 'harbor-dental.com' },
    })
    expect(mockTrack).toHaveBeenCalledWith('site_start_choice', { choice: 'import' })
  })

  it('goes back to how the site starts from the first question', async () => {
    await openChoice({}, { jobs: [], siteImport: 'ready' })
    fireEvent.click(card() as HTMLElement)
    await screen.findByText('Your current website')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('How do you want to start?')
    expect(mockStartBlank).not.toHaveBeenCalled()
  })
})

/*
 * How customers reach the business, and More details on every step
 * (AGL-3979): the phone and email are asked on the Details step itself, the
 * rest in a collapsed "More details" a step at a time; each is held to its
 * rule beside its field, listed on the review, and carried on the job only
 * where given.
 */
describe('the business details a start may be given (AGL-3979)', () => {
  it('offers More details, collapsed, on every question step', async () => {
    await openCard()
    for (const step of ['kind', 'audience', 'style', 'details'] as const) {
      await onStep(step)
      const more = screen.getByRole('button', { name: /More details/ })
      expect(more.getAttribute('aria-expanded')).toBe('false')
      if (step === 'kind') typeAnswer(/What kind of site are you creating\?/, 'a family plumbing company')
      if (step === 'style') fireEvent.click(pickForMe())
      pressNext()
    }
    await onStep('review')
    expect(screen.queryByRole('button', { name: /More details/ })).toBeNull()
  })

  it('carries the phone, the email and what More details was given on the job, and lists them on the review', async () => {
    await openCard({ host: null })
    await answerTo('details', 'a family plumbing company')
    typeAnswer(/Business phone/, '(512) 555-0142')
    typeAnswer(/Business email/, 'hello@pipeworks.co')
    fireEvent.click(screen.getByRole('button', { name: /More details/ }))
    typeAnswer(/Street address/, '214 Main Street')
    typeAnswer(/City or town/, 'Austin')
    typeAnswer(/Social profiles/, 'instagram.com/pipeworks')
    pressNext()
    await onStep('review')
    const review = screen.getByRole('list', { name: 'Your answers' })
    expect(review.textContent).toContain('(512) 555-0142')
    expect(review.textContent).toContain('hello@pipeworks.co')
    expect(review.textContent).toContain('214 Main Street, Austin')
    expect(review.textContent).toContain('instagram.com/pipeworks')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    expect(JSON.parse(init.body).inputs).toEqual(
      expect.objectContaining({
        phone: '(512) 555-0142',
        email: 'hello@pipeworks.co',
        street: '214 Main Street',
        city: 'Austin',
        social: 'instagram.com/pipeworks',
      }),
    )
  })

  it('says beside the field what is wrong with an email, and stays on the step', async () => {
    await openCard()
    await answerTo('details')
    typeAnswer(/Business email/, 'hello at pipeworks')
    pressNext()
    expect(await screen.findByText(/Enter an email address, like hello@yourbusiness.com/)).toBeTruthy()
    await onStep('details')
  })

  it('opens More details when a Next is refused on one of its fields', async () => {
    await openCard()
    await answerTo('details')
    fireEvent.click(screen.getByRole('button', { name: /More details/ }))
    typeAnswer(/Social profiles/, 'my instagram')
    fireEvent.click(screen.getByRole('button', { name: /More details/ }))
    expect(screen.getByRole('button', { name: /More details/ }).getAttribute('aria-expanded')).toBe('false')
    pressNext()
    await onStep('details')
    expect(screen.getByRole('button', { name: /More details/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Paste each profile’s address/)).toBeTruthy()
  })

  it('sends no detail it was not given', async () => {
    await openCard({ host: null })
    await answerTo('review')
    mockFetch.mockResolvedValueOnce(json({ job: siteJob() }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [, init] = postCall()
    const inputs = JSON.parse(init.body).inputs
    for (const key of ['phone', 'email', 'street', 'hours', 'social', 'tagline']) expect(inputs).not.toHaveProperty(key)
  })
})
