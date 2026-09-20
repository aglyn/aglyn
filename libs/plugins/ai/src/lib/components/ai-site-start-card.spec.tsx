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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'

// ONE held object for the whole file: a fresh double each render turns the
// probe's effect into a loop, and the effect keys on the uid rather than on
// the object that carries it.
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({ name: 'firestore' }),
}))

import { AI_PLUGIN_ID } from '../constants'
import { registerAiConsole } from '../plugin'
import { AI_SITE_START_EXAMPLES } from '../model/ai-site-start'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

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
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

/** Renders the dialog once the jobs route has admitted this workspace. */
async function openCard(patch: Partial<ConsoleHostFirstRunZoneProps> = {}) {
  const Widget = widget()
  mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
  const view = render(<Widget {...zoneProps(patch)} />)
  await screen.findByText('Start this site with AI')
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

/** The example chip, by the name it reads out as: its starter and its one line. */
const exampleChip = (index: number) =>
  screen.getByRole('button', {
    name: `${AI_SITE_START_EXAMPLES[index].label} — ${AI_SITE_START_EXAMPLES[index].blurb}`,
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
    await Promise.resolve()
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
    fireEvent.click(exampleChip(0))
    const asked = mockFetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    await Promise.resolve()
    expect(mockFetch.mock.calls.length).toBe(asked)
    expect(mockFetch.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true)
  })

  it('is still the way out once a site has been started', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-1', kind: 'site', status: 'queued' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mockStartBlank).toHaveBeenCalledTimes(1)
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
    fireEvent.click(exampleChip(0))
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
  it('asks what the site is, who it is for and which example they like', async () => {
    await openCard()
    expect(screen.getByLabelText(/What kind of site are you creating\?/)).toBeTruthy()
    expect(screen.getByLabelText(/Who is it for\?/)).toBeTruthy()
    expect(screen.getByText('Which of these do you like?')).toBeTruthy()
    AI_SITE_START_EXAMPLES.forEach((_example, index) => expect(exampleChip(index)).toBeTruthy())
  })

  it('starts one site job for this site, carrying every answer', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    typeAnswer(/Who is it for\?/, 'local dog owners')
    fireEvent.click(exampleChip(0))
    mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-1', kind: 'site', status: 'queued' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    await screen.findByText(/Your site is being planned/)
    const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
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
        starter: AI_SITE_START_EXAMPLES[0].id,
      }),
    )
  })

  it('promises a plan to confirm, never a built or a published site', async () => {
    await openCard()
    typeAnswer(/What kind of site are you creating\?/, 'a neighborhood dog groomer')
    mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-1', kind: 'site', status: 'queued' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan my site' }))
    const said = await screen.findByText(/Your site is being planned/)
    expect(said.textContent).toMatch(/confirm/)
    expect(said.textContent).toMatch(/nothing is published/)
  })

  it('says the door’s own words when it refuses, and keeps the answers', async () => {
    await openCard()
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
