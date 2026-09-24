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
 * The org hub's Org automations card and the site hub's panel (AGL-3302).
 *
 * The routes prove who may write; this proves what the console SENDS them:
 * a new automation in the shape the manage door reads, placed where the
 * author chose; a pause that names one site; and nothing sent at all for a
 * draft the route would refuse. The editor offers only the org vocabulary —
 * no page view to start on, no workflow or webhook to run.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import OrgAutomationsCard from './org-automations-card.component'
import SiteOrgAutomationsPanel from './site-org-automations-panel.component'
import type { WorkflowsOrgMount } from './workflows-org-mount'

const collections: Record<string, Array<Record<string, unknown>>> = {
  automations: [],
  datasets: [],
  lists: [],
  emailCampaigns: [],
}

const mockApi = jest.fn(async (..._args: unknown[]) => ({}))

jest.mock('./use-org-automations-api', () => ({
  useOrgAutomationsApi: () => mockApi,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  where: () => undefined,
  limit: () => undefined,
  orderBy: () => undefined,
  documentId: () => '__name__',
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('./host-run-history-card.component', () => ({
  __esModule: true,
  default: () => null,
}))

const MOUNT: WorkflowsOrgMount = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [
    { id: 'site-a', name: 'Site A', subdomain: 'a' },
    { id: 'site-b', name: 'Site B', subdomain: 'b' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
  basePath: '/acme/automation',
}

/** A plan that carries the actions builder, so nothing is refused for that. */
const ORG = { plan: 'business' } as never

function seeded(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'auto-1',
    name: 'Welcome every lead',
    trigger: { event: 'formSubmission', conditions: null, combinator: null },
    steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'x' }],
    enabled: true,
    visibleTo: ['org'],
    pausedHostIds: [],
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(collections)) collections[key] = []
})

function open(label: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  return screen.getByRole('listbox')
}

function startDraft(name: string) {
  render(<OrgAutomationsCard mount={MOUNT} org={ORG} canEdit />)
  fireEvent.click(screen.getByRole('button', { name: 'Add org automation' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
}

describe('the Org automations card', () => {
  it('saves a new automation through the manage door, on every site', async () => {
    startDraft('Welcome every lead')
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Welcome' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Thanks' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save org automation' }))

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1))
    expect(mockApi).toHaveBeenCalledWith('manage', {
      orgId: 'org-1',
      action: 'create',
      automation: {
        name: 'Welcome every lead',
        trigger: { event: 'formSubmission' },
        steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks' }],
        enabled: true,
        visibleTo: ['org'],
      },
    })
  })

  it('places it on the sites the author ticks', async () => {
    startDraft('Site B only')
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'x' } })
    fireEvent.click(screen.getByLabelText('Chosen sites'))
    fireEvent.click(screen.getByLabelText('Site B'))

    fireEvent.click(screen.getByRole('button', { name: 'Save org automation' }))

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1))
    expect((mockApi.mock.calls[0][1] as any).automation.visibleTo).toEqual([
      'host:site-b',
    ])
  })

  it('refuses before the round trip what the route would refuse', () => {
    startDraft('No subject')

    fireEvent.click(screen.getByRole('button', { name: 'Save org automation' }))

    expect(mockApi).not.toHaveBeenCalled()
    expect(enqueueSnackbar).toHaveBeenCalledWith('Step 1: enter the subject', {
      variant: 'warning',
      persist: false,
    })
  })

  it('offers only the org vocabulary', () => {
    startDraft('Anything')

    const triggers = open('Trigger event')
    expect(within(triggers).getByRole('option', { name: 'Form submitted' })).toBeTruthy()
    expect(within(triggers).queryByRole('option', { name: 'Page viewed' })).toBeNull()
    fireEvent.click(within(triggers).getByRole('option', { name: 'Form submitted' }))

    const steps = open('Do')
    expect(within(steps).getByRole('option', { name: 'Send an email' })).toBeTruthy()
    expect(within(steps).queryByRole('option', { name: 'Run a workflow' })).toBeNull()
    expect(
      within(steps).queryByRole('option', { name: 'Send a webhook (Business)' }),
    ).toBeNull()
    expect(within(steps).queryByRole('option', { name: 'Show a popup or bar' })).toBeNull()
  })

  it('resumes a paused site from its chip, naming that site alone', async () => {
    collections['automations'] = [seeded({ pausedHostIds: ['site-a'] })]
    render(<OrgAutomationsCard mount={MOUNT} org={ORG} canEdit />)

    const chip = screen.getByText('Paused on Site A').closest('.MuiChip-root')
    fireEvent.click(within(chip as HTMLElement).getByTestId('CancelIcon'))

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('pause', {
        hostId: 'site-a',
        automationId: 'auto-1',
        paused: false,
      }),
    )
  })

  it('pauses one placed site from the row', async () => {
    collections['automations'] = [seeded({ pausedHostIds: ['site-a'] })]
    render(<OrgAutomationsCard mount={MOUNT} org={ORG} canEdit />)

    fireEvent.click(screen.getByRole('button', { name: 'Pause on…' }))
    // Only the sites still running it are offered.
    expect(screen.queryByRole('menuitem', { name: 'Pause on Site A' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause on Site B' }))

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('pause', {
        hostId: 'site-b',
        automationId: 'auto-1',
        paused: true,
      }),
    )
  })

  it('says where each one runs', () => {
    collections['automations'] = [
      seeded(),
      seeded({ $id: 'auto-2', name: 'Blog only', visibleTo: ['host:site-b'] }),
    ]
    render(<OrgAutomationsCard mount={MOUNT} org={ORG} canEdit />)

    expect(screen.getByText('Runs on every site')).toBeTruthy()
    expect(screen.getByText('Runs on Site B')).toBeTruthy()
  })

  it('offers a viewer no control that would refuse them', () => {
    collections['automations'] = [seeded({ pausedHostIds: ['site-a'] })]
    render(<OrgAutomationsCard mount={MOUNT} org={ORG} canEdit={false} />)

    expect(screen.queryByRole('button', { name: 'Add org automation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause on…' })).toBeNull()
    const chip = screen.getByText('Paused on Site A').closest('.MuiChip-root')
    expect(within(chip as HTMLElement).queryByTestId('CancelIcon')).toBeNull()
  })
})

describe('the site hub’s panel', () => {
  it('draws nothing where the organization runs nothing', () => {
    const { container } = render(<SiteOrgAutomationsPanel hostId="site-a" />)
    expect(container.textContent).toBe('')
  })

  it('pauses an org automation on this site, and names only this site', async () => {
    collections['automations'] = [seeded()]
    render(<SiteOrgAutomationsPanel hostId="site-a" />)

    expect(screen.getByText('Runs here')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause here' }))

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('pause', {
        hostId: 'site-a',
        automationId: 'auto-1',
        paused: true,
      }),
    )
  })

  it('resumes one this site paused', async () => {
    collections['automations'] = [seeded({ pausedHostIds: ['site-a'] })]
    render(<SiteOrgAutomationsPanel hostId="site-a" />)

    expect(screen.getByText('Paused here')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume here' }))

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('pause', {
        hostId: 'site-a',
        automationId: 'auto-1',
        paused: false,
      }),
    )
  })
})
