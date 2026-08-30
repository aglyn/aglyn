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
 * `template-report.spec.ts` proves the arithmetic; this file proves the
 * arithmetic is what a reader sees, and that the preview beside it cannot
 * reach the console it is drawn in.
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

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampaignStats } from '../model/campaign-report'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()
/** What each `useFirestoreCollection` call answers, keyed by path. */
const mockCollections = new Map<string, unknown[]>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  query: (ref: { __path: string }) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  documentId: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
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

const SCREEN_PATH = 'hosts/site1/screens/scr_1'
const VERSION_PATH = 'hosts/site1/screens/scr_1/versions/ver_1'
const CAMPAIGNS_PATH = 'hosts/site1/campaigns'

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

/**
 * Measured: 100 sent, 90 delivered. The two differ, so an assertion reading a
 * denominator off the screen can tell which one was divided by.
 */
const MEASURED: CampaignStats = {
  recipients: 100,
  sent: 100,
  delivered: 90,
  opens: 60,
  uniqueOpens: 45,
  clicks: 12,
  uniqueClicks: 9,
  bounced: 10,
  clickTracked: true,
}

/** From before the delivery webhook: real opens, no delivery denominator. */
const UNMEASURED: CampaignStats = { recipients: 200, sent: 200, opens: 30 }

async function renderDetail(options?: {
  screen?: Record<string, unknown>
  version?: Record<string, unknown> | null
  messages?: Record<string, unknown>[]
}): Promise<void> {
  mockDocs.clear()
  mockCollections.clear()
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
  mockCollections.set(
    CAMPAIGNS_PATH,
    options?.messages ?? [
      {
        $id: 'msg_1',
        subject: 'Spring sale',
        status: 'sent',
        audience: 'list',
        listId: 'list_1',
        listName: 'Newsletter',
        sentAt: { toMillis: () => 1_700_000_000_000 },
        stats: MEASURED,
      },
    ],
  )
  const { EmailTemplateDetail } = await import('./email-template-detail')
  render(
    (
      <EmailTemplateDetail
        hostId="site1"
        screenId="scr_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

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

describe('the template report names its denominators on screen', () => {
  it('renders the open rate beside the campaigns it covers', async () => {
    await renderDetail({
      messages: [
        { $id: 'a', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 2 }, stats: MEASURED },
        { $id: 'b', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 1 }, stats: UNMEASURED },
      ],
    })
    expect(screen.getByText('Open rate')).toBeTruthy()
    // The subset is on the screen, not only in the model: 45 of 90 taken over
    // the one campaign that recorded a delivery, out of the two that exist.
    expect(
      screen.getByText('45 of 90 delivered across 1 of 2 campaigns'),
    ).toBeTruthy()
  })

  it('shows an unrecorded delivered count as a dash, never as zero', async () => {
    await renderDetail({
      messages: [
        { $id: 'b', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 1 }, stats: UNMEASURED },
      ],
    })
    expect(screen.getByText('Delivered')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('names the list a message went to as the send recorded it', async () => {
    await renderDetail()
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('links each message to its own page', async () => {
    await renderDetail()
    const link = screen.getByText('Spring sale').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/site/emails/emails/msg_1')
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
