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
 * ADDING CRM CONTACTS TO AN AUDIENCE GOES THROUGH THE AUDIENCE'S OWN DOOR
 * (AGL-2603).
 *
 * The properties a second membership path would get wrong, pinned: the
 * dialog calls the two membership routes with the caller's token and the
 * `{ hostId, listId, emails }` body the audience page sends; a selection
 * larger than a call takes is sent in hundreds and the verdicts summed; the
 * add is offered only after the check; people with no opt-in on record are
 * added only under the attestation; whoever was not added is named.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AddToListDialog, LIST_MEMBER_REQUEST_CHUNK } from './add-to-list-dialog'

const FIRESTORE = {}
let audiences: Array<Record<string, unknown>>
let audiencesStatus: 'success' | 'error'
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: () => ({
    data: audiences,
    status: audiencesStatus,
    fromCache: false,
  }),
  useUser: () => ({ data: { uid: 'uid-me', getIdToken: async () => 'token-abc' } }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: unknown) => base,
  orderBy: () => undefined,
  limit: () => undefined,
}))
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

/** Every request the dialog made, as `[route, body, Authorization]`. */
let calls: Array<[string, any, string | undefined]>
let previewAnswer: (emails: string[]) => Record<string, unknown>
let addAnswer: (emails: string[]) => Record<string, unknown>

beforeEach(() => {
  calls = []
  notices = []
  audiences = [
    { $id: 'list-news', name: 'Newsletter', kind: 'manual' },
    { $id: 'list-vip', name: 'VIP', kind: 'dynamic' },
  ]
  audiencesStatus = 'success'
  previewAnswer = (emails) => ({
    verdicts: emails.map((email) => ({
      input: email,
      email,
      refusal: null,
      requiresAttestation: false,
      summary: 'Opted in',
    })),
    optedIn: emails.length,
    needAttestation: 0,
    refused: 0,
  })
  addAnswer = (emails) => ({
    added: emails.length,
    results: emails.map((email) => ({ input: email, email, enrolled: true })),
  })
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    const route = String(url).replace('/api/email/', '')
    const body = JSON.parse(init.body)
    calls.push([route, body, init?.headers?.Authorization])
    const payload =
      route === 'list-members-preview'
        ? previewAnswer(body.emails)
        : addAnswer(body.emails)
    return { ok: true, json: async () => payload } as any
  })
})

const mount = (emails: string[], extra: Record<string, unknown> = {}) =>
  render(
    <AddToListDialog
      open
      onClose={jest.fn()}
      hostId="host-1"
      scope={['orgs', 'org-1']}
      emails={emails}
      {...extra}
    />,
  )

const pickAudience = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Audience' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(name))
}

describe('checking before adding', () => {
  it('offers the audiences by name and asks the preview route for the list', async () => {
    mount(['a@example.com', 'B@Example.com', 'a@example.com'])
    pickAudience('Newsletter')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0][0]).toBe('list-members-preview')
    // Deduplicated and lowercased, the way the route will read them.
    expect(calls[0][1]).toEqual({
      hostId: 'host-1',
      listId: 'list-news',
      emails: ['a@example.com', 'b@example.com'],
    })
    expect(calls[0][2]).toBe('Bearer token-abc')
    expect(await screen.findByText('2 already opted in')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add 2' })).toBeTruthy()
  })

  it('offers no add until the check has run', () => {
    mount(['a@example.com'])
    pickAudience('Newsletter')
    expect(screen.queryByRole('button', { name: /^Add \d/ })).toBeNull()
  })

  it('sends a large selection in hundreds and sums the verdicts', async () => {
    const many = Array.from(
      { length: LIST_MEMBER_REQUEST_CHUNK + 1 },
      (_, i) => `p${i}@example.com`,
    )
    mount(many)
    pickAudience('Newsletter')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map(([, body]) => body.emails.length)).toEqual([
      LIST_MEMBER_REQUEST_CHUNK,
      1,
    ])
    expect(
      await screen.findByText(`${LIST_MEMBER_REQUEST_CHUNK + 1} already opted in`),
    ).toBeTruthy()
  })
})

describe('adding', () => {
  it('adds through the membership route, and names whoever was not added', async () => {
    addAnswer = (emails) => ({
      added: 1,
      results: emails.map((email, i) =>
        i === 0
          ? { input: email, email, enrolled: true }
          : {
              input: email,
              email,
              enrolled: false,
              error: 'This address is on your suppression list.',
            },
      ),
    })
    const onAdded = jest.fn()
    mount(['a@example.com', 'b@example.com'], { onAdded })
    pickAudience('Newsletter')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1][0]).toBe('list-members-add')
    expect(calls[1][1]).toEqual({
      hostId: 'host-1',
      listId: 'list-news',
      emails: ['a@example.com', 'b@example.com'],
      attestConsent: false,
    })
    expect(
      await screen.findByText(/b@example\.com — not added\. This address is on your suppression list\./),
    ).toBeTruthy()
    expect(onAdded).toHaveBeenCalledWith(1)
    expect(notices).toContain('One person added')
  })

  it('adds people with no opt-in only under the attestation, and sends it', async () => {
    previewAnswer = (emails) => ({
      verdicts: emails.map((email) => ({
        input: email,
        email,
        refusal: null,
        requiresAttestation: true,
        summary: 'No opt-in on record',
      })),
      optedIn: 0,
      needAttestation: emails.length,
      refused: 0,
    })
    mount(['a@example.com'])
    pickAudience('Newsletter')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    const add = (await screen.findByRole('button', { name: 'Add 1' })) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1][1]).toMatchObject({ attestConsent: true })
  })
})

describe('who may reach the audiences', () => {
  it('says who manages audiences when the listen is refused, rather than showing an empty picker', () => {
    audiences = []
    audiencesStatus = 'error'
    mount(['a@example.com'])
    expect(screen.queryByRole('combobox', { name: 'Audience' })).toBeNull()
    expect(screen.getByText(/Audiences are managed by members/)).toBeTruthy()
  })
})
