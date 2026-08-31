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
 *
 * ## The picker's roster is answered by a FAKE FIRESTORE, not by a fixture
 *
 * The tests below hand the component a workspace and let it query. A mock that
 * answered every read with one array would pass whatever the component asked
 * for, which is precisely the defect being fixed: the picker read one
 * collection, got the one document in it, and looked like it was working.
 *
 * So `where`, `limit` and `orderBy` are evaluated here the way Firestore
 * evaluates them — including the part that matters most, that an `orderBy`
 * matches only documents which HAVE the field and drops the rest.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SendingSenderDrawer } from './sending-sender-drawer'

/** Every body this render POSTed, in order. */
const posted: Record<string, unknown>[] = []

/*==========================================
  A fake Firestore, one collection deep
==========================================*/

/** One clause of a built query, as the mocked builders record them. */
interface Clause {
  kind: 'where' | 'limit' | 'orderBy'
  field?: string
  op?: string
  value?: any
}

/** A built query: which collection, and what was asked of it. */
interface BuiltQuery {
  path: string
  clauses: Clause[]
}

/** The workspace under test, keyed by collection path. */
let store: Record<string, Record<string, any>[]> = {}
/** Every query the component built this render, for the shape assertions. */
let built: BuiltQuery[] = []

/** A field path, resolved through dots so `hostAccess.host-1` works. */
const readPath = (data: any, field: string) =>
  field.split('.').reduce((value, key) => value?.[key], data)

const evaluate = (spec: BuiltQuery): Record<string, any>[] => {
  let rows = store[spec.path] ?? []
  for (const clause of spec.clauses) {
    if (clause.kind === 'where') {
      rows = rows.filter((row) => {
        const value = readPath(row, clause.field as string)
        return clause.op === 'in'
          ? (clause.value as any[]).includes(value)
          : value === clause.value
      })
    }
    /*
     * The trap, reproduced rather than described: Firestore's `orderBy`
     * matches only documents that HAVE the field. A test double that sorted
     * and kept everything would let an `orderBy` on an optional field pass
     * here and hide people in production.
     */
    if (clause.kind === 'orderBy') {
      const field = clause.field as string
      rows = rows
        .filter((row) => readPath(row, field) !== undefined)
        .slice()
        .sort((left, right) =>
          String(readPath(left, field)).localeCompare(
            String(readPath(right, field)),
          ),
        )
    }
    if (clause.kind === 'limit') rows = rows.slice(0, clause.value)
  }
  return rows
}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    clauses: [] as Clause[],
  }),
  query: (base: any, ...clauses: Clause[]) => ({
    ...base,
    clauses: [...(base?.clauses ?? []), ...clauses],
  }),
  where: (field: string, op: string, value: unknown): Clause => ({
    kind: 'where',
    field,
    op,
    value,
  }),
  orderBy: (field: string): Clause => ({ kind: 'orderBy', field }),
  limit: (value: number): Clause => ({ kind: 'limit', value }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useFirestoreCollection: (
    build: () => BuiltQuery | null,
    _deps: unknown,
    options: { idField?: string },
  ) => {
    const spec = build()
    if (!spec) return { data: [], status: 'success' }
    built.push(spec)
    const idField = options?.idField ?? '$id'
    return {
      data: evaluate(spec).map((row) => ({ ...row, [idField]: row.id })),
      status: 'success',
    }
  },
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

const HOST = 'host-1'
const ORG = 'org-1'

const identity = (over: Record<string, unknown> = {}) =>
  ({
    orgId: ORG,
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
        hostId={HOST}
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

/**
 * Open the picker.
 *
 * A MUI select is a button and a listbox, not an `<input>` — `change` on it
 * finds no value setter. Opened with `mouseDown`, and every choice below is
 * then made BY THE TEXT a person would read, which is also the assertion that
 * the options are labelled with something recognisable rather than ids.
 */
const openPicker = async () => {
  await act(async () => {
    fireEvent.mouseDown(screen.getByLabelText('Send as a person'))
  })
}

const choose = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(label))
  })
}

beforeEach(() => {
  posted.length = 0
  store = {}
  built = []
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

  it('refuses a reserved role mailbox rather than storing it', async () => {
    await mount(identity())

    await act(async () => {
      fireEvent.change(field('Mailbox'), { target: { value: 'postmaster' } })
    })
    await save()

    expect(posted).toHaveLength(0)
    expect(screen.getByText(/is reserved/)).toBeTruthy()
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
      hostId: HOST,
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

/*==========================================
  Who the picker offers
==========================================*/

/**
 * A workspace with one of each population, and two people who must not be on
 * the list.
 *
 * `dana` is the case that produced the bug report: a real teammate with an
 * org role and no site-collaborator document anywhere. A site whose team is
 * managed entirely at the org level has an EMPTY `hosts/{hostId}/members`
 * except for whoever was once added by address, which is why the picker
 * offered exactly one personal mailbox and no colleagues.
 */
const workspace = () => {
  store[`orgs/${ORG}/members`] = [
    // Org admin. Reaches every site by role, and is on no site roster.
    {
      id: 'u-dana',
      role: 'admin',
      email: 'dana@acme.com',
      displayName: 'Dana Reyes',
    },
    // Org-wide editor. Reaches every site through the flag.
    {
      id: 'u-kim',
      role: 'editor',
      allHosts: true,
      email: 'kim@acme.com',
      displayName: 'Kim Ortiz',
    },
    // Scoped to THIS site, and also on its collaborator roster.
    {
      id: 'u-jamie',
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      email: 'jamie@acme.com',
      displayName: 'Jamie Lee',
    },
    /*
     * CONTROL — scoped to a DIFFERENT site.
     *
     * Reachable by every read that does not narrow, and refused by
     * `hostRoleFor`. Signing this site's mail is not something they could
     * follow up on: they cannot open the site.
     */
    {
      id: 'u-elsewhere',
      role: 'viewer',
      allHosts: false,
      hostAccess: { 'host-2': 'admin' },
      email: 'other-site@acme.com',
      displayName: 'Ari Cole',
    },
    /*
     * CONTROL — carries the org-wide FLAG and no org role.
     *
     * The `allHosts` read returns this document, so the query alone does not
     * exclude it; `hostRoleFor` does, because a member with no role is a
     * member of nothing. It is the case that fails if the predicate stops
     * being applied to what the queries return.
     */
    {
      id: 'u-flagged',
      allHosts: true,
      email: 'flag-no-role@acme.com',
      displayName: 'Rae Idris',
    },
  ]
  store[`hosts/${HOST}/members`] = [
    // The same person as `u-jamie`, keyed by their uid.
    { id: 'u-jamie', uid: 'u-jamie', email: 'jamie@acme.com', role: 'editor' },
    /*
     * Invited by address, with no account behind it yet — so a generated
     * roster id, no `uid`, and no org member document to be found in. The one
     * population the site roster is the only source for.
     */
    { id: 'invite-1', email: 'newbie@acme.com', role: 'viewer', status: 'invited' },
  ]
}

describe('who the picker offers', () => {
  beforeEach(workspace)

  it('offers an org team member who is on no site roster at all', async () => {
    await mount(identity())
    await openPicker()

    expect(screen.getByText('Dana Reyes')).toBeTruthy()
    expect(screen.getByText('Kim Ortiz')).toBeTruthy()
  })

  it('still offers a site collaborator, including one who has not signed in', async () => {
    await mount(identity())
    await openPicker()

    expect(screen.getByText('Jamie Lee')).toBeTruthy()
    // No name is recorded for an invited address, so the address is the row.
    expect(screen.getByText('newbie@acme.com')).toBeTruthy()
  })

  it('offers somebody on both rosters once, under the name only one of them holds', async () => {
    await mount(identity())
    await openPicker()

    // `hosts/{hostId}/members` carries no display name — its only writer sets
    // an explicit field list without one — so a collaborator's name can only
    // come from their org member document. Merging by uid is what puts the
    // two halves of one person on one row.
    expect(screen.getAllByText('jamie@acme.com')).toHaveLength(1)
    expect(screen.getAllByText('Jamie Lee')).toHaveLength(1)
  })

  it('leaves out a member scoped to other sites, and one flagged with no role', async () => {
    await mount(identity())
    await openPicker()

    expect(screen.queryByText('Ari Cole')).toBeNull()
    expect(screen.queryByText('other-site@acme.com')).toBeNull()
    expect(screen.queryByText('Rae Idris')).toBeNull()
    expect(screen.queryByText('flag-no-role@acme.com')).toBeNull()
  })

  it('reads the org roster only through the three shapes that reach one site', async () => {
    await mount(identity())

    const orgReads = built.filter(
      (spec) => spec.path === `orgs/${ORG}/members`,
    )
    expect(orgReads.length).toBeGreaterThan(0)
    /*
     * The control for a WIDENED roster, asserted on the wire rather than on
     * the screen: `hostRoleFor` would still refuse an outsider, so a query
     * that swept the whole workspace would go unnoticed on the rendered list
     * while reading every member of an agency's org to fill one select.
     */
    for (const read of orgReads) {
      expect(read.clauses.some((clause) => clause.kind === 'where')).toBe(true)
    }
    const fields = orgReads
      .map((read) => read.clauses.find((clause) => clause.kind === 'where'))
      .map((clause) => clause?.field)
    expect(new Set(fields)).toEqual(
      new Set(['role', 'allHosts', `hostAccess.${HOST}`]),
    )
  })

  /**
   * `AglynOrgMember` declares `email` optional and two production paths create
   * a member document without it — `PATCH /api/hosts/members`, which re-grants
   * host access carrying no identity fields, and `POST /api/orgs/members`,
   * which omits it when the auth record has none. An `orderBy('email')` here
   * would drop those documents rather than arrange them, which is the same
   * silence the picker already failed in once.
   */
  it('never orders the org roster on a field a writer may omit', async () => {
    await mount(identity())

    for (const read of built) {
      expect(read.clauses.some((clause) => clause.kind === 'orderBy')).toBe(
        false,
      )
    }
  })

  it('arranges the list by name, so it reads as people rather than addresses', async () => {
    await mount(identity())
    await openPicker()

    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual([
      'Dana Reyesdana@acme.com',
      'Jamie Leejamie@acme.com',
      'Kim Ortizkim@acme.com',
      'newbie@acme.com',
    ])
  })
})

describe('sending as a person', () => {
  beforeEach(workspace)

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
    await openPicker()
    await choose('Jamie Lee')
    await save()

    expect(posted[0]).toMatchObject({
      localPart: 'jamie',
      fromName: 'Jamie Lee',
      replyTo: 'jamie@acme.com',
    })
  })

  it('fills from an org team member who has no site-collaborator record', async () => {
    await mount(identity())
    await openPicker()
    await choose('Dana Reyes')
    await save()

    expect(posted[0]).toMatchObject({
      localPart: 'dana',
      fromName: 'Dana Reyes',
      replyTo: 'dana@acme.com',
    })
  })

  it('keeps the reply address of somebody with no recorded name', async () => {
    await mount(identity())
    await openPicker()
    await choose('newbie@acme.com')
    await save()

    // The name is left as it was rather than overwritten with an address: a
    // sender name that reads as an email address is worse than the brand name
    // already in the field.
    expect(posted[0]).toMatchObject({
      localPart: 'newbie',
      replyTo: 'newbie@acme.com',
    })
  })
})

describe('the roster is read on open, not on mount', () => {
  beforeEach(workspace)

  it('builds no query at all while the drawer is closed', async () => {
    await act(async () => {
      render(
        <SendingSenderDrawer
          open={false}
          hostId={HOST}
          view={identity()}
          onClose={() => undefined}
          onSaved={() => undefined}
        />,
      )
    })

    // Four collection reads on a settings surface are worth paying for when
    // somebody asks to choose a sender, and not worth paying for on every
    // load of the page the card sits on.
    expect(built).toHaveLength(0)
  })
})
