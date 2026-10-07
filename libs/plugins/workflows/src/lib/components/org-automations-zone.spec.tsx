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
 * The Org automations card hosts `orgAutomations` (AGL-3603): in its header,
 * for a member who may write org automations, handing over this plugin's own
 * org vocabulary. An automation proposed through it opens in the editor as a
 * NEW one, unsaved and switched off — Save is still the only write — and one
 * the section cannot hold, or a plan without the actions builder, is refused
 * with nothing opened.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  ORG_AUTOMATION_STEP_TYPES,
  ORG_AUTOMATION_TRIGGER_EVENTS,
} from '../model/org-automations'
import { orgAutomationDraftFromProposal } from './org-automation-editor.component'
import OrgAutomationsCard from './org-automations-card.component'
import type { OrgAutomationProposal } from './workflow-zones'
import type { WorkflowsOrgMount } from './workflows-org-mount'

const mockApi = jest.fn(async (..._args: unknown[]) => ({}))

jest.mock('./use-org-automations-api', () => ({
  useOrgAutomationsApi: () => mockApi,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
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
  CardDisplay: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div data-testid="card-header-actions">{actions}</div>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

const MOUNT: WorkflowsOrgMount = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [{ id: 'site-a', name: 'Site A', subdomain: 'a' }],
  hostsReady: true,
  hostsPath: '/acme/hosts',
  basePath: '/acme/automation',
}

const BUSINESS = { plan: 'business' } as never
const FREE = { plan: 'free' } as never

const PROPOSAL: OrgAutomationProposal = {
  name: 'Welcome every booking',
  trigger: { event: 'booking', conditions: [{ field: 'serviceName', op: 'equals', value: 'Consultation' }] },
  steps: [{ type: 'addContactTag', tag: 'booked' }],
}

let drawn: Array<{ slot: string; props: Record<string, unknown> }> = []

function ShellSlot({ slot, ...props }: { slot: string } & Record<string, unknown>) {
  drawn.push({ slot, props })
  return <div data-testid={`zone-${slot}`} />
}

function renderInShell(options: { org?: never; canEdit?: boolean } = {}) {
  return render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot}>
      <OrgAutomationsCard mount={MOUNT} org={options.org ?? BUSINESS} canEdit={options.canEdit ?? true} />
    </ConsoleWidgetSlotContext.Provider>,
  )
}

const zoneProps = () => [...drawn].reverse().find((entry) => entry.slot === 'orgAutomations')?.props

beforeEach(() => {
  drawn = []
  jest.clearAllMocks()
})

describe('the Org automations card hosts orgAutomations', () => {
  it('draws it in the card’s header with this plugin’s org vocabulary', () => {
    renderInShell()
    expect(within(screen.getByTestId('card-header-actions')).getByTestId('zone-orgAutomations')).toBeTruthy()
    expect(zoneProps()).toEqual({
      orgId: 'org-1',
      triggers: ORG_AUTOMATION_TRIGGER_EVENTS,
      steps: ORG_AUTOMATION_STEP_TYPES,
      propose: expect.any(Function),
    })
  })

  it('draws none for a member who may not write org automations', () => {
    renderInShell({ canEdit: false })
    expect(screen.queryByTestId('zone-orgAutomations')).toBeNull()
  })

  it('opens a proposal in the editor as a new automation, switched off, and saves only on Save', async () => {
    renderInShell()
    let opened = false
    act(() => {
      opened = (zoneProps()?.['propose'] as (proposal: OrgAutomationProposal) => boolean)(PROPOSAL)
    })
    expect(opened).toBe(true)
    expect(mockApi).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Welcome every booking')

    fireEvent.click(screen.getByRole('button', { name: 'Save org automation' }))
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1))
    expect(mockApi).toHaveBeenCalledWith(
      'manage',
      expect.objectContaining({
        action: 'create',
        automation: expect.objectContaining({
          name: 'Welcome every booking',
          enabled: false,
          visibleTo: ['org'],
          trigger: expect.objectContaining({ event: 'booking' }),
          steps: [{ type: 'addContactTag', tag: 'booked' }],
        }),
      }),
    )
  })

  it('refuses a plan without the actions builder, opening nothing', () => {
    renderInShell({ org: FREE })
    let opened = true
    act(() => {
      opened = (zoneProps()?.['propose'] as (proposal: OrgAutomationProposal) => boolean)(PROPOSAL)
    })
    expect(opened).toBe(false)
    expect(enqueueSnackbar).toHaveBeenCalled()
    expect(screen.queryByLabelText('Name')).toBeNull()
  })
})

describe('a proposal as the editor opens it', () => {
  it('is new, off and on every site, with its conditions as rows', () => {
    expect(orgAutomationDraftFromProposal(PROPOSAL)).toEqual(
      expect.objectContaining({
        id: null,
        name: 'Welcome every booking',
        event: 'booking',
        enabled: false,
        placement: 'org',
        conditionRows: [{ field: 'serviceName', op: 'equals', value: 'Consultation' }],
        steps: [{ type: 'addContactTag', tag: 'booked' }],
      }),
    )
  })

  it('is refused for a trigger or a step only one site has', () => {
    expect(orgAutomationDraftFromProposal({ ...PROPOSAL, trigger: { event: 'pageView' } })).toBeNull()
    expect(orgAutomationDraftFromProposal({ ...PROPOSAL, steps: [{ type: 'runWorkflow', workflowId: 'wf-1' }] })).toBeNull()
    expect(orgAutomationDraftFromProposal({ ...PROPOSAL, steps: [] })).toBeNull()
  })
})
