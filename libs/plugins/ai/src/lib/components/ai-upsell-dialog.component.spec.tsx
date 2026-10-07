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
 * `upgrade`). The same button is there on the first render, and it opens the
 * add-on's dialog, never the brief, and nothing asks a server anything.
 */

import { listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleWidgetUpgrade } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
        releaseFlag: 'release_ai_generative',
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
  it('is the same button, drawn at once, and opens the add-on with no request', () => {
    const Widget = widgetFor(zone, widgetId)
    render(<Widget {...zoneProps} entitled={false} upgrade={OWNER} />)
    const button = screen.getByRole('button', { name: 'Create with AI' })
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
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('tells a member who cannot buy it to ask an owner or admin, with no link', () => {
    const Widget = widgetFor(zone, widgetId)
    render(<Widget {...zoneProps} entitled={false} upgrade={MEMBER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(aiUpsellOffer(false))).toBeTruthy()
    expect(aiUpsellOffer(false)).toMatch(/Ask a workspace owner or admin/)
    expect(within(dialog).queryByRole('link')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(mockTrack).toHaveBeenCalledWith('ai_upsell_shown', { kind, can_manage: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stays absent when the shell gave it no way to buy it', () => {
    const Widget = widgetFor(zone, widgetId)
    const { container } = render(<Widget {...zoneProps} entitled={false} />)
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('opens the brief, not the add-on, where the plan includes it', () => {
    const Widget = widgetFor(zone, widgetId)
    render(<Widget {...zoneProps} entitled />)
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }))
    expect(within(screen.getByRole('dialog')).getByRole('textbox')).toBeTruthy()
    expect(mockTrack).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
