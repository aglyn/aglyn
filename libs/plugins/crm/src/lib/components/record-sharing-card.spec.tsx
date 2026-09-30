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
 * The Sharing card (AGL-3336): where a record is visible and why, sources
 * kept apart; "Share with sites…" and the one-click unshare for an org
 * manager only; and, on a site that sees the record through a read-only
 * share, the sentence saying the page's edits will be refused.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RecordSharingCard } from './record-sharing-card'

let role: string | undefined = 'owner'
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-dana', getIdToken: async () => 'token' } }),
  useFirestoreDoc: () => ({ data: role ? { role } : undefined, status: 'success', fromCache: false }),
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
const calls: Array<Record<string, unknown>> = []
jest.mock('../model/crm-sharing-api', () => ({
  callCrmSharing: async (_user: unknown, scope: unknown, action: string, body: Record<string, unknown> = {}) => {
    calls.push({ scope, action, ...body })
    return action === 'sites'
      ? { ok: true, sites: [{ id: 'site-a', name: 'Brand A' }, { id: 'site-b', name: 'Brand B' }] }
      : { ok: true, changed: 1 }
  },
}))

const shared = {
  hostId: 'site-a',
  capturedByHostIds: ['site-a'],
  visibleTo: ['host:site-a', 'host:site-b', 'org'],
  writeTo: ['host:site-a'],
  sharing: {
    grants: {
      'manual_site-b': { source: 'manual', tokens: ['host:site-b'], access: 'read', byUid: 'u', byName: 'Dana', atMs: 1 },
      rule_r1: { source: 'rule', ruleId: 'r1', tokens: ['org'], access: 'read', atMs: 1 },
    },
    tokens: ['host:site-b', 'org'],
    added: ['host:site-b', 'org'],
    ruleIds: ['r1'],
    orgWideHeldBy: ['host:site-a'],
  },
}
const org = {
  crm: { sharingRules: [{ id: 'r1', name: 'Brand A leads', object: 'leads', targets: ['org'] }] },
}

beforeEach(() => {
  role = 'owner'
  calls.length = 0
  enqueueSnackbar.mockReset()
})

describe('the Sharing card (AGL-3336)', () => {
  it('lists the holding sites, the hand share with who shared it, and the rule — and unshares in one click', async () => {
    render(
      <RecordSharingCard object="leads" id="l1" record={shared} hostId="site-a" orgId="org-1" org={org} />,
    )
    await waitFor(() => expect(screen.getByText(/Held by Brand A/)).toBeTruthy())
    expect(screen.getByText(/Brand B — shared by Dana/)).toBeTruthy()
    expect(screen.getByText(/All sites — by the rule “Brand A leads”, read-only/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share with sites…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing with Brand B' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        scope: { hostId: 'site-a' },
        action: 'unshare',
        object: 'leads',
        ids: ['l1'],
        targets: ['site-b'],
      }),
    )
  })

  it('offers no share and no unshare to a member who is not an owner or admin', () => {
    role = 'editor'
    render(
      <RecordSharingCard object="leads" id="l1" record={shared} hostId="site-a" orgId="org-1" org={org} />,
    )
    expect(screen.queryByRole('button', { name: 'Share with sites…' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Stop sharing/ })).toBeNull()
    // …and never asks for the org's sites.
    expect(calls.some((call) => call.action === 'sites')).toBe(false)
  })

  it('says a read-only share cannot be changed from the site it was shared with', () => {
    role = 'editor'
    render(
      <RecordSharingCard
        object="leads"
        id="l1"
        record={shared}
        hostId="site-b"
        orgId="org-1"
        org={org}
        viewingHostIds={['site-b']}
      />,
    )
    expect(screen.getByText(/Shared with this site read-only/)).toBeTruthy()
    expect(screen.getByText(/Shared by Dana\./)).toBeTruthy()
  })

  it('draws nothing for a record nobody shared, to a member who cannot share it', () => {
    role = 'editor'
    const { container } = render(
      <RecordSharingCard
        object="deals"
        id="d1"
        record={{ hostId: 'site-a', visibleTo: ['host:site-a'] }}
        hostId="site-a"
        orgId="org-1"
        org={org}
      />,
    )
    expect(container.innerHTML).toBe('')
  })
})
