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
 * WHO THIS SITE SENDS AS.
 *
 * The load-bearing assertion is the one that says a merchant cannot type an
 * address on a domain nobody has verified. DMARC on the sending apex is
 * published `adkim=s`, so a `From:` on somebody else's mail provider cannot
 * align and would be refused by the receiving side rather than delivered —
 * which means the surface has to route that intention to the reply address
 * instead of accepting it into the sender.
 *
 * The rest protects the same rule from the other end: a site on the pooled
 * Aglyn address has no mailbox to choose, and must still be able to set the
 * two fields it does have.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SendingSenderDrawer } from './sending-sender-drawer'

/** Every body this render POSTed, in order. */
const posted: Record<string, unknown>[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: members, status: 'success' }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
  query: () => ({}),
}))

/** The site's people, as the picker reads them. */
let members: Record<string, unknown>[] = []

const identity = (over: Record<string, unknown> = {}) =>
  ({
    orgId: 'org-1',
    selected: 'acme.com',
    localPart: 'hello',
    localPartInUse: true,
    fromName: null,
    replyTo: null,
    identity: 'Sending as hello@acme.com on your verified domain acme.com.',
    identitySource: 'custom',
    refusal: null,
    options: [],
    domains: [],
    canManage: true,
    entitled: true,
    ...over,
  }) as never

const mount = async (view: unknown) => {
  await act(async () => {
    render(
      <SendingSenderDrawer
        open
        hostId="host-1"
        view={view as never}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    )
  })
}

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Save sender'))
  })
}

const field = (label: string) =>
  screen.getByLabelText(label, { exact: false }) as HTMLInputElement

beforeEach(() => {
  posted.length = 0
  members = []
  ;(global as any).fetch = jest.fn(async (_url: string, init: any) => {
    posted.push(JSON.parse(String(init?.body ?? '{}')))
    return { ok: true, status: 200, json: async () => ({}) }
  })
})

describe('the domain is not a field', () => {
  it('shows the verified domain beside the mailbox rather than as an input', async () => {
    await mount(identity())

    expect(screen.getByText('@acme.com')).toBeTruthy()
    // The address is one decision split across two controls only in
    // appearance: nothing here can move the domain half.
    expect(screen.queryByLabelText('Domain', { exact: false })).toBeNull()
  })

  it('sends a merchant who wants a personal address to the reply field', async () => {
    await mount(identity())

    await act(async () => {
      fireEvent.change(field('Mailbox'), {
        target: { value: 'jamie@gmail.com' },
      })
    })
    await save()

    expect(posted).toHaveLength(0)
    expect(screen.getByText(/only the part before the @/)).toBeTruthy()
  })

  it('refuses a mailbox that would carry a second header', async () => {
    await mount(identity())

    await act(async () => {
      fireEvent.change(field('Mailbox'), {
        target: { value: `sales${String.fromCharCode(10)}Bcc: x@evil.test` },
      })
    })
    await save()

    expect(posted).toHaveLength(0)
  })
})

describe('what the drawer sends', () => {
  it('never names a domain, so saving a sender cannot move the selection', async () => {
    await mount(identity())

    await act(async () => {
      fireEvent.change(field('Mailbox'), { target: { value: 'jamie' } })
      fireEvent.change(field('Sender name'), { target: { value: 'Jamie' } })
      fireEvent.change(field('Reply address'), {
        target: { value: 'jamie@acme-corp.com' },
      })
    })
    await save()

    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({
      hostId: 'host-1',
      localPart: 'jamie',
      fromName: 'Jamie',
      replyTo: 'jamie@acme-corp.com',
    })
    expect(posted[0]).not.toHaveProperty('domain')
  })
})

describe('a site on the pooled address', () => {
  const pooled = identity({
    selected: '',
    localPartInUse: false,
    identitySource: 'shared',
  })

  it('says the mailbox is not its to choose, and disables it', async () => {
    await mount(pooled)

    expect(screen.getByText(/shared Aglyn address/)).toBeTruthy()
    expect(field('Mailbox').disabled).toBe(true)
  })

  it('still saves the name and reply address, without the mailbox', async () => {
    await mount(pooled)

    await act(async () => {
      fireEvent.change(field('Sender name'), { target: { value: 'Jamie' } })
    })
    await save()

    expect(posted).toHaveLength(1)
    // Not sent at all, rather than sent and refused: a merchant editing the
    // one field they do have must not have the whole save rejected over a
    // field they were never offered.
    expect(posted[0]).not.toHaveProperty('localPart')
    expect(posted[0]).toMatchObject({ fromName: 'Jamie' })
  })
})

describe('sending as a person', () => {
  beforeEach(() => {
    members = [
      { $id: 'm1', email: 'jamie@acme.com', displayName: 'Jamie Lee' },
    ]
  })

  /**
   * The person's own address becomes the REPLY target, never the sender.
   *
   * Their mailbox lives on whatever provider their company uses, and a
   * `From:` there could not align under the strict DMARC policy the sending
   * apex publishes. What carries their identity is the name, the mailbox
   * derived from it on a domain this site has proved, and replies that reach
   * them where they actually read mail.
   */
  it('takes the name and the reply address from a member, and derives the mailbox', async () => {
    await mount(identity())

    /*
     * A MUI select is a button and a listbox, not an `<input>` — `change` on
     * it finds no value setter. Opened with `mouseDown` and chosen BY THE TEXT
     * a person would read, which is also the assertion that the option is
     * labelled with something recognisable rather than a document id.
     */
    await act(async () => {
      fireEvent.mouseDown(screen.getByLabelText('Send as a person'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Jamie Lee — jamie@acme.com'))
    })
    await save()

    expect(posted[0]).toMatchObject({
      localPart: 'jamie',
      fromName: 'Jamie Lee',
      replyTo: 'jamie@acme.com',
    })
  })
})
