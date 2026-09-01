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
 * THE THREE PROMISES THE FORMS SURFACE MAKES THAT NOTHING ELSE WOULD CATCH.
 *
 *  1. **The empty list still teaches the shape of a form.** A list that
 *     collapses to a sentence when it is empty is at its least informative
 *     exactly when a reader knows least — and this is the one state every new
 *     site is in. The columns are the explanation.
 *  2. **The preview cannot execute anything.** Its every string is written by
 *     a site's own editors or arrives on a marketplace template.
 *  3. **No rate becomes `0%` because nobody measured.** A form's lead counter
 *     is declared and never written, so this is not a hypothetical: the
 *     obvious `?? 0` renders "no submission has ever become a lead" over data
 *     that says nothing of the kind.
 *
 * Each is asserted through the rendered surface rather than the source,
 * because each is a claim about what a reader sees.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'

/** The rows the mocked query hands the card. Reassigned per test. */
let mockRows: any[] = []
let mockStatus: 'loading' | 'success' = 'success'
/** What the server aggregate answers for the quota readout. */
const mockLiveCount: number | null = 0

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [] as unknown[],
  }),
  documentId: () => '__name__',
  orderBy: (field: string) => ({ type: 'orderBy', field }),
  limit: (value: number) => ({ type: 'limit', value }),
  where: () => ({ type: 'where' }),
  query: (source: any, ...constraints: unknown[]) => ({
    ...source,
    constraints: [...source.constraints, ...constraints],
  }),
  doc: () => ({}),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  // The card's head-count. Answering it keeps `useLiveArtifactCount` off the
  // network without stubbing the card's own arithmetic.
  getCountFromServer: jest
    .fn()
    .mockResolvedValue({ data: () => ({ count: 0 }) }),
}))

let mockDb: Record<string, never> | undefined
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => {
    if (!mockDb) mockDb = {}
    return mockDb
  },
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 't' } }),
  // The site's console address, which the row links and the besigner button
  // resolve through. Answered so the table draws links rather than the
  // pre-resolution placeholder.
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/demo',
    orgSlug: 'acme',
    subdomain: 'demo',
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue(undefined),
  useLiveArtifactCount: () => mockLiveCount,
  usePagedCollection: () => ({
    status: mockStatus,
    fromCache: false,
    rows: mockRows,
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  // `HeaderProps.action` is rendered: the quota readout and the create button
  // ride it now that the shell owns the page header, so a mock that dropped it
  // would hide the two controls this surface gained in the move.
  CardDisplay: ({ header, children, HeaderProps }: any) => (
    <div>
      {header ? <h2>{header}</h2> : null}
      {HeaderProps?.action ?? null}
      {children}
    </div>
  ),
  MdiIcon: () => null,
}))

jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  __esModule: true,
  CreateArtifactDrawer: ({ open, title }: any) =>
    open ? <div>{title}</div> : null,
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
}))

/*
 * `require` rather than `import`: the mocks above have to be installed before
 * these modules are evaluated, and a top-level `import` is hoisted past them.
 */
const HostFormsCard = require('./host-forms-card.component')
  .default as typeof import('./host-forms-card.component').default
const FormMetricsCard = require('./form-metrics-card.component')
  .default as typeof import('./form-metrics-card.component').default
const {
  buildFormPreviewDocument,
  default: FormDesignPreview,
} = require('./form-design-preview.component') as typeof import('./form-design-preview.component') & {
  default: typeof import('./form-design-preview.component').FormDesignPreview
}

/**
 * Every column the forms table declares, in the order it declares them.
 *
 * Named here rather than derived from the component: a check that read the
 * component's own column list would agree with it however few columns were
 * left, which is precisely the regression — an empty state that quietly stops
 * describing the artifact.
 */
const COLUMNS = [
  'Display name',
  'Slug',
  'Submissions',
  'Leads',
  'Last submission',
  'Updated',
  'Actions',
]

/** The two columns whose figures must line up under a right-aligned head. */
const NUMERIC_COLUMNS = ['Submissions', 'Leads']

/*
 * ONE mount for the whole table block, deliberately.
 *
 * The grid is expensive in jsdom — toolbar, virtualization, the lot — and this
 * file pushed a neighboring 130-second suite past its `waitFor` timeouts when
 * it mounted one per assertion. The empty state and the populated one are the
 * SAME table in two states, so they are asserted across one mount and a
 * `rerender`, which is also closer to what a reader does: they sit on the list
 * while the first form arrives.
 */
describe('the forms list is a table in both of its states', () => {
  it('renders its columns empty, then draws a row into them', () => {
    mockRows = []
    mockStatus = 'success'
    const { rerender } = render(
      <HostFormsCard hostId="host-1" basePath="/acme/hosts/demo/forms" />,
    )

    /* ── EMPTY ──────────────────────────────────────────────────────────── */

    // The columns are the explanation. A list that collapses to a sentence is
    // at its least informative exactly when a reader knows least, and this is
    // the state every new site is in.
    for (const column of COLUMNS) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(column, 'i') }),
      ).toBeTruthy()
    }
    // Numeric HEADS align right; the body half is asserted after the rerender.
    for (const column of NUMERIC_COLUMNS) {
      const header = screen.getByRole('columnheader', {
        name: new RegExp(column, 'i'),
      })
      expect(header.className).toContain('MuiDataGrid-columnHeader--alignRight')
    }
    // The columns teach the shape; the overlay says what the thing is for and
    // offers the way to make one.
    expect(screen.getByText('No forms yet')).toBeTruthy()
    expect(screen.getByText(/collects submissions/i)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /create your first form/i }),
    ).toBeTruthy()

    /* ── WITH A ROW ─────────────────────────────────────────────────────── */

    mockRows = [
      {
        $id: 'form-1',
        displayName: 'Contact us',
        slug: 'contact-us',
        stats: { submissions: 12 },
      },
    ]
    rerender(<HostFormsCard hostId="host-1" basePath="/acme/hosts/demo/forms" />)

    // THE CONTROL for everything above: without a state that DOES draw rows,
    // all of it could be satisfied by a table that renders headers and nothing
    // else, forever.
    expect(screen.getByText('Contact us')).toBeTruthy()
    expect(screen.queryByText('No forms yet')).toBeNull()
    // Body alignment. Head-only alignment looks correct in an empty table and
    // wrong the moment the column holds a number.
    expect(
      screen.getByRole('gridcell', { name: '12' }).className,
    ).toContain('MuiDataGrid-cell--textRight')
    // This fixture routes nowhere, so `/api/forms/submit` never wrote
    // `stats.leads` for it. A `0` here would report a measured absence of
    // leads; nobody measured.
    const row = screen.getByRole('row', { name: /Contact us/ })
    expect(row.textContent).toContain('--')
    expect(row.textContent).not.toContain('0')
  })
})

describe('the form preview cannot execute anything', () => {
  const design = (fields: Array<Record<string, unknown>>) => {
    const nodes: Record<string, any> = {
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'div',
        nodes: ['theForm'],
      },
      theForm: {
        $id: 'theForm',
        componentId: 'form',
        parentId: CANVAS_ROOT_ELEMENT_ID,
        props: { formId: 'form-abc' },
        nodes: fields.map((_field, index) => `f${index}`),
      },
    }
    fields.forEach((props, index) => {
      nodes[`f${index}`] = {
        $id: `f${index}`,
        componentId: 'formField',
        parentId: 'theForm',
        props,
      }
    })
    return nodes
  }

  it('renders into a frame with an EMPTY sandbox attribute', () => {
    // The maximally restrictive form: no scripts, no forms, no popups, no
    // top-level navigation and — the one that matters — no same-origin, so the
    // frame gets an opaque origin and cannot reach the console's session.
    const { container } = render(
      <FormDesignPreview
        formId="form-abc"
        nodes={design([{ fieldName: 'email', fieldType: 'email' }])}
      />,
    )
    const frame = container.querySelector('iframe') as HTMLIFrameElement
    expect(frame).toBeTruthy()
    expect(frame.getAttribute('sandbox')).toBe('')
    // `srcDoc`, never a URL: markup served from the console's own origin would
    // have the sandbox attribute as the only thing between it and a session.
    expect(frame.getAttribute('srcdoc')).toBeTruthy()
    expect(frame.getAttribute('src')).toBeNull()
  })

  it('escapes a label that tries to be markup', () => {
    const html = buildFormPreviewDocument({
      fields: [
        {
          fieldName: 'email',
          fieldType: 'email',
          label: '<script>fetch("/steal")</script>',
        },
      ],
    })
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes a field NAME, which becomes an attribute value', () => {
    // The name is written into `name="…"`, so a quote in it would close the
    // attribute — a different injection point from the text nodes above, and
    // the one an escaper written for text alone would miss.
    const html = buildFormPreviewDocument({
      fields: [
        {
          fieldName: '" onfocus="alert(1)',
          fieldType: 'text',
        },
      ],
    })
    expect(html).not.toContain('onfocus="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('escapes option text on a select', () => {
    const html = buildFormPreviewDocument({
      fields: [
        {
          fieldName: 'plan',
          fieldType: 'select',
          options: ['</option><img src=x onerror=alert(1)>'],
        },
      ],
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('THE CONTROL: the escaper is doing the work, not the assertion', () => {
    // A check for the ABSENCE of a string passes on a builder that renders
    // nothing at all. The author's text must still be there, as text.
    const html = buildFormPreviewDocument({
      fields: [
        { fieldName: 'email', fieldType: 'email', label: 'Your address' },
      ],
    })
    expect(html).toContain('Your address')
    expect(html).toContain('name="email"')
  })

  it('carries the names the SUBMIT route will read, not the labels', () => {
    // The whole point of this preview: `/api/forms/submit` never sees a pixel,
    // it sees `FormData` keys.
    const html = buildFormPreviewDocument({
      fields: [
        { fieldName: 'q1', fieldType: 'text', label: 'What brings you here?' },
      ],
    })
    expect(html).toContain('name="q1"')
  })

  it('drops an unnamed field exactly as a real submission does', () => {
    // Through `formFieldDeclsFromNodes`, the same function the publish path
    // calls. A second implementation would preview a form that does not exist.
    const { container } = render(
      <FormDesignPreview
        formId="form-abc"
        nodes={design([
          { fieldType: 'text' },
          { fieldName: 'email', fieldType: 'email' },
        ])}
      />,
    )
    const srcDoc = container.querySelector('iframe')?.getAttribute('srcdoc')
    expect(srcDoc).toContain('name="email"')
    expect(srcDoc).not.toContain('name=""')
  })
})

describe('a form metric never invents a denominator', () => {
  it('draws a dash, not a zero, for a counter that was never written', () => {
    render(
      <FormMetricsCard stats={undefined} fields={[]} leadRouting={false} />,
    )
    // Both counters unrecorded — and "not recorded" is what says which of the
    // two possible zeros this is.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('renders NO percentage when the denominator is unrecorded', () => {
    const { container } = render(
      <FormMetricsCard stats={undefined} fields={[]} leadRouting />,
    )
    expect(container.textContent).not.toContain('0%')
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?%/)
    expect(container.textContent).toContain('not enough recorded to compute')
  })

  it('renders NO percentage when the NUMERATOR alone is unrecorded', () => {
    // The case this product is actually in: submissions are counted and leads
    // are not. A numerator defaulted to zero over a real denominator prints a
    // confident `0.0%` — "not one submission became a lead" — over a counter
    // nothing has ever written.
    const { container } = render(
      <FormMetricsCard stats={{ submissions: 200 }} fields={[]} leadRouting />,
    )
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?%/)
    expect(container.textContent).toContain('not enough recorded to compute')
  })

  it('renders NO percentage when the denominator is a real zero either', () => {
    // A form with a recorded zero submissions still has no rate: a rate over
    // nothing is undefined, not 0%.
    const { container } = render(
      <FormMetricsCard
        stats={{ submissions: 0, leads: 0 }}
        fields={[]}
        leadRouting
      />,
    )
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('names what it could not compute rather than leaving it out', () => {
    const { container } = render(
      <FormMetricsCard stats={{ submissions: 4 }} fields={[]} leadRouting />,
    )
    // The block is a PROMISE about what the numbers mean, so it names the
    // gaps that are actually left: the values on the submission documents,
    // which cannot be counted without reading the collection, and the history
    // that predates each counter.
    expect(container.textContent).toContain('Per-field answer rates')
    expect(container.textContent).toContain('before a counter started')
  })

  it('takes NO rate over a lifetime total the denominator does not cover', () => {
    // The trap the periods map exists to close. Submissions have counted
    // since the form entity existed and views only since the beacon shipped,
    // so lifetime-over-lifetime here would divide a long history by a short
    // one and print a completion rate of 400%.
    const { container } = render(
      <FormMetricsCard
        stats={{ submissions: 200, views: 50 }}
        fields={[]}
        leadRouting
      />,
    )
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('THE CONTROL: it DOES take completion over the months views were recorded', () => {
    // Without this, the assertion above is satisfied by a card that can never
    // print a completion rate at all.
    const { container } = render(
      <FormMetricsCard
        stats={{
          submissions: 200,
          views: 50,
          periods: { '2026-08': { submissions: 10, views: 40 } },
        }}
        fields={[]}
        leadRouting
      />,
    )
    // Over the MONTH's numbers, not the lifetime ones: 10 of 40.
    expect(container.textContent).toContain('25.0%')
    expect(container.textContent).toContain('10 of 40 views')
  })

  it('withholds abandonment when more submissions were counted than starts', () => {
    // Starts are a browser beacon and submissions are a server write, so a
    // blocked beacon really does produce this. A clamp would publish "nobody
    // abandons this form" out of a measurement that had gone incoherent.
    const { container } = render(
      <FormMetricsCard
        stats={{ periods: { '2026-08': { submissions: 9, starts: 4 } } }}
        fields={[]}
        leadRouting
      />,
    )
    expect(container.textContent).toContain('Started and never submitted')
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('THE CONTROL: it DOES print a rate once both numbers are recorded', () => {
    // Otherwise every assertion above is satisfied by a card that can never
    // render a percentage, and the rule under test is untested.
    const { container } = render(
      <FormMetricsCard
        stats={{ submissions: 200, leads: 50 }}
        fields={[]}
        leadRouting
      />,
    )
    expect(container.textContent).toContain('25.0%')
    // And it names the population, on the same line as the number.
    expect(container.textContent).toContain('50 of 200 submissions')
  })
})
