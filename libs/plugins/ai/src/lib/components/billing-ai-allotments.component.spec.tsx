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
 * AI allotments on Billing → Usage (AGL-2942), drawn as record lists
 * (AGL-3045).
 *
 * Members, sites and collaborators are three lists of records, each paged on
 * its own, so each is the shared grid — which scrolls its own columns inside
 * the card. What the grid has to keep from the tables it replaced: a manager
 * selects rows and sets one allotment for all of them, a row opens its own
 * allotment, and a reader without `billing.manage` gets neither.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { AiAllotmentsWire } from '../usage/ai-usage-wire'

jest.mock('@aglyn/aglyn/app-utils/docs-help', () => ({
  __esModule: true,
  pluginDocsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'manager-1' } }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/acme/billing/usage',
}))

let mockData: AiAllotmentsWire
jest.mock('./use-ai-allotments', () => ({
  __esModule: true,
  useAiAllotments: () => ({ status: 'ready', data: mockData, reload: () => undefined }),
  saveAiAllotments: jest.fn(async () => ({ ok: true, error: null })),
}))

// The editor is its own component with its own spec; here it only has to say
// which allotment it was opened for.
jest.mock('./ai-allotment-editor.component', () => ({
  __esModule: true,
  AiAllotmentEditor: (props: { open: boolean; title: string }) =>
    props.open ? <div role="dialog" aria-label={props.title} /> : null,
}))

import { BillingAiAllotments } from './billing-ai-allotments.component'

function allotments(patch: Partial<AiAllotmentsWire> = {}): AiAllotmentsWire {
  return {
    orgId: 'org-1',
    month: '2026-09',
    pool: { used: 2_000, limit: 10_000 },
    allotments: [
      {
        subject: 'member:u-ada',
        scope: 'member',
        uid: 'u-ada',
        hostId: null,
        credits: 1_000,
        mode: 'hard',
        models: null,
        used: 850,
      },
      {
        subject: 'collab:u-lin:host-a',
        scope: 'collab',
        uid: 'u-lin',
        hostId: 'host-a',
        credits: 200,
        mode: 'soft',
        models: null,
        used: 20,
      },
    ],
    members: [
      { uid: 'u-ada', name: 'Ada', email: null, role: 'admin', orgWide: true, credits: 850, byHost: {} },
      { uid: 'u-grace', name: 'Grace', email: null, role: 'member', orgWide: true, credits: 120, byHost: {} },
      { uid: 'u-lin', name: 'Lin', email: null, role: null, orgWide: false, credits: 20, byHost: {} },
    ],
    hosts: [
      { hostId: 'host-a', name: 'Wag & Co', credits: 400 },
      { hostId: 'host-b', name: 'Paws', credits: 60 },
    ],
    models: [],
    restrictionAvailable: false,
    canEdit: { billing: true, collaborators: true },
    callerUid: 'manager-1',
    ...patch,
  }
}

const grid = (name: string) => screen.getByRole('grid', { name })
const rowOf = (list: HTMLElement, text: string) =>
  within(list).getByText(text).closest('[role="row"]') as HTMLElement

beforeEach(() => {
  mockData = allotments()
})

describe('BillingAiAllotments (AGL-3045)', () => {
  it('draws members, sites and collaborators as three grids, and no bare table', () => {
    const { container } = render(<BillingAiAllotments orgId="org-1" />)
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const members = grid("Team members' AI allotments")
    const sites = grid("Sites' AI allotments")
    const collaborators = grid("Site collaborators' AI allotments")
    // A site collaborator is not a team member: their allotments are per site.
    expect(within(members).queryByText('Lin')).toBeNull()
    expect(within(rowOf(members, 'Ada')).getByText('850 of 1,000 (hard)')).toBeTruthy()
    expect(within(rowOf(sites, 'Paws')).getByText('60')).toBeTruthy()
    expect(within(rowOf(collaborators, 'Lin')).getByText('Wag & Co')).toBeTruthy()
  })

  it('sets one allotment for the selected members', () => {
    render(<BillingAiAllotments orgId="org-1" />)
    const members = grid("Team members' AI allotments")
    for (const name of ['Ada', 'Grace']) {
      fireEvent.click(within(rowOf(members, name)).getByRole('checkbox'))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Set for 2 selected' }))
    expect(screen.getByRole('dialog', { name: 'AI allotment — 2 members' })).toBeTruthy()
  })

  it('opens a row’s own allotment from the row', () => {
    render(<BillingAiAllotments orgId="org-1" />)
    fireEvent.click(within(rowOf(grid("Sites' AI allotments"), 'Paws')).getByText('Paws'))
    expect(screen.getByRole('dialog', { name: 'AI allotment — Paws' })).toBeTruthy()
  })

  it('offers no selection, no row action and no editor to a reader who cannot manage billing', () => {
    mockData = allotments({ canEdit: { billing: false, collaborators: false } })
    render(<BillingAiAllotments orgId="org-1" />)
    const members = grid("Team members' AI allotments")
    expect(within(members).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(members).queryByRole('button', { name: /allotment/ })).toBeNull()
    fireEvent.click(within(rowOf(members, 'Grace')).getByText('Grace'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
