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
 * Neither email besigner may write a subject line seeded from a read the
 * server never confirmed (AGL-1358).
 *
 * These two pages are LITERAL twins — one file was copied to make the other —
 * and that is exactly how this bug survived: AGL-1066 guarded the host-scoped
 * page and nobody carried the guard across to the staff one, where the
 * blast radius is larger (a system email goes to every account on Aglyn).
 *
 * So both are driven from ONE spec, through the same table. A guard added to
 * one twin and missed on the other now fails here rather than in production.
 *
 * The shape: the properties drawer's two fields each fall back to
 * `template?.…` when the author edited only the other one, so the save
 * carries BOTH and `merge: true` protects neither. A cached seed writes
 * yesterday's preheader back over a newer one.
 *
 * Both directions are asserted, and the POSITIVE control matters most — this
 * guard stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/** What the TEMPLATE listener reports; the version listener is inert here. */
const templateSeed = {
  data: { subject: 'Stored subject', preheader: 'Stored preheader' } as unknown,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

jest.mock('firebase/firestore', () => ({
  // A ref that carries its path, so the doc hook below can tell the template
  // listener from the version listener without depending on call order.
  doc: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  Timestamp: { now: () => ({ seconds: 0 }) },
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (refFactory: () => { path?: string } | null) => {
    const ref = refFactory()
    // `…/versions/…` is the node document; everything else is the template
    // the properties drawer is seeded from.
    if (!ref || ref.path?.includes('/versions/')) {
      return {
        data: { nodes: {} },
        status: 'success',
        error: null,
        hasPendingWrites: false,
        fromCache: false,
      }
    }
    return { ...templateSeed, error: null, hasPendingWrites: false }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { email: 'staff@aglyn.com' } }),
  saveNodesGuarded: jest.fn().mockResolvedValue(undefined),
  // The REAL guard (AGL-1358). A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/aglyn', () => ({
  HostViewType: { EMAIL: 'email' },
  canvas: { rootNode: null, nestedNodes: {}, didSetInitial: true },
  CANVAS_ROOT_ELEMENT_ID: 'root',
}))
jest.mock('@aglyn/besigner', () => ({
  focus: { getLastSelected: () => null },
}))
jest.mock('@aglyn/besigner-ui', () => ({
  BesignerConflictAlertComponent: () => null,
  BesignerDraftAlertComponent: () => null,
  // Rendered unconditionally: the drawer's open state is chrome, and what
  // this spec is about is what the Save button does.
  CloseableDrawerComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  useBesignerDocument: () => ({
    saveAvailable: false,
    remoteChanged: false,
    draft: null,
    handleSave: () => undefined,
    jsonOpen: false,
    openJsonEditor: () => undefined,
    closeJsonEditor: () => undefined,
    handleJsonSave: () => undefined,
    hasError: false,
    notFound: false,
  }),
  useRenderedCanvasElements: () => ({ elements: { current: {} } }),
  withBesignerContext: (component: unknown) => component,
  nodeElementSelector: () => '',
}))

jest.mock('@aglyn/shared-util-email', () => {
  const definition = {
    name: 'Welcome',
    defaultSubject: 'Welcome aboard',
    mergeTokens: [],
  }
  return {
    SYSTEM_EMAIL_COLLECTION: 'systemEmails',
    TENANT_EMAIL_COLLECTION: 'emailTemplates',
    getSystemEmailTemplate: () => definition,
    getTenantEmail: () => definition,
    isSystemEmailEditable: () => true,
    isTenantEmailEditable: () => true,
  }
})

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useLoading: () => ({ queueLoading: () => () => undefined }),
  HelpTip: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/const/prebuilt-components', () => ({
  LOADING_OVERLAY_ELEMENT: null,
}))

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => null,
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ templateKey: 'welcome', versionId: 'v1' }),
}))
jest.mock('mobx-react-lite', () => ({
  observer: (component: unknown) => component,
}))

jest.mock('../components/layouts/main.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/besigner-app-bar.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/binding-picker-provider.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/besigner-media-picker-provider.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/collaborator-overlays.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/presence-avatars.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-presence', () => ({
  __esModule: true,
  default: () => ({ entries: [], session: null }),
}))
jest.mock('../hooks/use-coediting', () => ({
  __esModule: true,
  default: () => ({ clearMirror: () => undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-is-staff', () => ({ useIsStaff: () => true }))
jest.mock('../constants/app-setup', () => ({}))
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: () => Promise.resolve() },
}))
jest.mock('../constants/route-links', () => ({
  buildRoute: () => '/x',
  Route: {
    ADMIN_EMAILS: 'admin-emails',
    HOST_SETUP: 'host-setup',
    HOST_DASHBOARD: 'host-dashboard',
  },
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const StaffPage =
  require('../app/(editor)/admin/emails/[templateKey]/versions/[versionId]/besigner/page').default
const HostPage =
  require('../app/(editor)/[orgSlug]/hosts/[host]/emails/[templateKey]/versions/[versionId]/besigner/page').default
/* eslint-enable @typescript-eslint/no-var-requires */

const PAGES: Array<[string, () => JSX.Element]> = [
  ['staff system email', StaffPage],
  ['host email', HostPage],
]

/** Type a new subject, which is what makes Save reachable. */
async function typeSubjectAndSave(): Promise<void> {
  const subject = await screen.findByLabelText('Subject')
  fireEvent.change(subject, { target: { value: 'Edited subject' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save subject' }))
}

describe.each(PAGES)('%s besigner properties (AGL-1358)', (_label, Page) => {
  beforeEach(() => {
    jest.clearAllMocks()
    templateSeed.fromCache = false
    templateSeed.status = 'success'
  })

  it('REFUSES to write a subject seeded from an unconfirmed read', async () => {
    templateSeed.fromCache = true
    render(<Page />)

    await typeSubjectAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('email'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The typed value stays on screen. A refusal that also cleared the field
    // would send the author back to retype a form that will be refused again
    // just as quietly.
    expect(
      (screen.getByLabelText('Subject') as HTMLInputElement).value,
    ).toEqual('Edited subject')
  })

  it('SAVES once the server has confirmed the seed', async () => {
    render(<Page />)

    await typeSubjectAndSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.subject).toEqual('Edited subject')
    // The untouched field rides along from the seed — which is precisely why
    // the guard is needed and why `merge: true` is not protection.
    expect(payload.preheader).toEqual('Stored preheader')
    expect(options).toEqual({ merge: true })
  })

  it('REFUSES when the template read failed, and says so differently', async () => {
    templateSeed.status = 'error'
    render(<Page />)

    await typeSubjectAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})
