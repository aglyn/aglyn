/**
 * @jest-environment jsdom
 */

/**
 * THE `author` HOST ROLE MAY EDIT A FORM AND MAY NOT PUBLISH ONE.
 *
 * That is enforced where it must be — the Firestore rules and
 * `/api/hosts/forms/promote` both refuse — and the console's job is to say no
 * with a reason instead of letting a click come back as a bare
 * `permission-denied`.
 *
 * The verdict is resolved by the SHELL and handed to this surface as a prop,
 * because reading it needs the viewer's org member document and the host-access
 * predicate over it, neither of which a `scope:lib` plugin may reach. So the
 * failure this file guards is a wiring one: a prop that stops being passed, or
 * a control that stops reading it, disables nothing and looks completely
 * normal.
 *
 * Asserted through the rendered control rather than through the prop, because
 * what is being claimed is what an author can click.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockVersions = [
  { $id: 'v2', displayName: 'Second' },
  { $id: 'v1', displayName: 'First' },
]

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  query: (base: unknown) => base,
  limit: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  documentId: () => '__name__',
  updateDoc: async () => undefined,
  onSnapshot: () => () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
}))

const mockFirestore = { __db: true }
const mockUser = { data: { uid: 'u1', getIdToken: async () => 't' } }
const mockServices = {
  app: {},
  firestore: mockFirestore,
  auth: { currentUser: { uid: 'u1' } },
  storage: {},
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => mockUser,
  useFirebaseServices: () => mockServices,
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/site',
    orgSlug: 'acme',
    subdomain: 'site',
  }),
  useHostVersionApi: () => async () => undefined,
  // The site's campaigns, which fill the picker in the form's Details card.
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useHostResourceApi: () => async () => undefined,
  useLiveArtifactCount: () => 0,
  // The form itself, and the versions the Publish buttons hang off. Answered
  // rather than left to the real listeners: what is under test is the control,
  // and a surface still waiting for its first snapshot renders none.
  useFirestoreDoc: () => ({
    data: { $id: 'form-abc', displayName: 'Contact us', versionId: 'v1' },
    status: 'success',
  }),
  useFirestoreCollection: () => ({ data: mockVersions, status: 'success' }),
  usePagedCollection: () => ({
    status: 'success',
    rows: [],
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: () => undefined,
    closeSnackbar: () => undefined,
  }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  usePathname: () => '/acme/hosts/site/forms/form-abc',
}))

jest.mock('./form-design-preview.component', () => ({
  __esModule: true,
  default: () => null,
}))

import FormsConsolePage from './forms-console-page'

const renderDetail = (hostRole?: { canPublish: boolean; loaded: boolean }) =>
  render(
    <FormsConsolePage
      hostId="site1"
      entitled
      org={{} as never}
      permissions={{} as never}
      basePath="/acme/hosts/site/forms"
      segments={['form-abc']}
      hostRole={hostRole}
    /> as ReactNode as never,
  )

/** The Publish control on the version that is NOT already live. */
const publishButton = () =>
  screen.getAllByRole('button').find((button) => button.textContent === 'Publish')

describe('who may make a form version live', () => {
  it('CONTROL: an editor gets a live Publish control', () => {
    // Without this, every refusal below is satisfied by a surface that renders
    // no Publish button at all.
    renderDetail({ canPublish: true, loaded: true })
    const button = publishButton()
    expect(button).toBeTruthy()
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('refuses an author, with the reason on the control', () => {
    renderDetail({ canPublish: false, loaded: true })
    const button = publishButton()
    // Disabled rather than hidden: an absent control and a refused one look
    // identical, and only one of them says why.
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button?.getAttribute('title')).toContain('not publish')
  })

  it('says "checking" rather than "no" while the role is in flight', () => {
    renderDetail({ canPublish: false, loaded: false })
    expect(publishButton()?.getAttribute('title')).toContain('Checking')
  })

  it('fails CLOSED when the shell passes no verdict at all', () => {
    // The wiring failure this file exists for. A prop that stops being handed
    // down must read as "not yet", never as "go ahead" — the display gate sits
    // in front of an enforced boundary, so the only cost of being wrong this
    // way is a control that is briefly inert.
    renderDetail(undefined)
    expect((publishButton() as HTMLButtonElement).disabled).toBe(true)
  })
})
