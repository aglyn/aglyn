/**
 * @jest-environment jsdom
 */

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
 * WHAT ONE FORM'S PAGE PUTS IN THE CHROME, AND WHAT IT NO LONGER DRAWS ITSELF.
 *
 * The surface used to open a strip of its own between the page header and the
 * cards: a link back to the list, the form's name in an `h6`, and the besigner
 * button. All three were the page header's job, and the header meanwhile said
 * `Forms` — the list's name, identical on every row of it — with a trail that
 * stopped there too.
 *
 * Forms declares no sections, so the action belongs in the PAGE header beside
 * the title, where Screens, Layouts, Components and Templates put theirs. The
 * record's name goes there too, and into the trail.
 *
 * The slots themselves are the console layout's, and their wiring is asserted
 * against the real `DashboardLayout` in
 * `apps/console/specs/record-detail-page-chrome.spec.tsx`. A plugin lib may
 * not import console-app code, so the provider here is a stand-in of the same
 * shape. What is under test is what the FORM DETAIL surface publishes, and
 * what it stopped rendering in its own body.
 */

import { render, screen, within } from '@testing-library/react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  PageHeaderActionsContext,
  PageHeaderRecordContext,
  type PageHeaderRecordValue,
} from '@aglyn/aglyn'

/** The form document the surface reads, or `undefined` for "no such form". */
let mockForm: Record<string, unknown> | undefined
/** `loading` until the read settles, which is what tells absent from pending. */
let mockStatus: string

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (source: any) => source,
  limit: (value: number) => ({ type: 'limit', value }),
  updateDoc: async () => undefined,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: mockForm, status: mockStatus }),
  useFirestoreCollection: () => ({ data: [] }),
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/demo',
    orgSlug: 'acme',
    subdomain: 'demo',
  }),
  useHostVersionApi: () => jest.fn().mockResolvedValue('v1'),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: any) => <a href={href}>{children}</a>,
  CardDisplay: (props: any) => (
    <section aria-label="card">
      {props.header ? <h2>{props.header}</h2> : null}
      {props.HeaderProps?.action ?? null}
      {props.children}
    </section>
  ),
  GridItems: ({ items }: any) => (
    <div>
      {(items ?? []).map((item: any, index: number) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  MdiIcon: () => null,
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
}))

/* The two cards this file is not about. */
jest.mock('./form-design-preview.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./form-metrics-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./use-form-promote-api', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))

import FormDetailCard from './form-detail-card'

/**
 * A page header of two slots, the shape `DashboardLayout` provides.
 *
 * Both context values are built once, so a publish never re-renders the
 * surface that published it — the property that keeps a surface publishing on
 * every render out of a render loop.
 */
function ChromeHarness(props: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  const [record, setRecord] = useState<PageHeaderRecordValue | null>(null)
  const actionsValue = useMemo(() => ({ setHeaderActions: setActions }), [])
  const recordValue = useMemo(() => ({ setHeaderRecord: setRecord }), [])
  return (
    <PageHeaderActionsContext.Provider value={actionsValue}>
      <PageHeaderRecordContext.Provider value={recordValue}>
        <header>
          <h1>{record?.title ?? 'Forms'}</h1>
          {actions}
        </header>
        {props.children}
      </PageHeaderRecordContext.Provider>
    </PageHeaderActionsContext.Provider>
  )
}

/** The page header, by its landmark role. */
const pageHeader = () => screen.getByRole('banner')

/** The page heading, which on a detail page must be the record's name. */
const heading = () => screen.getByRole('heading', { level: 1 }).textContent

/** Everything the surface drew for itself, header excluded. */
const body = () => screen.getByTestId('surface-body')

function renderDetail(options: {
  form?: Record<string, unknown>
  status?: string
}) {
  mockForm = options.form
  mockStatus = options.status ?? 'success'
  return render(
    (
      <ChromeHarness>
        <div data-testid="surface-body">
          <FormDetailCard
            hostId="host-1"
            formId="form-abc"
            basePath="/acme/hosts/demo/forms"
            canPublish
            hostRoleLoaded
          />
        </div>
      </ChromeHarness>
    ) as any,
  )
}

describe('one form’s page names the form in the chrome it does not own', () => {
  it('CONTROL: the heading is the form, and the besigner button is up there with it', () => {
    renderDetail({ form: { $id: 'form-abc', displayName: 'Test Form' } })
    expect(heading()).toBe('Test Form')
    expect(
      within(pageHeader()).getByRole('button', { name: /Edit in besigner/ }),
    ).toBeTruthy()
  })

  it('falls back to the id, which is what the URL already shows', () => {
    // A form saved with no display name still has to distinguish its page
    // from every other form's, and the id is the one thing always present.
    renderDetail({ form: { $id: 'form-abc' } })
    expect(heading()).toBe('form-abc')
  })

  it('draws no back link and no heading of its own above the cards', () => {
    renderDetail({ form: { $id: 'form-abc', displayName: 'Test Form' } })
    // The strip this replaces: a link reading `Forms`, the name beside it,
    // and the button. The trail carries the first, the heading the second,
    // and the header the third — so all three would now be duplicates.
    expect(within(body()).queryByRole('link', { name: 'Forms' })).toBeNull()
    expect(
      within(body()).queryByRole('button', { name: /Edit in besigner/ }),
    ).toBeNull()
    // Not merely "no `h6`": the name must not appear anywhere in the body's
    // own chrome. It IS still in the Display name field, which is an input
    // rather than text, and inputs carry their value off `textContent`.
    expect(within(body()).queryByText('Test Form')).toBeNull()
  })

  it('publishes nothing while the form is still being read', () => {
    // Mid-load the surface has no name to offer, and the shell's own heading
    // is a better answer than a flash through the wrong one.
    renderDetail({ form: undefined, status: 'loading' })
    expect(heading()).toBe('Forms')
  })

  it('keeps a way back on a form that does not exist', () => {
    // The one case where a link to the list belongs in the body: there is no
    // record, so nothing names this page in the trail, and the reader needs
    // somewhere to go.
    renderDetail({ form: undefined, status: 'success' })
    expect(heading()).toBe('Forms')
    const back = within(body()).getByRole('link', { name: 'Back to forms' })
    expect(back.getAttribute('href')).toBe('/acme/hosts/demo/forms')
    // And no besigner button: opening one would mint a version document
    // under an id that has no form behind it.
    expect(
      within(pageHeader()).queryByRole('button', { name: /Edit in besigner/ }),
    ).toBeNull()
  })
})
