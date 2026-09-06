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
 * THE TASK DRAWER'S SITE PICKER AT THE ORGANIZATION LEVEL (AGL-2637).
 *
 * What it must hold: beneath the org hub a NEW task is asked where it is
 * filed even when the org has one site — the site, or the organization
 * itself — and the save is the route's ORG variant: `orgId` with the site
 * named beside it, or with no site at all for an organization task. Under
 * a site nothing is asked and the save names the site alone. An edit never
 * asks; at the org level it says where the task is filed, and an
 * organization task's edit can be saved (it has no site to wait for).
 *
 * The record pickers and the snooze menu are stubbed: they are other
 * specs' subjects and each opens a listener of its own.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import type { CrmTaskRow } from '../hooks/use-crm-tasks'
import { TaskEditDrawer } from './task-edit-drawer'

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteDoc: async () => undefined,
  where: (...args: unknown[]) => ({ type: 'where', args }),
}))

const USER = { uid: 'uid-me', getIdToken: async () => 'token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: USER }),
  writeGuardedBySeed: async (_seed: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
  // The org root from whichever identifier the scope hook hands over.
  useOrgDataScope: (options: { hostId?: string; orgId?: string }) => {
    const orgId = options.orgId ?? (options.hostId ? 'org-1' : undefined)
    return { orgId, ready: true, scope: orgId ? (['orgs', orgId] as const) : null }
  },
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: () => Promise.resolve(true) }),
}))
jest.mock('../hooks/use-org-member-directory', () => ({
  useOrgMemberDirectory: () => ({
    members: [{ uid: 'uid-me', label: 'Me', email: 'me@example.com', role: 'admin' }],
    loading: false,
    error: null,
    nameOf: (ref: string | null | undefined) => String(ref ?? ''),
  }),
}))
jest.mock('./crm-record-picker', () => ({
  __esModule: true,
  default: () => null,
  CrmRecordPicker: () => null,
}))
jest.mock('./task-snooze-menu', () => ({
  __esModule: true,
  default: () => null,
  TaskSnoozeMenu: () => null,
}))

/** The save route as the drawer reaches it — every body recorded. */
let saves: Array<Record<string, unknown>>
jest.mock('../model/task-api', () => ({
  saveCrmTask: async (_user: unknown, body: Record<string, unknown>) => {
    saves.push(body)
    return { ok: true, taskId: String(body['taskId'] ?? 'new-1'), notified: false }
  },
}))

const ORG = { $id: 'org-1' }
const SITE_A = { id: 'host-a', name: 'Site A', subdomain: 'a' }
const SITE_B = { id: 'host-b', name: 'Site B', subdomain: 'b' }

/** The hub's mount, as `CrmConsolePage` publishes it at `/[orgSlug]/crm`. */
function underOrg(hosts = [SITE_A]) {
  return function Mount({ children }: { children: ReactNode }) {
    return (
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hosts, hostsReady: true, hostsPath: '/acme/hosts' }}
      >
        {children}
      </CrmOrgMountProvider>
    )
  }
}

const task = (over: Partial<CrmTaskRow>): CrmTaskRow =>
  ({
    $id: 't-1',
    title: 'Renew the insurance',
    kind: 'todo',
    priority: 'normal',
    status: 'open',
    dueAtMs: null,
    notes: '',
    createdByUid: 'uid-me',
    visibleTo: ['org'],
    hostId: null,
    ...over,
  }) as CrmTaskRow

function open(props: {
  hostId: string | null
  task?: CrmTaskRow | null
  wrapper?: (props: { children: ReactNode }) => JSX.Element
}) {
  return render(
    <TaskEditDrawer
      open
      onClose={jest.fn()}
      hostId={props.hostId}
      org={ORG}
      orgId="org-1"
      scope={['orgs', 'org-1']}
      readTokens={props.hostId ? ['org', `host:${props.hostId}`] : null}
      task={props.task ?? null}
    />,
    { wrapper: props.wrapper },
  )
}

const sitePicker = () => screen.getByRole('combobox', { name: /^Site/ })
const pickSite = (option: string) => {
  fireEvent.mouseDown(sitePicker())
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}
const create = (title: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
}

beforeEach(() => {
  notices = []
  saves = []
  window.sessionStorage.clear()
})

describe('a new task beneath the organization hub', () => {
  it('asks where the task is filed even with ONE site — the site, or the organization', async () => {
    open({ hostId: null, wrapper: underOrg([SITE_A]) })
    // The only site is picked silently, as every other drawer picks it;
    // the field still shows, because the organization is the other answer.
    expect(sitePicker().textContent).toBe('Site A')
    fireEvent.mouseDown(sitePicker())
    const options = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Site A', 'This organization (no site)'])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Site A' }))

    create('Call the roaster')
    await waitFor(() => expect(saves).toHaveLength(1))
    // The org variant, with the site named beside the org.
    expect(saves[0]).toEqual({
      orgId: 'org-1',
      hostId: 'host-a',
      task: expect.objectContaining({ title: 'Call the roaster', assigneeUid: 'uid-me' }),
    })
    expect(notices).toEqual(['Task created'])
  })

  it('files an ORGANIZATION task — no site — through the org variant with no hostId at all', async () => {
    open({ hostId: null, wrapper: underOrg([SITE_A]) })
    pickSite('This organization (no site)')
    expect(sitePicker().textContent).toBe('This organization (no site)')
    expect(screen.getByText(/A task of the organization itself/)).toBeTruthy()

    create('Renew the insurance')
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({
      orgId: 'org-1',
      task: expect.objectContaining({ title: 'Renew the insurance' }),
    })
    expect('hostId' in saves[0]).toBe(false)
  })

  it('holds the submit with two sites until a site or the organization is picked', () => {
    open({ hostId: null, wrapper: underOrg([SITE_A, SITE_B]) })
    // Two sites and no pick: nothing is guessed, in either direction.
    expect(sitePicker().textContent).not.toMatch(/Site|organization/)
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    pickSite('This organization (no site)')
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    // Picking a site again clears the organization choice: one answer.
    pickSite('Site B')
    expect(sitePicker().textContent).toBe('Site B')
  })
})

describe('under a site', () => {
  it('asks nothing and saves as the site, with no orgId', async () => {
    open({ hostId: 'host-a' })
    expect(screen.queryByRole('combobox', { name: /^Site/ })).toBeNull()
    create('Send the deck')
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0]).toEqual({
      hostId: 'host-a',
      task: expect.objectContaining({ title: 'Send the deck' }),
    })
    expect('orgId' in saves[0]).toBe(false)
  })
})

describe('an edit beneath the organization hub', () => {
  it("says an organization task is filed with no site, and saves it through the org variant", async () => {
    open({ hostId: null, task: task({ hostId: null }), wrapper: underOrg([SITE_A]) })
    expect(screen.queryByRole('combobox', { name: /^Site/ })).toBeNull()
    expect(screen.getByText('Filed with the organization — no site.')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(saves).toHaveLength(1))
    // No site named: the route reads the task's own.
    expect(saves[0]).toEqual({
      orgId: 'org-1',
      taskId: 't-1',
      task: expect.objectContaining({ title: 'Renew the insurance' }),
    })
    expect('hostId' in saves[0]).toBe(false)
  })

  it("names the site a site's task is filed from", () => {
    open({
      hostId: null,
      task: task({ $id: 't-2', hostId: 'host-a', visibleTo: ['host:host-a'] }),
      wrapper: underOrg([SITE_A]),
    })
    expect(screen.getByText('Filed from Site A.')).toBeTruthy()
  })
})
