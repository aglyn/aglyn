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
 * The list card, and what it tells a merchant before they add somebody.
 *
 * The assertions that matter are about the SCREEN: whether the consent facts
 * are stated, whether the assertion control appears on the one state that
 * needs it, and whether the button can be pressed without it. Building a
 * screen that claimed a check it had not performed is the specific failure
 * this feature was held back to avoid, so the surface gets its own file.
 *
 * The rule itself is asserted in `../model/list-assignment-policy.spec.ts` and
 * the route in `../server-assign-list.spec.ts`; nothing here re-derives it,
 * because the component deliberately computes none of it.
 *
 * No jest-dom in this repo; plain DOM assertions throughout.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SubmissionListAssignment } from './submission-list-assignment.component'

const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({
    data: { email: 'owner@lumen.co', getIdToken: async () => 'token' },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const SUBMISSION = { $id: 'sub1' }

/** What the route would answer for this person. */
let options: Record<string, unknown>
/** Every request the component made, in order. */
let posted: Array<{ url: string; body: Record<string, unknown> }>

const OPTIONS_UNRECORDED = {
  to: 'priya@lumen.co',
  lists: [{ id: 'list-1', name: 'Newsletter' }],
  enrollable: true,
  requiresAttestation: true,
  summary:
    'There is no marketing opt-in on record for this person. Sending this ' +
    'form does not create one.',
}

beforeEach(() => {
  enqueueSnackbar.mockReset()
  posted = []
  options = { ...OPTIONS_UNRECORDED }
  global.fetch = jest.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    posted.push({ url, body })
    return {
      ok: true,
      json: async () =>
        String(url).endsWith('list-options')
          ? options
          : { enrolled: true, listName: 'Newsletter', basis: 'operator-attested' },
    }
  }) as never
})

const open = () => {
  const view = render(
    <SubmissionListAssignment hostId="site-1" submission={SUBMISSION} />,
  )
  fireEvent.click(view.getByText('Add to a list'))
  return view
}

/**
 * The sentence that keeps the two acts apart in the merchant's head as well as
 * in the data. It is said before anything is loaded, because a merchant who
 * thinks answering somebody enrolls them will avoid answering people.
 */
it('says a reply never adds anyone, before anything is read', () => {
  const view = render(
    <SubmissionListAssignment hostId="site-1" submission={SUBMISSION} />,
  )
  expect(view.container.textContent).toContain('replying to them never adds them')
  expect(view.container.textContent).toContain('sends them nothing now')
})

/**
 * READ ON ASK, NOT ON MOUNT. Every submission a merchant opens mounts this
 * card; three reads and a bounded query per opened message, for a feature most
 * of them will not use, is the read-on-mount shape this codebase refuses.
 */
it('reads nothing until the merchant asks', async () => {
  const view = render(
    <SubmissionListAssignment hostId="site-1" submission={SUBMISSION} />,
  )
  expect(global.fetch).not.toHaveBeenCalled()
  fireEvent.click(view.getByText('Add to a list'))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0].url).toContain('list-options')
})

describe('a person with no consent record', () => {
  it('states that the submission was not an opt-in', async () => {
    const view = open()
    await waitFor(() =>
      expect(view.container.textContent).toContain(
        'no marketing opt-in on record',
      ),
    )
    expect(view.container.textContent).toContain('does not create one')
  })

  it('offers the assertion, naming the person and the record kept', async () => {
    const view = open()
    await waitFor(() =>
      expect(view.container.textContent).toContain(
        "I have priya@lumen.co's permission",
      ),
    )
    expect(view.container.textContent).toContain('recorded against my account')
  })

  /*
   * The button cannot be pressed on the strength of picking a list alone.
   * Without this the assertion is decoration: the merchant would enroll
   * somebody and the checkbox would be a thing they scrolled past.
   */
  it('will not add anyone until the assertion is actually made', async () => {
    const view = open()
    await waitFor(() => view.getByText('Add to list'))
    const button = view.getByText('Add to list').closest('button')

    // A LIST IS CHOSEN AND NOTHING IS ASSERTED. This is the state the
    // assertion has to hold shut: everything else about the form is complete,
    // so a button enabled here would enroll somebody on no basis at all and
    // the checkbox would be decoration.
    fireEvent.mouseDown(view.getByRole('combobox'))
    fireEvent.click(view.getByRole('option', { name: 'Newsletter' }))
    await waitFor(() => expect(view.getByRole('checkbox')).toBeTruthy())
    expect(button?.disabled).toBe(true)

    fireEvent.click(view.getByRole('checkbox'))
    await waitFor(() => expect(button?.disabled).toBe(false))
  })

  it('sends the assertion with the request when it is made', async () => {
    const view = open()
    await waitFor(() => view.getByText('Add to list'))
    fireEvent.click(view.getByRole('checkbox'))
    fireEvent.mouseDown(view.getByRole('combobox'))
    fireEvent.click(view.getByRole('option', { name: 'Newsletter' }))
    fireEvent.click(view.getByText('Add to list'))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].url).toContain('assign-list')
    expect(posted[1].body.attestConsent).toBe(true)
    expect(posted[1].body.listId).toBe('list-1')
  })
})

describe('a person who already opted in', () => {
  it('says so and asks for no assertion', async () => {
    options = {
      ...OPTIONS_UNRECORDED,
      requiresAttestation: false,
      summary: 'This person opted in to marketing email on 3/14/2025.',
    }
    const view = open()
    await waitFor(() => expect(view.container.textContent).toContain('opted in'))
    expect(view.queryByRole('checkbox')).toBeNull()
  })
})

describe('a person who declined', () => {
  /*
   * No control of any kind. Offering a disabled picker, or the assertion
   * checkbox, would present a door that is not there — and this is exactly
   * the state where a merchant is most likely to look for one.
   */
  it('offers nothing to press, not even the assertion', async () => {
    options = {
      to: 'priya@lumen.co',
      lists: [{ id: 'list-1', name: 'Newsletter' }],
      enrollable: false,
      requiresAttestation: false,
      summary:
        'This person declined marketing email. They cannot be added to a ' +
        'list, and there is no way to override that.',
    }
    const view = open()
    await waitFor(() =>
      expect(view.container.textContent).toContain('declined marketing email'),
    )
    expect(view.queryByRole('checkbox')).toBeNull()
    expect(view.queryByText('Add to list')).toBeNull()
    expect(view.queryByRole('combobox')).toBeNull()
  })
})

describe('an organization with no lists', () => {
  it('says so instead of showing an empty picker', async () => {
    options = { ...OPTIONS_UNRECORDED, lists: [] }
    const view = open()
    await waitFor(() =>
      expect(view.container.textContent).toContain('no marketing lists yet'),
    )
    expect(view.queryByRole('combobox')).toBeNull()
  })
})
