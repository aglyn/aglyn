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
 * The listing the guided start's answers describe, on the site's SEO section
 * (AGL-2918).
 *
 * Every render goes through the component the AI plugin REGISTERED on the
 * `hostSeo` zone, so what is asserted is what that page's slot draws.
 *
 * The control this file carries is `describe('it writes nothing', …)`: the
 * card's whole claim is that it stages and never saves, so what has to stay
 * red if that breaks is a test that keeps the zone's `proposeDraft` the only
 * thing the button reaches and the fetches to a read of the jobs route.
 *
 * Absence is asserted through {@link expectNothingDrawn}, which also rules out
 * a portal — this card draws none today, and a card that grew one would
 * satisfy a bare `container.textContent` check while covering the page. The
 * helper's own negative control is at the end of that block.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleHostSeoZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
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
import {
  AI_SITE_SEO_OUTPUT_ID,
  aiSiteSeoProposalForInputs,
} from '../model/ai-site-start-seo'
import { registerAiConsole } from '../plugin'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

let mockFetch: jest.Mock
let mockProposeDraft: jest.Mock

const registeredOn = (zone: string) =>
  listConsoleWidgets(zone, [AI_PLUGIN_ID]).map(({ widget }) => widget)

/** The card the AI plugin registered on the zone, found by its widget id. */
function widget(): ComponentType<ConsoleHostSeoZoneProps> {
  const entry = registeredOn(CONSOLE_WIDGET_SLOTS.hostSeo).find(
    (row) => row.widgetId === 'ai-site-seo-start',
  )
  if (!entry) throw new Error('nothing registered on hostSeo as ai-site-seo-start')
  return entry.Component
}

const PROPOSAL = aiSiteSeoProposalForInputs({
  businessType: 'a neighborhood dog groomer',
  audience: 'local dog owners',
})

const TITLE = 'Neighborhood dog groomer'
const DESCRIPTION = 'Neighborhood dog groomer, for local dog owners.'

/** A `site` job for this site carrying the listing its answers imply. */
const siteJob = (patch: Record<string, unknown> = {}) => ({
  id: 'job-1',
  kind: 'site',
  hostId: 'demo-legal',
  status: 'succeeded',
  outputs: [
    {
      resource: 'seo',
      id: AI_SITE_SEO_OUTPUT_ID,
      hostId: 'demo-legal',
      label: 'The site’s search title and description',
      proposal: PROPOSAL,
    },
  ],
  ...patch,
})

const zoneProps = (patch: Partial<ConsoleHostSeoZoneProps> = {}): ConsoleHostSeoZoneProps => ({
  hostId: 'demo-legal',
  orgId: 'org-1',
  orgSlug: 'acme',
  host: 'demo-legal',
  seo: undefined,
  proposeDraft: mockProposeDraft,
  ...patch,
})

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  mockProposeDraft = jest.fn()
})

/** Renders the card with the jobs route answering `jobs`. */
async function openCard(jobs: unknown[], patch: Partial<ConsoleHostSeoZoneProps> = {}) {
  const Widget = widget()
  mockFetch.mockResolvedValueOnce(json({ jobs }))
  const view = render(<Widget {...zoneProps(patch)} />)
  await screen.findByText('The listing your answers describe')
  return view
}

/**
 * Nothing drawn, anywhere: not in the tree the card was mounted in, and not
 * in the document a portal would reach.
 *
 * `container.textContent` alone is satisfied equally by "nothing rendered"
 * and by "a dialog covering the page", so an absence test written on it is
 * blind to the one case worth catching. This card portals nothing today; the
 * check is here so the day it grows a dialog the absences do not quietly stop
 * seeing anything. Its negative control is the last test of the block.
 */
function expectNothingDrawn(container: HTMLElement) {
  expect(container.textContent).toBe('')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.textContent).toBe('')
  expect(document.querySelector('[class*="MuiDialog"]')).toBeNull()
}

describe('the card is on the SEO section, gated as every generative door is', () => {
  it('registers on the zone behind the plan and the permission', () => {
    expect(
      registeredOn(CONSOLE_WIDGET_SLOTS.hostSeo).find((row) => row.widgetId === 'ai-site-seo-start'),
    ).toEqual(
      expect.objectContaining({
        slot: 'hostSeo',
        widgetId: 'ai-site-seo-start',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
      }),
    )
  })

  it('carries exactly the gates the SEO audit beside it carries', () => {
    const [audit] = registeredOn(CONSOLE_WIDGET_SLOTS.hostSeo).filter(
      (row) => row.widgetId === 'ai-seo-audit',
    )
    const start = registeredOn(CONSOLE_WIDGET_SLOTS.hostSeo).find(
      (row) => row.widgetId === 'ai-site-seo-start',
    )
    expect({ featureFlag: start?.featureFlag, permission: start?.permission }).toEqual({
      featureFlag: audit.featureFlag,
      permission: audit.permission,
    })
  })
})

describe('it is absent unless there is something to offer', () => {
  it('stays absent where the jobs route answers 404 — the flag is off', async () => {
    const Widget = widget()
    mockFetch.mockResolvedValue(json({ error: 'not found' }, 404))
    const { container } = render(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent where the reader may not generate — a 403', async () => {
    const Widget = widget()
    mockFetch.mockResolvedValue(json({ error: 'forbidden' }, 403))
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
    expectNothingDrawn(container)
  })

  it('asks nothing while the page has not resolved its org', async () => {
    const Widget = widget()
    const { container } = render(<Widget {...zoneProps({ orgId: undefined })} />)
    await Promise.resolve()
    expect(mockFetch).not.toHaveBeenCalled()
    expectNothingDrawn(container)
  })

  it('stays absent where no guided start ever ran on this site', async () => {
    const Widget = widget()
    // A scaffold for ANOTHER site of the org, and an SEO audit of this one:
    // neither is this site's guided start, and the org's jobs list carries
    // every site's.
    mockFetch.mockResolvedValue(
      json({
        jobs: [
          siteJob({ hostId: 'another-site' }),
          { ...siteJob(), kind: 'seo' },
          { ...siteJob(), outputs: [] },
        ],
      }),
    )
    const { container } = render(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent where the site already says what the proposal says', async () => {
    const Widget = widget()
    mockFetch.mockResolvedValue(json({ jobs: [siteJob()] }))
    const { container } = render(
      <Widget {...zoneProps({ seo: { title: TITLE, description: DESCRIPTION } })} />,
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('is here again when one of the two has since been rewritten', async () => {
    await openCard([siteJob()], { seo: { title: TITLE, description: 'Something else entirely.' } })
    expect(screen.getByText(DESCRIPTION)).toBeTruthy()
  })

  /**
   * The negative control on {@link expectNothingDrawn}: a helper that cannot
   * see what it is meant to rule out reports every absence above as a pass.
   */
  it('draws the listing when there IS one, which is what the absences rule out', async () => {
    const { container } = await openCard([siteJob()])
    expect(() => expectNothingDrawn(container)).toThrow()
  })
})

describe('what it shows and what the button does', () => {
  it('shows the title and the description the answers describe', async () => {
    await openCard([siteJob()])
    expect(screen.getByText(TITLE)).toBeTruthy()
    expect(screen.getByText(DESCRIPTION)).toBeTruthy()
  })

  it('takes the site’s own last start, not another site’s', async () => {
    const other = siteJob({
      id: 'job-0',
      hostId: 'another-site',
      outputs: [
        {
          resource: 'seo',
          id: AI_SITE_SEO_OUTPUT_ID,
          hostId: 'another-site',
          label: 'x',
          proposal: aiSiteSeoProposalForInputs({ businessType: 'a bicycle shop' }),
        },
      ],
    })
    await openCard([other, siteJob()])
    expect(screen.queryByText('Bicycle shop')).toBeNull()
    expect(screen.getByText(TITLE)).toBeTruthy()
  })

  it('puts both values in the form under the job’s own key, once', async () => {
    await openCard([siteJob()])
    const button = screen.getByRole('button', { name: 'Put in the form' })
    fireEvent.click(button)
    expect(mockProposeDraft).toHaveBeenCalledTimes(1)
    expect(mockProposeDraft).toHaveBeenCalledWith(
      { 'seo.title': TITLE, 'seo.description': DESCRIPTION },
      'job-1:site-listing',
    )
    // The button stops being pressable, so the same values cannot be staged
    // twice under two keys and land in the form twice.
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(mockProposeDraft).toHaveBeenCalledTimes(1)
  })

  it('says the form is where they are now, and that saving is the person’s', async () => {
    await openCard([siteJob()])
    fireEvent.click(screen.getByRole('button', { name: 'Put in the form' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'In the SEO form below as unsaved changes. Read them, then press Update.',
    )
    // The card said saving was the person's before the button was pressed too.
    expect(screen.getAllByText(/press Update/)).toHaveLength(2)
  })
})

describe('it writes nothing', () => {
  it('reaches the jobs route, reads it, and asks for nothing else', async () => {
    await openCard([siteJob()])
    fireEvent.click(screen.getByRole('button', { name: 'Put in the form' }))
    // One call, a GET of the jobs list. No job is started from here, nothing
    // is applied through a door, and the site's settings are never written:
    // the zone's `proposeDraft` is the only way out of this card.
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toMatch(/^\/api\/ai\/jobs\?orgId=org-1&limit=\d+$/)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('stays on this card when the person never presses the button', async () => {
    await openCard([siteJob()])
    expect(mockProposeDraft).not.toHaveBeenCalled()
  })
})
