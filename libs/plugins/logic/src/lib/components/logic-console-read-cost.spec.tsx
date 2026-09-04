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
 * What the LOGIC cards read, and what they admit to having missed (AGL-2501).
 *
 * Two shapes, measured rather than described, because neither is visible in
 * rendered output:
 *
 *  1. A PICKER IS NOT A LIST. The variables card's workflow select is filled
 *     from a collection nothing on the page renders, so an unconditional
 *     listener charged every visitor for a hundred documents to populate a
 *     control most of them never open. The read moved behind the click; a spec
 *     that asserted on the select's options would pass either way.
 *  2. A BOUNDED AUDIT HAS TO SAY IT IS BOUNDED. The reference-health card
 *     draws its whole verdict from thirteen windows, so a ceiling that bit
 *     anywhere turns "every reference resolves" into a claim about a sample.
 *     Both readings are text on screen — but only because the probe row makes
 *     the truncation a fact, which is what these assertions pin.
 *
 * So the meter sits at the Firestore boundary and records every listen as its
 * path plus the `limit()` the query carries, because that limit IS the
 * billable ceiling — a card listening with `limit(300)` to fill a select is
 * buying three hundred documents whether or not anybody looks at them.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.setTimeout(30_000)

/** The ceiling both cards ask through. */
const CEILING = 100

/**
 * Every listen, as `path#limit`, plus the constraints it carried.
 *
 * Module-scoped and `mock`-prefixed so the `jest.mock` factories may close
 * over them — jest's out-of-scope-variable guard admits that one prefix.
 */
const mockListens: Array<{
  path: string
  limit: number
  constraints: Array<Record<string, any>>
}> = []

/** How many documents each collection holds. The ceiling cases move it. */
const mockServed = { value: CEILING }

const FIRESTORE = {}

const rowsFor = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    $id: `${prefix}-${String(index).padStart(3, '0')}`,
    name: `${prefix}_${String(index).padStart(3, '0')}`,
    type: 'text',
    value: 'x',
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
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  where: (field: string) => ({ where: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostActivityLogger: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: jest.fn() } }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (!built) return { data: [], status: 'success', fromCache: false }
    const name = String(built.path ?? '').split('/').pop() ?? ''
    const constraints: Array<Record<string, any>> = built.constraints ?? []
    const cap = constraints.find((item) => 'limit' in item)?.limit
    mockListens.push({
      path: String(built.path ?? ''),
      limit: typeof cap === 'number' ? cap : 0,
      constraints,
    })
    // The fixture answers with the CAP applied, so a listener that asked for
    // ceiling + 1 and got ceiling + 1 is what makes `truncated` true.
    const all = rowsFor(name, mockServed.value)
    return {
      data: typeof cap === 'number' ? all.slice(0, cap) : all,
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

import HostReferenceHealthCard from './host-reference-health-card.component'
import HostVariablesCard from './host-variables-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  mockListens.length = 0
  mockServed.value = CEILING
})

/** The meter, deduplicated: a re-render re-issues the same query identity. */
const meter = () => [
  ...new Set(mockListens.map((listen) => `${listen.path}#${listen.limit}`)),
]

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a picker is not a list (AGL-2501)', () => {
  it('the closed variables card buys ONE window, not two', async () => {
    render(<HostVariablesCard hostId="h1" org={ORG} />)
    await settle()
    // The whole set, and the ceiling with it. `toContain` would be satisfied
    // by the variables read alone and would go on passing with the workflow
    // picker back on the mount path; naming the ceiling catches the other
    // regression, a window widened without anybody noticing.
    expect(meter().sort()).toEqual(['hosts/h1/variables#101'])
  })

  it('the click that opens the editor is what buys the workflow picker', async () => {
    render(<HostVariablesCard hostId="h1" org={ORG} />)
    await settle()
    const before = meter()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    })
    // The other half of the contract. A card that had simply DELETED the read
    // would pass the assertion above and offer an empty select — so this says
    // the read moved rather than went away, and arrives at the same ceiling.
    expect(meter().filter((listen) => !before.includes(listen))).toEqual([
      'hosts/h1/workflows#101',
    ])
  })
})

describe('a bounded audit says it is bounded (AGL-2501)', () => {
  /** The thirteen collections the audit judges against. */
  const AUDITED = [
    'hosts/h1/actions',
    'hosts/h1/campaigns',
    'hosts/h1/collections',
    'hosts/h1/functions',
    'hosts/h1/overlays',
    'hosts/h1/productCategories',
    'hosts/h1/products',
    'hosts/h1/screens',
    'hosts/h1/variables',
    'hosts/h1/webhooks',
    'hosts/h1/workflows',
    'orgs/org-1/datasets',
    'orgs/org-1/lists',
  ]

  it('reads every collection ONCE, at the ceiling plus a probe', async () => {
    render(<HostReferenceHealthCard hostId="h1" />)
    await settle()
    // Named individually rather than counted. Thirteen listens at some
    // ceiling is a number a regression can keep while reading the wrong
    // collections, and a total that "looks about right" is exactly how a
    // window doubled on one of them goes unnoticed.
    expect(meter().sort()).toEqual(
      AUDITED.map((path) => `${path}#${CEILING + 1}`).sort(),
    )
  })

  it('names an order on every one of them, and it is the document name', async () => {
    render(<HostReferenceHealthCard hostId="h1" />)
    await settle()
    // The defect this sweep exists for is a cap with no ordering, which reads
    // an arbitrary sample. It is also the half that no rendered assertion can
    // see — the card looks identical either way.
    for (const listen of mockListens) {
      const order = listen.constraints.find((item) => 'orderBy' in item)
      expect(order).toBeTruthy()
      // `documentId()` and not a field: `orderBy` matches only documents that
      // HAVE the field, so ordering on `name` would DROP every row written
      // without one rather than mis-sorting the audit.
      expect(order?.['orderBy']).toBe('__name__')
    }
  })

  it('claims completeness only when the ceiling did not bite', async () => {
    mockServed.value = CEILING
    render(<HostReferenceHealthCard hostId="h1" />)
    await settle()
    expect(
      screen.getByText(
        'Every automation, workflow, and variable reference resolves.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/Audited against the first/)).toBeNull()
  })

  it('discloses the cut, and stops claiming every reference resolves', async () => {
    // One document past the ceiling — the probe row's whole purpose. At
    // exactly the ceiling the two states are indistinguishable from the rows
    // alone, which is why `length === ceiling` cannot answer this.
    mockServed.value = CEILING + 1
    render(<HostReferenceHealthCard hostId="h1" />)
    await settle()
    expect(screen.getByText(/Audited against the first 100 rows/)).toBeTruthy()
    // The success line is REPHRASED, not merely accompanied. A notice beside
    // an unchanged "every reference resolves" leaves the false claim on
    // screen for a reader who reads one of the two.
    expect(
      screen.queryByText(
        'Every automation, workflow, and variable reference resolves.',
      ),
    ).toBeNull()
    expect(
      screen.getByText('Every reference the audit read resolves.'),
    ).toBeTruthy()
  })
})
