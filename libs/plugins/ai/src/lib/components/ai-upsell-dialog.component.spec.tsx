/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

/**
 * "Create with AI" on a plan that could buy the AI add-on and has not
 * (AGL-3601).
 *
 * Every entry is rendered through the component the AI plugin REGISTERED on
 * its zone, with the props the shell hands an upsell (`entitled={false}` and
 * `upgrade`), and the jobs route answering as its gate does for a plan without
 * `aiGenerative`: 403 with `reason: 'entitlement'`. The same button is there,
 * and it opens the add-on's dialog, never the brief and never a job.
 */

import { listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleWidgetUpgrade } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFirestore = { name: 'firestore' }
const mockFetch = jest.fn()
const mockTrack = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => mockFirestore,
  useFirestoreCollection: () => ({ status: 'success', data: [] }),
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined) => ({ rows: read ?? [], truncated: false }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))

import { AI_PLUGIN_ID } from '../constants'
import { registerAiConsole } from '../plugin'
import { AI_UPSELL_COPY, aiUpsellOffer, type AiUpsellKind } from './ai-upsell-dialog.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** The gate's answer for a plan without `aiGenerative` (`ai-jobs-gate.ts`). */
const PLAN_LACKS_IT = () =>
  json({ error: "This workspace's plan does not include that feature", reason: 'entitlement' }, 403)

const BILLING = '/acme/billing#addons'
const OWNER: ConsoleWidgetUpgrade = { billingHref: BILLING, canManageBilling: true }
const MEMBER: ConsoleWidgetUpgrade = { billingHref: BILLING, canManageBilling: false }

/** Every "Create with AI" entry, by the zone its page draws and what it makes. */
const ENTRIES: ReadonlyArray<{ zone: string; widgetId: string; kind: AiUpsellKind }> = [
  { zone: 'hostScreens', widgetId: 'ai-describe-page', kind: 'page' },
  { zone: 'hostTemplates', widgetId: 'ai-describe-template', kind: 'template' },
  { zone: 'hostLayouts', widgetId: 'ai-describe-layout', kind: 'layout' },
  { zone: 'hostForms', widgetId: 'ai-describe-form', kind: 'form' },
  { zone: 'hostComponents', widgetId: 'ai-describe-component', kind: 'component' },
  { zone: 'hostAutomations', widgetId: 'ai-describe-automation', kind: 'workflow' },
]

function widgetFor(zone: string, widgetId: string): ComponentType<Record<string, unknown>> {
  const found = listConsoleWidgets(zone, [AI_PLUGIN_ID]).find(
    ({ widget }) => widget.widgetId === widgetId,
  )
  if (!found) throw new Error(`nothing registered on ${zone}`)
  return found.widget.Component
}

const zoneProps = { hostId: 'host-1', orgId: 'org-1', openAction: () => true }

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch.mockReset()
  mockTrack.mockReset()
  forgetAiJobsVerdicts()
})

afterEach(() => {
  // A probe at most: the upsell starts no job and reaches no other door.
  for (const [url, init] of mockFetch.mock.calls) {
    expect(String(url)).toBe('/api/ai/jobs?orgId=org-1&limit=1')
    expect(init?.method ?? 'GET').toBe('GET')
  }
})

describe('every Create with AI entry opts in, and only those', () => {
  it.each(ENTRIES)('$widgetId on $zone declares showWhenNotEntitled', ({ zone, widgetId }) => {
    const [entry] = listConsoleWidgets(zone, [AI_PLUGIN_ID]).filter(
      ({ widget }) => widget.widgetId === widgetId,
    )
    expect(entry.widget).toEqual(
      expect.objectContaining({
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
      }),
    )
  })

  it('leaves every other AI widget to the plain gate', () => {
    const ids = new Set(ENTRIES.map((entry) => entry.widgetId))
    const zones = ['hostTheme', 'seoFields', 'hostSeo', 'automationEditor', 'automationRun', 'consoleTopBar']
    for (const zone of zones) {
      for (const { widget } of listConsoleWidgets(zone, [AI_PLUGIN_ID])) {
        if (!ids.has(widget.widgetId)) expect(widget.showWhenNotEntitled).toBeUndefined()
      }
    }
  })
})

describe.each(ENTRIES)('$widgetId on a plan without the add-on', ({ zone, widgetId, kind }) => {
  it('is the same button, and opens the add-on with a link to Billing’s add-ons', async () => {
    const Widget = widgetFor(zone, widgetId)
    mockFetch.mockResolvedValue(PLAN_LACKS_IT())
    render(<Widget {...zoneProps} entitled={false} upgrade={OWNER} />)
    const button = await screen.findByRole('button', { name: 'Create with AI' })
    expect(button.querySelector('svg')).toBeTruthy()
    fireEvent.click(button)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(AI_UPSELL_COPY[kind].title)).toBeTruthy()
    expect(within(dialog).getByText(AI_UPSELL_COPY[kind].does)).toBeTruthy()
    expect(within(dialog).getByText(aiUpsellOffer(true))).toBeTruthy()
    // No brief box: the plan does not include the job.
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(mockTrack).toHaveBeenCalledWith('ai_upsell_shown', { kind, can_manage: true })

    const add = within(dialog).getByRole('link', { name: 'Add Aglyn AI' })
    expect(add.getAttribute('href')).toBe(BILLING)
    // jsdom cannot follow a link; the href above is what the browser follows.
    add.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(add)
    expect(mockTrack).toHaveBeenCalledWith('ai_upsell_clicked', { kind })
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeTruthy()
  })

  it('tells a member who cannot buy it to ask an owner or admin, with no link', async () => {
    const Widget = widgetFor(zone, widgetId)
    mockFetch.mockResolvedValue(PLAN_LACKS_IT())
    render(<Widget {...zoneProps} entitled={false} upgrade={MEMBER} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(aiUpsellOffer(false))).toBeTruthy()
    expect(aiUpsellOffer(false)).toMatch(/Ask a workspace owner or admin/)
    expect(within(dialog).queryByRole('link')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(mockTrack).toHaveBeenCalledWith('ai_upsell_shown', { kind, can_manage: false })
  })

  it('stays absent where the generative doors do not exist (404)', async () => {
    const Widget = widgetFor(zone, widgetId)
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<Widget {...zoneProps} entitled={false} upgrade={OWNER} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
  })

  it('stays absent on a refusal that is not the plan', async () => {
    const Widget = widgetFor(zone, widgetId)
    mockFetch.mockResolvedValue(json({ error: 'You are not a member of that organization' }, 403))
    const { container } = render(<Widget {...zoneProps} entitled={false} upgrade={OWNER} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
  })

  it('stays absent when the shell did not mount it as an upsell', async () => {
    const Widget = widgetFor(zone, widgetId)
    mockFetch.mockResolvedValue(PLAN_LACKS_IT())
    const { container } = render(<Widget {...zoneProps} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
    expect(mockTrack).not.toHaveBeenCalled()
  })
})
