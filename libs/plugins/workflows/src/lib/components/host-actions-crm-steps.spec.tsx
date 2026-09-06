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
 * The CRM steps in the actions editor (AGL-2605).
 *
 * The runtime specs prove what each step WRITES. This one proves an author
 * can BUILD one: the trigger picker offers the CRM events in words rather
 * than as identifiers, choosing one surfaces the payload keys a filter may
 * name, and the "Do" menu offers the CRM steps, whose fields land in the
 * saved document in exactly the shape the executor reads.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: [],
  workflows: [],
  overlays: [],
  datasets: [],
  lists: [],
  campaigns: [],
  webhooks: [],
  screens: [],
}

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => mockCreateResource,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionCeiling,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  where: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock('./host-activity-card.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** A plan that entitles the builder, so nothing is refused for that reason. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
})

/** Opens a select by its label and returns its listbox. */
function open(label: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  return screen.getByRole('listbox')
}

/** Opens a select by its label and picks the option with this name. */
function pick(label: string, option: string) {
  fireEvent.click(within(open(label)).getByRole('option', { name: option }))
}

function startAction(name: string) {
  render(<HostActionsCard hostId="host-1" org={ORG} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
}

async function savedPayload() {
  fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  return (setDoc as jest.Mock).mock.calls[0][1] as {
    trigger: { event: string }
    steps: Array<Record<string, unknown>>
  }
}

describe('HostActionsCard CRM steps (AGL-2605)', () => {
  it('offers the CRM events in words, names their payload, and saves a tag step', async () => {
    startAction('Welcome')

    const events = open('Trigger event')
    expect(
      within(events).getByRole('option', { name: 'Contact created' }),
    ).toBeTruthy()
    expect(
      within(events).getByRole('option', { name: 'Contact changed stage' }),
    ).toBeTruthy()
    // The identifier is what is STORED, not what the author is shown.
    expect(
      within(events).queryByRole('option', { name: 'contactCreated' }),
    ).toBeNull()
    fireEvent.click(
      within(events).getByRole('option', { name: 'Contact created' }),
    )

    // The keys a filter or a condition may name for the chosen event.
    expect(
      screen.getByText(
        'In scope: contactId, email, name, source, hostId, lifecycleStage, campaignIds.',
      ),
    ).toBeTruthy()

    pick('Do', 'Tag the contact')
    fireEvent.change(screen.getByLabelText('Tag'), {
      target: { value: 'vip' },
    })

    const payload = await savedPayload()
    expect(payload.trigger.event).toBe('contactCreated')
    expect(payload.steps).toHaveLength(1)
    expect(payload.steps[0]).toMatchObject({ type: 'addContactTag', tag: 'vip' })
    expect(enqueueSnackbar).not.toHaveBeenCalledWith(
      expect.stringMatching(/tag/i),
      expect.anything(),
    )
  })

  it('saves a task step with its kind, due date and assignee', async () => {
    startAction('Follow up')
    pick('Trigger event', 'Contact changed stage')

    pick('Do', 'Create a CRM task')
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Call them back' },
    })
    pick('Kind', 'Email')
    fireEvent.change(screen.getByLabelText('Due in (days)'), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText('Assignee (email address or member id, optional)'), {
      target: { value: 'sam@example.com' },
    })

    const payload = await savedPayload()
    expect(payload.trigger.event).toBe('contactStageChanged')
    expect(payload.steps[0]).toMatchObject({
      type: 'createCrmTask',
      title: 'Call them back',
      kind: 'email',
      dueInDays: 3,
      assigneeEmail: 'sam@example.com',
    })
  })

  it('stores a teammate typed by member id as a uid, never as an address', async () => {
    // The member whose account carries no address is named this way, and
    // the stored step must reach the executor's uid slot — an id in the
    // email slot would be refused by the validator before it got there.
    startAction('Follow up')
    pick('Trigger event', 'Contact changed stage')

    pick('Do', 'Create a CRM task')
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Call them back' },
    })
    fireEvent.change(screen.getByLabelText('Assignee (email address or member id, optional)'), {
      target: { value: 'uid-grace' },
    })

    const payload = await savedPayload()
    expect(payload.steps[0]).toMatchObject({
      type: 'createCrmTask',
      assigneeUid: 'uid-grace',
    })
    expect(payload.steps[0].assigneeEmail).toBeUndefined()
  })

  it('starts a stage step on a real stage, so the default saves', async () => {
    startAction('Qualify')
    pick('Trigger event', 'Form submitted')
    pick('Do', 'Set the contact’s lifecycle stage')
    pick('Stage', 'Customer')

    const payload = await savedPayload()
    expect(payload.steps[0]).toMatchObject({
      type: 'setContactStage',
      lifecycleStage: 'customer',
    })
  })
})
