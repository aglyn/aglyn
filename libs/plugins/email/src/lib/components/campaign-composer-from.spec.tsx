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
 * WHAT ADDRESS THIS EMAIL LEAVES ON, said on the page where it is written.
 *
 * The defect this file is named for: senders are defined on Emails → Sending,
 * and the composer carried a From NAME and a Reply-to and never once named the
 * from ADDRESS. Two screens appeared to define overlapping things, and the one
 * where a merchant writes the email omitted the single fact those two fields
 * are attached to — so editing the name here read as editing the site.
 *
 * Three properties, and each has a control:
 *
 *  1. The address is named, INCLUDING on a site with one sender, where there
 *     is no picker to infer it from.
 *  2. Choosing a sender changes the address that is named — asserted with the
 *     default's address absent, so a picker whose choice went nowhere fails
 *     rather than passing on a line that happened to be right.
 *  3. The two per-send fields say what they are overriding, so a value seeded
 *     from the sender does not read as a second definition of it.
 *
 * And the answer to "let me type a one-off address": `Add a sender…` opens the
 * editor. A composer that accepted a free address would mint a mailbox that
 * exists in one campaign's headers and nowhere else — which is the closure the
 * whole sending design rests on, and it does not weaken because somebody
 * typed the address deliberately.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Every request body this render posted to the send route, in order. */
let posted: Array<Record<string, any>> = []
/** What the sending-identity route answers. */
let identityAnswer: Record<string, any> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({
    data: { uid: 'uid-test', getIdToken: async () => 'token' },
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useHostOrgId: () => 'org-1',
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostVersionApi: () => jest.fn().mockResolvedValue({ id: 'v1' }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  useFirestoreCollection: () => ({
    data: [],
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/*
 * The drawer's three primitives as well as the confirm hook, because this file
 * OPENS the sender editor — the composer's answer to a one-off address — and a
 * mock carrying only what the composer itself imports would render `undefined`
 * the moment the picker's last entry is chosen.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: () => Promise.resolve(undefined) }),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  /*
   * `appBarLeft` is rendered as well as the children, because it carries the
   * drawer's TITLE — which is the part that says whether the editor opened to
   * add a sender or to rename the one this site already has, and getting that
   * wrong is how a one-off becomes a rename.
   */
  NavigationDrawerComponent: ({
    open,
    appBarLeft,
    children,
  }: {
    open: boolean
    appBarLeft?: ReactNode
    children: ReactNode
  }) =>
    open ? (
      <div>
        {appBarLeft}
        {children}
      </div>
    ) : null,
}))

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [{ id: 'marketing', name: 'Promotions and offers' }],
  }),
}))

import CampaignComposer from './campaign-composer'

const ACME = 'acme.com'

/** One sender row, as the identity route reports it. */
const sender = (over: Record<string, unknown> = {}) => ({
  id: 'default',
  localPart: 'hello',
  fromName: null,
  replyTo: null,
  isDefault: true,
  from: `hello@${ACME}`,
  ...over,
})

const identity = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  selected: ACME,
  platformDomain: '',
  customDomainPlan: 'Pro',
  dedicatedDomainPlan: 'Pro',
  localPart: 'hello',
  localPartInUse: true,
  fromName: null,
  replyTo: null,
  identity: `Sending as hello@${ACME} on your verified domain ${ACME}.`,
  identitySource: 'custom',
  refusal: null,
  options: [],
  senders: [sender()],
  domains: [],
  canManage: true,
  entitled: true,
  ...over,
})

/** The default sender's address — the CONTROL for an ignored choice. */
const SENDS_AS_DEFAULT = `hello@${ACME}`
const SENDS_AS_JAMIE = `jamie@${ACME}`

beforeEach(() => {
  posted = []
  identityAnswer = identity()
  ;(global as any).fetch = jest.fn(async (url: string, init: any) => {
    /*
     * URL-aware, because two different routes are reached from this surface
     * and only one of them carries a body. The identity read is a GET with
     * none at all, which is what makes a double keyed on `init.body` answer it
     * by throwing.
     */
    if (String(url).includes('sending-identity')) {
      return {
        ok: true,
        status: 200,
        json: async () => identityAnswer,
      } as any
    }
    const body = JSON.parse(String(init?.body ?? '{}'))
    posted.push(body)
    if (body.action === 'preview') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sendable: 3,
          suppressed: 0,
          audienceSize: 3,
          consented: 3,
          grandfathered: 0,
          consentWithheld: 0,
        }),
      } as any
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sent: 3, recipients: 3, campaignId: 'c1' }),
    } as any
  })
})

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const mount = async (props: Record<string, any> = {}) => {
  render(<CampaignComposer hostId="host-1" {...props} />)
  await settle(500)
}

/**
 * Open a MUI select.
 *
 * It is a button and a listbox rather than an `<input>`, so `change` finds no
 * value setter — and every choice below is then made BY THE TEXT a person
 * would read, which doubles as the assertion that the options are labelled
 * with something recognisable rather than with ids.
 */
const openSelect = async (label: string) => {
  await act(async () => {
    // EXACT, because `From` is a prefix of `From name` — a loose match finds
    // both and the picker under test is the one that is only a picker.
    fireEvent.mouseDown(screen.getByLabelText(label, { exact: true }))
  })
}

const choose = async (text: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(text))
  })
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  })
}

describe('the composer names the address the email leaves on', () => {
  it('says so on a site with ONE sender, where there is no picker to read it from', async () => {
    await mount()

    // The whole defect in one assertion: this page carried a From name and a
    // Reply-to and never the address they sit in front of.
    await waitFor(() =>
      expect(
        screen.getByText(/This email goes out as/),
      ).toBeTruthy(),
    )
    expect(screen.getByText(SENDS_AS_DEFAULT)).toBeTruthy()
    // And offers no choice, because there is none to make.
    expect(screen.queryByLabelText('From', { exact: true })).toBeNull()
  })

  it('folds the per-send name into the address it will actually produce', async () => {
    identityAnswer = identity({
      senders: [sender({ fromName: 'Acme' })],
      fromName: 'Acme',
    })
    await mount()

    await waitFor(() =>
      expect(screen.getByText(`Acme <${SENDS_AS_DEFAULT}>`)).toBeTruthy(),
    )

    // Live, so editing the name shows the From line it produces rather than
    // the one the site stores.
    await act(async () => {
      type('From name', 'Jamie at Acme')
    })
    expect(screen.getByText(`Jamie at Acme <${SENDS_AS_DEFAULT}>`)).toBeTruthy()
  })

  it('names nothing when the mailbox is not the one in use', async () => {
    /*
     * A site on the pooled address has a stored mailbox that no recipient will
     * see, so the route reports the row with no `from`. Promising an address
     * here would be this surface inventing one; the identity summary the
     * composer already renders is what says what is really happening.
     */
    identityAnswer = identity({
      selected: '',
      localPartInUse: false,
      identitySource: 'shared',
      senders: [sender({ from: null })],
    })
    await mount()

    expect(screen.queryByText(/This email goes out as/)).toBeNull()
  })
})

describe('choosing among several senders', () => {
  const two = () =>
    identity({
      senders: [
        sender({ fromName: 'Acme' }),
        {
          id: 'sender-jamie',
          localPart: 'jamie',
          fromName: 'Jamie Lee',
          replyTo: 'jamie@acme-corp.com',
          isDefault: false,
          from: SENDS_AS_JAMIE,
        },
      ],
    })

  it('leads each option with the ADDRESS, not with the person', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')

    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent)
    // The address first on every row: this control answers "what does this
    // leave as", and a row led by a display name makes the reader open the
    // menu to find the one fact they came for.
    expect(options[0]).toMatch(new RegExp(`^${SENDS_AS_DEFAULT}`))
    expect(options[1]).toMatch(new RegExp(`^${SENDS_AS_JAMIE}`))
    // The default is marked as the default, so an email that names nothing is
    // legible as inheriting rather than as unset.
    expect(options[0]).toContain('this site’s default')
  })

  it('names the chosen address, and stops naming the default', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')
    await choose(SENDS_AS_JAMIE)

    await waitFor(() => expect(screen.getAllByText(/jamie@acme\.com/).length))
    // THE CONTROL. A picker whose choice reached nothing would leave the line
    // reading `hello@acme.com`, and every other assertion here would still
    // pass.
    expect(screen.queryByText(`Acme <${SENDS_AS_DEFAULT}>`)).toBeNull()
    expect(
      screen.getByText(`Jamie Lee <${SENDS_AS_JAMIE}>`),
    ).toBeTruthy()
  })

  it('sends the chosen sender by id, and the count asks under it too', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')
    await choose(SENDS_AS_JAMIE)
    await settle(500)

    const previews = posted.filter((body) => body.action === 'preview')
    // The refusal for a sender this site no longer holds arrives at the
    // picker rather than from the Send button, which is only true if the
    // count carries the choice.
    expect(previews[previews.length - 1].senderId).toBe('sender-jamie')
    // An id, never an address. The set of addresses a request can reach is
    // the set an organization admin already approved.
    expect(previews[previews.length - 1]).not.toHaveProperty('from')
  })

  it('brings the chosen sender’s name and reply address with it', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')
    await choose(SENDS_AS_JAMIE)

    expect(
      (screen.getByLabelText('From name', { exact: false }) as HTMLInputElement)
        .value,
    ).toBe('Jamie Lee')
    expect(
      (screen.getByLabelText('Reply-to', { exact: false }) as HTMLInputElement)
        .value,
    ).toBe('jamie@acme-corp.com')
  })
})

describe('the two per-send fields say what they override', () => {
  it('names the sender’s saved value as the thing being inherited', async () => {
    identityAnswer = identity({
      senders: [sender({ fromName: 'Acme' })],
      fromName: 'Acme',
    })
    await mount()

    await waitFor(() =>
      expect(screen.getByText(/sender’s saved name/)).toBeTruthy(),
    )
    // Seeded and untouched reads as inheriting, not as a second definition of
    // a setting that lives on another screen.
    expect(screen.getByText(/changes this email only/)).toBeTruthy()
  })

  it('says it is OVERRIDING once the value differs', async () => {
    identityAnswer = identity({
      senders: [sender({ fromName: 'Acme' })],
      fromName: 'Acme',
    })
    await mount()

    await act(async () => {
      type('From name', 'Jamie at Acme')
    })

    expect(screen.getByText(/Overrides the sender’s saved name, Acme/)).toBeTruthy()
  })

  it('says what fills the name when a sender has none', async () => {
    await mount()

    // The send resolves `options.fromName || branding.fromName`, so an empty
    // field is not "no name" — saying so is what stops a merchant filling it
    // to avoid an outcome that was never going to happen.
    await waitFor(() =>
      expect(screen.getByText(/Your brand name is used when this is empty/)).toBeTruthy(),
    )
  })
})

describe('a one-off sender', () => {
  const two = () =>
    identity({
      senders: [
        sender(),
        {
          id: 'sender-jamie',
          localPart: 'jamie',
          fromName: 'Jamie Lee',
          replyTo: null,
          isDefault: false,
          from: SENDS_AS_JAMIE,
        },
      ],
    })

  it('opens the sender editor rather than accepting a typed address', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')
    await choose('Add a sender…')

    // The drawer, not a free-text field. An address that exists in one
    // campaign's headers and nowhere else is a mailbox nobody serves; one
    // added here is validated, served and reusable.
    await waitFor(() => expect(screen.getByText('Add a sender')).toBeTruthy())
    expect(screen.getByLabelText('Mailbox', { exact: false })).toBeTruthy()
  })

  it('never sends the menu entry as a sender id', async () => {
    identityAnswer = two()
    await mount()
    await openSelect('From')
    await choose('Add a sender…')
    await settle(500)

    // THE CONTROL for the sentinel. A picker that treated its own menu entry
    // as a selection would post `senderId: 'add-a-sender'`, which the send
    // path refuses — a 404 in place of a drawer.
    for (const body of posted) {
      expect(body.senderId).not.toBe('add-a-sender')
    }
  })

  it('is not offered to somebody who may not write one', async () => {
    // Naming the addresses a site's mail leaves on is an organization-admin
    // decision. Offering the entry to an editor would open a drawer whose
    // Save is refused, which is worse than not offering it.
    identityAnswer = { ...two(), canManage: false }
    await mount()
    await openSelect('From')

    expect(screen.queryByText('Add a sender…')).toBeNull()
  })
})
