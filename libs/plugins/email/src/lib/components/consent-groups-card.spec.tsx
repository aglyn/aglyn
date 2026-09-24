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
 *
 * @jest-environment jsdom
 */

/**
 * The organization's consent groups (AGL-3320): a list with **New group** in
 * its header and a menu on each row, never a form above the table; read-only,
 * with the reason, for a member who may not change it; disabled, with the
 * reason, for an org with one site or a change still running; and the running
 * change shown above the table until it is done.
 */

import { consentGroupDisclosure, consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Documents the member may read, by path. */
let mockDocs: Record<string, Record<string, unknown>> = {}

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: (buildRef: () => { path: string } | null) => {
    const ref = buildRef()
    if (!ref) return { data: undefined, status: 'loading' }
    return { data: mockDocs[ref.path], status: 'success' }
  },
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
      <header data-testid="card-header">{HeaderProps?.action}</header>
      <div data-testid="card-body">{children}</div>
    </section>
  ),
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/scroll-table.component', () => ({
  ScrollTable: ({ children }: { children: ReactNode }) => <table>{children}</table>,
}))
// The row overflow, flattened to its items.
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: ({ items, label }: { items: any[]; label: string }) => (
    <div aria-label={`Actions for ${label}`}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          title={item.disabledReason}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

/** The props the dialog was last rendered with, or null when it is closed. */
let mockDialogProps: Record<string, any> | null = null
jest.mock('./consent-group-dialog', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    mockDialogProps = props
    return <div>{'the dialog'}</div>
  },
}))
/** The props the progress banner was last rendered with. */
let mockProgressProps: Record<string, any> | null = null
jest.mock('./consent-group-change-progress', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    mockProgressProps = props
    return <div>{`progress for ${props.changeId}`}</div>
  },
}))

import ConsentGroupsCard from './consent-groups-card'
import { EmailOrgMountProvider } from './email-org-mount'

const MEMBER = 'orgs/org-1/members/uid-1'
const SITES = [
  { id: 'shop', name: 'Shop', subdomain: 'shop' },
  { id: 'blog', name: 'Blog', subdomain: 'blog' },
  { id: 'camp', name: 'Camp', subdomain: 'camp' },
]
const DECLARED = {
  consentGroups: { g_home: { name: 'Home goods', hostIds: ['shop', 'blog'] } },
}

function renderCard(
  org: Record<string, unknown>,
  sites: typeof SITES = SITES,
) {
  const view = (next: Record<string, unknown>) => (
    <EmailOrgMountProvider
      mount={{
        orgId: 'org-1',
        orgSlug: 'acme',
        hosts: sites,
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
      basePath="/acme/emails"
    >
      <ConsentGroupsCard org={next} />
    </EmailOrgMountProvider>
  )
  const result = render(view(org))
  return { ...result, rerenderWith: (next: Record<string, unknown>) => result.rerender(view(next)) }
}

const newGroup = () => screen.getByRole('button', { name: 'New group' }) as HTMLButtonElement

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs = { [MEMBER]: { role: 'owner', allHosts: true } }
  mockDialogProps = null
  mockProgressProps = null
})

describe('the list', () => {
  it('says what an org with no group has, and offers New group', () => {
    renderCard({})
    expect(
      screen.getByText(
        'No consent groups yet. Every site is its own sender: someone who signs up on one site hears only from that site, and an unsubscribe applies to that site alone.',
      ),
    ).toBeTruthy()
    expect(newGroup().disabled).toBe(false)
  })

  it('lists each group with its id, its sites by name and what its forms say', () => {
    renderCard(DECLARED)
    const row = screen.getByText('Home goods').closest('tr') as HTMLElement
    expect(within(row).getByText('g_home')).toBeTruthy()
    expect(within(row).getByText('Shop')).toBeTruthy()
    expect(within(row).getByText('Blog')).toBeTruthy()
    expect(
      within(row).getByText(
        consentGroupDisclosure(consentGroupForHost(DECLARED, 'shop')) as string,
      ),
    ).toBeTruthy()
  })

  it('puts New group in the header and no input anywhere in the body', () => {
    renderCard(DECLARED)
    expect(within(screen.getByTestId('card-header')).getByRole('button', { name: 'New group' })).toBeTruthy()
    const body = screen.getByTestId('card-body')
    expect(body.querySelectorAll('input, textarea, select')).toHaveLength(0)
  })

  it('says how many stored entries nothing honors', () => {
    renderCard({
      consentGroups: {
        ...DECLARED.consentGroups,
        broken: { name: '', hostIds: ['camp', 'shop'] },
      },
    })
    expect(screen.getByText(/One saved consent group can’t be used/)).toBeTruthy()
  })
})

describe('opening the dialog', () => {
  it('New group opens it to create', () => {
    renderCard(DECLARED)
    fireEvent.click(newGroup())
    expect(mockDialogProps).toMatchObject({
      open: true,
      mode: 'create',
      groupId: null,
      orgId: 'org-1',
      sites: SITES,
    })
  })

  it('a row’s menu opens it to edit or to dissolve that group', () => {
    renderCard(DECLARED)
    fireEvent.click(screen.getByRole('button', { name: 'Edit group' }))
    expect(mockDialogProps).toMatchObject({ mode: 'edit', groupId: 'g_home' })
    act(() => mockDialogProps?.onClose())
    expect(screen.queryByText('the dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dissolve group' }))
    expect(mockDialogProps).toMatchObject({ mode: 'dissolve', groupId: 'g_home' })
  })
})

describe('when the controls are off', () => {
  it('an org with one site cannot declare a group, and says why', () => {
    renderCard({}, SITES.slice(0, 1))
    expect(newGroup().disabled).toBe(true)
    expect(screen.getByText('A consent group needs at least two sites.')).toBeTruthy()
  })

  it('is read-only for a member without the org settings permission, and names it', () => {
    mockDocs[MEMBER] = { role: 'editor', allHosts: true }
    renderCard(DECLARED)
    expect(newGroup().disabled).toBe(true)
    const reason =
      'You need the Organization settings permission to change consent groups.'
    expect(screen.getByText(reason)).toBeTruthy()
    const edit = screen.getByRole('button', { name: 'Edit group' }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect(edit.title).toBe(reason)
    fireEvent.click(newGroup())
    expect(mockDialogProps).toBeNull()
  })

  it('names the console’s own permission when that is the one missing', () => {
    mockDocs[MEMBER] = {
      role: 'admin',
      allHosts: true,
      permissions: { 'data.manage': false },
    }
    renderCard(DECLARED)
    expect(
      screen.getByText('You need the Manage data permission to change consent groups.'),
    ).toBeTruthy()
  })
})

describe('a change that is running', () => {
  const RUNNING = {
    ...DECLARED,
    consentGroupsChange: {
      changeId: 'chg_1',
      phase: 'carry',
      hostIds: ['shop', 'blog'],
      startedAtMs: 1,
    },
  }

  it('shows the change above the table, driven by a member who may change groups', () => {
    renderCard(RUNNING)
    expect(screen.getByText('progress for chg_1')).toBeTruthy()
    expect(mockProgressProps).toMatchObject({
      orgId: 'org-1',
      changeId: 'chg_1',
      canDrive: true,
    })
    expect(mockProgressProps?.marker).toMatchObject({ changeId: 'chg_1', phase: 'carry' })
  })

  it('holds every control until it is done, and marks the groups it touches', () => {
    renderCard(RUNNING)
    expect(newGroup().disabled).toBe(true)
    expect(screen.getByText('Finishing the last change.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Dissolve group' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText('Changing')).toBeTruthy()
  })

  it('shows it, without the controls to drive it, to a member who may not', () => {
    mockDocs[MEMBER] = { role: 'viewer', allHosts: true }
    renderCard(RUNNING)
    expect(mockProgressProps?.canDrive).toBe(false)
  })

  it('announces the end once, when the marker leaves the org document', () => {
    const { rerenderWith } = renderCard(RUNNING)
    rerenderWith(DECLARED)
    rerenderWith({ ...DECLARED })
    expect(screen.queryByText(/progress for/)).toBeNull()
    expect(enqueueSnackbar).toHaveBeenCalledTimes(1)
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Consent groups updated',
      expect.objectContaining({ variant: 'success' }),
    )
  })
})

describe('after the dialog applies a change', () => {
  it('shows the change it started before the org document catches up', () => {
    renderCard(DECLARED)
    fireEvent.click(newGroup())
    act(() => mockDialogProps?.onApplied({ changeId: 'chg_2', done: false }))
    expect(screen.queryByText('the dialog')).toBeNull()
    expect(screen.getByText('progress for chg_2')).toBeTruthy()
  })

  it('announces a change that finished inside the request, once', () => {
    const { rerenderWith } = renderCard(DECLARED)
    fireEvent.click(newGroup())
    act(() => mockDialogProps?.onApplied({ changeId: 'chg_3', done: true }))
    // The listener may still deliver the marker and its removal afterwards.
    rerenderWith({
      ...DECLARED,
      consentGroupsChange: { changeId: 'chg_3', phase: 'sweep', hostIds: [], startedAtMs: 1 },
    })
    rerenderWith(DECLARED)
    expect(enqueueSnackbar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/progress for/)).toBeNull()
  })

  it('stops showing a change the banner reports finished', () => {
    renderCard(DECLARED)
    fireEvent.click(newGroup())
    act(() => mockDialogProps?.onApplied({ changeId: 'chg_4', done: false }))
    act(() => mockProgressProps?.onFinished('canceled'))
    expect(screen.queryByText(/progress for/)).toBeNull()
    // A stop says its own sentence; the card does not add "updated".
    expect(enqueueSnackbar).not.toHaveBeenCalled()
  })
})
