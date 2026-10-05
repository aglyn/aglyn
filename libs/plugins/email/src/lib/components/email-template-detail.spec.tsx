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
 * WHAT REACHES THE SCREEN, AND WHAT IT IS ALLOWED TO DO THERE.
 *
 * What the template's emails did is the campaign owner's card, drawn in the
 * zone this page hosts (`email-template-report-card.spec.tsx` in the
 * Marketing plugin holds it); this file proves the page hands that zone what
 * it needs and reads no send itself, and that the preview cannot reach the
 * console it is drawn in.
 *
 * The sandbox assertion is the one worth stating plainly. The preview renders
 * markup written outside this console — by a site's own editors, or by a
 * marketplace publisher — and an iframe with NO `sandbox` attribute is
 * same-origin by default, which would put tenant HTML on the console's origin
 * with the reader's session in it. `sandbox=""` is the maximally restrictive
 * form; a `sandbox` that merely EXISTS is not enough, because
 * `sandbox="allow-scripts allow-same-origin"` is the combination that escapes
 * the sandbox entirely. So the assertion reads the attribute's VALUE.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()
/** What each `useFirestoreCollection` call answers, keyed by path. */
const mockCollections = new Map<string, unknown[]>()

/** Every `where` a query was built with, as its arguments. */
const mockWheres: unknown[][] = []

/** Every write the rename made, so a patch is a claim this file checks. */
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  query: (ref: { __path: string }) => ref,
  where: (...args: unknown[]) => {
    mockWheres.push(args)
    return {}
  },
  orderBy: () => ({}),
  limit: () => ({}),
  documentId: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useOrgDataScope: () => ({ orgId: 'org1', scope: ['orgs', 'org1'], ready: true }),
  // Nobody signed in, so the recipients card never issues its request. This
  // file is about the page above it.
  useUser: () => ({ data: null }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ''
    const data = mockDocs.get(path)
    return { data, status: data === undefined ? 'error' : 'success' }
  },
  useFirestoreCollection: (build: () => { __path?: string } | null) => ({
    data: mockCollections.get(build()?.__path ?? '') ?? [],
  }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/** Every route the page pushed, so a row click is a claim this file checks. */
const pushed: string[] = []
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const SCREEN_PATH = 'hosts/site1/screens/scr_1'
const VERSION_PATH = 'hosts/site1/screens/scr_1/versions/ver_1'

/**
 * A besigner node map, rooted at `_@_` — the id the besigner really writes.
 * A map rooted at `'root'` renders as an empty shell, so a fixture using it
 * would pass every assertion below for the wrong reason.
 */
const NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1', 't2'] },
  t1: { componentId: 'emailText', props: { children: 'Spring is here' } },
  // Left standing on purpose: the preview passes no merge map, so this is
  // what a reader should see where personalization lands.
  t2: { componentId: 'emailText', props: { children: 'Hi {{contact.name}}' } },
}

async function renderDetail(options?: {
  screen?: Record<string, unknown>
  version?: Record<string, unknown> | null
}): Promise<void> {
  mockDocs.clear()
  mockCollections.clear()
  mockWheres.length = 0
  mockDocs.set(SCREEN_PATH, {
    $id: 'scr_1',
    displayName: 'Spring promo',
    kind: 'email',
    versionId: 'ver_1',
    emailSubject: 'Spring sale',
    ...options?.screen,
  })
  if (options?.version !== null) {
    mockDocs.set(VERSION_PATH, options?.version ?? { nodes: NODES })
  }
  const { EmailTemplateDetail } = await import('./email-template-detail')
  render(
    (
      <ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>
        <EmailTemplateDetail
          hostId="site1"
          screenId="scr_1"
          basePath="/acme/hosts/site/emails"
        />
      </ConsoleWidgetSlotContext.Provider>
    ) as ReactNode as never,
  )
}

/**
 * The plugin that owns campaigns, reduced to what this page asks of it: it
 * draws what the template's emails did, and who received them, in the zones
 * this page hosts. The stand-in marks each so the page's ORDER can be
 * measured, and keeps what each was handed.
 */
let reportZone: Record<string, unknown> | null = null
let recipientsZone: Record<string, unknown> | null = null
function ZoneRenderer(props: { slot: string } & Record<string, unknown>) {
  if (props.slot === 'emailTemplateReport') {
    reportZone = props
    return <div>{'Sent from this template'}</div>
  }
  if (props.slot !== 'emailTemplateRecipients') return null
  recipientsZone = props
  return <div>{'Recipients'}</div>
}

describe('what the template’s emails did is the campaign owner’s', () => {
  it('hosts the report zone, handing it the template and the page’s base path', async () => {
    reportZone = null
    await renderDetail()
    expect(reportZone).toMatchObject({
      hostId: 'site1',
      screenId: 'scr_1',
      basePath: '/acme/hosts/site/emails',
    })
  })

  it('reads no send itself: the sends are the plugin’s that sent them', async () => {
    await renderDetail()
    expect(mockWheres).toEqual([])
    expect(screen.queryByText('Delivery')).toBeNull()
  })
})

describe('the template preview cannot reach the console it is drawn in', () => {
  it('renders the email into an iframe sandboxed with no permissions', async () => {
    await renderDetail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    expect(frame).toBeTruthy()
    // The VALUE, not merely the attribute: `allow-scripts allow-same-origin`
    // together is an escape, so "has a sandbox" is not the property worth
    // holding.
    expect(frame?.getAttribute('sandbox')).toBe('')
  })

  it('never lets the markup be served from the console origin', async () => {
    await renderDetail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    // `srcdoc`, never `src`: a URL would be fetched from this origin, where
    // the sandbox attribute is the only thing between tenant HTML and a live
    // session.
    expect(frame?.getAttribute('srcdoc')).toBeTruthy()
    expect(frame?.getAttribute('src')).toBeNull()
  })

  it('draws the send path’s own HTML, not a second rendering', async () => {
    await renderDetail()
    const html =
      document
        .querySelector('iframe[title="Email preview"]')
        ?.getAttribute('srcdoc') ?? ''
    expect(html).toContain('Spring is here')
    // Table layout with inline styles — the mail pipeline's output, which is
    // what makes this a preview of the message rather than of the editor.
    expect(html).toContain('role="presentation"')
  })

  it('leaves merge tokens standing so a reader can see where they land', async () => {
    await renderDetail()
    const html =
      document
        .querySelector('iframe[title="Email preview"]')
        ?.getAttribute('srcdoc') ?? ''
    expect(html).toContain('{{contact.name}}')
  })

  it('says a template with nothing in it is empty rather than drawing one', async () => {
    await renderDetail({ version: { nodes: {} } })
    expect(document.querySelector('iframe[title="Email preview"]')).toBeNull()
    expect(screen.getByText(/nothing in it yet/i)).toBeTruthy()
  })
})

describe('the template header carries the way into the besigner', () => {
  it('links Edit in besigner at the screen’s own version', async () => {
    await renderDetail()
    const link = screen.getByText('Edit in besigner').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/screens/scr_1/versions/ver_1/besigner',
    )
  })

  it('withholds it from a template that has no version to open', async () => {
    await renderDetail({ screen: { versionId: undefined }, version: null })
    const button = screen.getByText('Edit in besigner').closest('button')
    // A half-formed besigner URL lands on a 404, which reads as a broken
    // console rather than as a template that has never been saved.
    expect(button?.hasAttribute('disabled')).toBe(true)
  })
})

describe('a template installed from a marketplace listing', () => {
  it('says so, and says its standing has not been checked', async () => {
    await renderDetail({
      screen: {
        installedFrom: {
          listingId: 'listing_1',
          version: '3',
          sha256: 'a'.repeat(64),
          artifactType: 'emailTemplate',
        },
      },
    })
    expect(screen.getByText(/Installed from a marketplace listing/)).toBeTruthy()
    expect(screen.getByText(/has not been checked/)).toBeTruthy()
  })

  it('CONTROL: a locally authored template claims no publisher', async () => {
    await renderDetail()
    expect(screen.queryByText(/Installed from a marketplace listing/)).toBeNull()
  })
})

describe('the template preview sits at the bottom of the page', () => {
  /*==========================================
   * THE SAME ORDER THE EMAIL'S OWN PAGE USES.
   *
   * The figures are what a reader opens either page for, and the frame is the
   * tallest thing on both — at the top it pushes every number below the fold.
   * Held on both pages so the two cannot drift into disagreeing about what
   * they are for.
   *=========================================*/
  it('renders the preview frame AFTER the report of what its emails did', async () => {
    await renderDetail()
    const preview = document.querySelector('iframe[title="Email preview"]')
    const report = screen.getByText('Sent from this template')
    expect(preview).toBeTruthy()
    // DOM order, not mere presence: both are on the page whichever way round
    // they sit, so presence alone would pass with nothing moved.
    expect(
      report.compareDocumentPosition(preview as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders it AFTER the recipients card', async () => {
    await renderDetail()
    const preview = document.querySelector('iframe[title="Email preview"]')
    const recipients = screen.getByText('Recipients')
    // Handed the template, and nothing of a single message.
    expect(recipientsZone).toMatchObject({ hostId: 'site1', screenId: 'scr_1' })
    expect(
      recipients.compareDocumentPosition(preview as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('gives the preview card a heading rather than a hover tooltip', async () => {
    await renderDetail()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(document.querySelector('[title="Preview"]')).toBeNull()
  })
})

describe('the design can be renamed on its own page', () => {
  beforeEach(() => mockUpdateDoc.mockClear())

  it('seeds the field from the document and writes ONLY the typed name', async () => {
    await renderDetail()

    const field = screen.getByLabelText('Design name') as HTMLInputElement
    expect(field.value).toBe('Spring promo')

    fireEvent.change(field, { target: { value: 'August newsletter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [ref, patch] = mockUpdateDoc.mock.calls[0] as [
      { __path: string },
      Record<string, unknown>,
    ]
    expect(ref.__path).toBe(SCREEN_PATH)
    // The typed name and the keys derived from it (AGL-3321). A patch
    // carrying anything else would write a seed the reader never touched
    // back over the live document.
    expect(patch).toEqual({
      displayName: 'August newsletter',
      ...displayNameSearchFields('August newsletter'),
    })
  })

  it('cannot save an untouched field — there is nothing to write', async () => {
    await renderDetail()

    const rename = screen
      .getByRole('button', { name: 'Rename' })
      .closest('button') as HTMLButtonElement
    expect(rename.disabled).toBe(true)

    fireEvent.click(rename)
    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })
})
