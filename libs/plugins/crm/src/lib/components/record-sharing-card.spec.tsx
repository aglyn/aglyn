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
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { CRM_PERMISSIONS } from '../model/crm-permissions'
import { CrmBulkShareButton, RecordSharingCard } from './record-sharing-card'

// The CRM's key, as the declarations register it in every process.
registerPluginPermissions(CRM_PERMISSIONS)

const REFUSAL = 'Your role does not include "Change CRM settings" — ask an organization admin'

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

  it('switches off the share and the unshare, naming the permission, for a member without "Change CRM settings"', () => {
    role = 'editor'
    render(
      <RecordSharingCard object="leads" id="l1" record={shared} hostId="site-a" orgId="org-1" org={org} />,
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share with sites…' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Stop sharing/ }).disabled).toBe(true)
    expect(screen.getAllByLabelText(REFUSAL).length).toBe(2)
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

  it('shows a record nobody shared to a member who cannot share it, with the share switched off', () => {
    role = 'editor'
    render(
      <RecordSharingCard
        object="deals"
        id="d1"
        record={{ hostId: 'site-a', visibleTo: ['host:site-a'] }}
        hostId="site-a"
        orgId="org-1"
        org={org}
      />,
    )
    expect(screen.getByText(/Not shared with any other site/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share with sites…' }).disabled).toBe(true)
    expect(screen.getByLabelText(REFUSAL)).toBeTruthy()
  })
})

describe('"Share with sites…" on a bulk bar (AGL-4047)', () => {
  it('opens for a member holding "Change CRM settings"', () => {
    render(<CrmBulkShareButton object="leads" ids={['l1']} hostId="site-a" orgId="org-1" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share with sites…' }).disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('is switched off, naming the permission, for a member without it', () => {
    role = 'editor'
    render(<CrmBulkShareButton object="leads" ids={['l1']} hostId="site-a" orgId="org-1" />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share with sites…' }).disabled).toBe(true)
    expect(screen.getByLabelText(REFUSAL)).toBeTruthy()
    expect(calls.some((call) => call.action === 'sites')).toBe(false)
  })
})

describe('sharing with all sites except some (AGL-4047)', () => {
  it('offers the choice as radios and a visible list, and sends the sites left out', async () => {
    render(<CrmBulkShareButton object="leads" ids={['l1', 'l2']} hostId="site-a" orgId="org-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share with sites…' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /^All sites except/ })).toBeTruthy())
    expect(screen.queryByRole('combobox')).toBeNull()
    // Nothing is chosen until the manager chooses.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /^All sites except/ }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Brand A' })).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brand A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        scope: { hostId: 'site-a' },
        action: 'share',
        object: 'leads',
        ids: ['l1', 'l2'],
        targets: { mode: 'allExcept', exceptHostIds: ['site-a'] },
        access: 'read',
      }),
    )
  })

  it('won’t send a choice that leaves nothing out', async () => {
    render(<CrmBulkShareButton object="leads" ids={['l1']} hostId="site-a" orgId="org-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share with sites…' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /^All sites except/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('radio', { name: /^All sites except/ }))
    await waitFor(() =>
      expect(screen.getByText('Choose at least one site to leave out, or share with All sites.')).toBeTruthy(),
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share' }).disabled).toBe(true)
  })

  it('names the sites that already hold the record, which keep it', async () => {
    render(
      <RecordSharingCard
        object="leads"
        id="l1"
        record={{ hostId: 'site-a', visibleTo: ['host:site-a'] }}
        hostId="site-a"
        orgId="org-1"
        org={org}
      />,
    )
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share with sites…' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Share with sites…' }))
    await waitFor(() =>
      expect(screen.getByText('Brand A already holds this lead, and keeps it whatever you choose.')).toBeTruthy(),
    )
  })

  it('lists and unshares a hand share with all sites except some as one line', async () => {
    const record = {
      hostId: 'site-a',
      visibleTo: ['host:site-a', 'host:site-b'],
      writeTo: ['host:site-a'],
      sharing: {
        grants: {
          manual_except: {
            source: 'manual',
            tokens: ['host:site-b'],
            except: ['host:site-c'],
            access: 'read',
            byUid: 'u',
            byName: 'Dana',
            atMs: 1,
          },
        },
        tokens: ['host:site-b'],
        added: ['host:site-b'],
        ruleIds: [],
        orgWideHeldBy: [],
        hasExcept: true,
      },
    }
    render(<RecordSharingCard object="leads" id="l1" record={record} hostId="site-a" orgId="org-1" org={org} />)
    await waitFor(() => expect(screen.getByText(/All sites except another site — shared by Dana/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing with All sites except another site' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        scope: { hostId: 'site-a' },
        action: 'unshare',
        object: 'leads',
        ids: ['l1'],
        targets: 'allExcept',
      }),
    )
  })
})
