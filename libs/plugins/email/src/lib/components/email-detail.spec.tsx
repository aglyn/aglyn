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
 * ONE MESSAGE'S PAGE.
 *
 * Three things are worth holding here and are held nowhere else: the preview
 * says it is the template as it stands NOW rather than a record of what went
 * out, every rate carries its denominator, and the page names where the
 * message went — the campaign, and the list as the SEND recorded it.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampaignStats } from '../model/campaign-report'

const mockDocs = new Map<string, unknown>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  // Nobody signed in, so the recipients card never issues its request.
  useUser: () => ({ data: null }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ''
    const data = mockDocs.get(path)
    return { data, status: data === undefined ? 'error' : 'success' }
  },
}))

const EMAIL_PATH = 'hosts/site1/campaigns/msg_1'
const LINKS_PATH = 'hosts/site1/campaigns/msg_1/reports/links'
const TEMPLATE_PATH = 'hosts/site1/screens/scr_1'
const TEMPLATE_VERSION_PATH = 'hosts/site1/screens/scr_1/versions/ver_1'

/** Rooted at `_@_`, the id the besigner really writes. */
const NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1'] },
  t1: { componentId: 'emailText', props: { children: 'Spring is here' } },
}

/** 100 sent, 90 delivered — two different numbers to divide by. */
const STATS: CampaignStats = {
  recipients: 100,
  sent: 100,
  delivered: 90,
  opens: 60,
  uniqueOpens: 45,
  clicks: 12,
  uniqueClicks: 9,
  bounced: 10,
  complained: 3,
  unsubscribes: 6,
  clickTracked: true,
}

async function renderEmail(options?: {
  email?: Record<string, unknown> | null
  links?: unknown
}): Promise<void> {
  mockDocs.clear()
  if (options?.email !== null) {
    mockDocs.set(EMAIL_PATH, {
      subject: 'Spring sale',
      status: 'sent',
      audience: 'list',
      listId: 'list_1',
      listName: 'Newsletter',
      templateScreenId: 'scr_1',
      sentAt: { toMillis: () => 1_700_000_000_000 },
      stats: STATS,
      ...options?.email,
    })
  }
  if (options?.links) mockDocs.set(LINKS_PATH, options.links)
  mockDocs.set(TEMPLATE_PATH, {
    displayName: 'Spring promo',
    versionId: 'ver_1',
  })
  mockDocs.set(TEMPLATE_VERSION_PATH, { nodes: NODES })
  const { EmailDetail } = await import('./email-detail')
  render(
    (
      <EmailDetail
        hostId="site1"
        emailId="msg_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

describe('a message previews its template, and says which template', () => {
  it('draws the send path’s own HTML in a fully sandboxed frame', async () => {
    await renderEmail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toContain('Spring is here')
  })

  it('says the preview is the template TODAY, not what was mailed', async () => {
    await renderEmail()
    // The mail is rendered per recipient at send time and not kept, so a
    // template edited since previews as it is now. A reader taking this for a
    // record of what went out is the failure this line exists to stop.
    expect(screen.getByText(/template as it stands today/i)).toBeTruthy()
  })

  it('has nothing to draw for a message written as plain text', async () => {
    await renderEmail({ email: { templateScreenId: undefined } })
    expect(document.querySelector('iframe[title="Email preview"]')).toBeNull()
    expect(screen.getByText(/no design to draw/i)).toBeTruthy()
  })
})

describe('a message names where it went', () => {
  it('links the campaign it belongs to', async () => {
    await renderEmail()
    const link = screen.getByText('Open the campaign').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/emails/campaigns/msg_1',
    )
  })

  it('names the list as the SEND recorded it', async () => {
    await renderEmail()
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('never prints a list id as if it were a list name', async () => {
    await renderEmail({ email: { listName: undefined } })
    expect(screen.queryByText('list_1')).toBeNull()
    expect(screen.getByText(/did not name/i)).toBeTruthy()
  })

  it('links the template it was built from', async () => {
    await renderEmail()
    const link = screen.getByText('Spring promo').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/emails/designs/scr_1',
    )
  })
})

describe('a message report names its denominators on screen', () => {
  it('renders the open rate beside "45 of 90 delivered"', async () => {
    await renderEmail()
    expect(screen.getByText('Open rate')).toBeTruthy()
    expect(screen.getByText('45 of 90 delivered')).toBeTruthy()
  })

  it('takes the bounce rate over SENT, not over delivered', async () => {
    await renderEmail()
    expect(screen.getByText('10 of 100 sent')).toBeTruthy()
  })

  it('shows an unrecorded delivered count as a dash, never as zero', async () => {
    await renderEmail({ email: { stats: { sent: 100, opens: 4 } } })
    expect(screen.getByText('Delivered')).toBeTruthy()
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('gives each link its share over the clicks that table counted', async () => {
    await renderEmail({
      links: {
        links: {
          k1: { url: 'https://acme.test/spring', clicks: 8 },
          k2: { url: 'https://acme.test/sale', clicks: 2 },
        },
      },
    })
    expect(screen.getByText('https://acme.test/spring')).toBeTruthy()
    expect(screen.getByText('80.0% of 10 link clicks counted')).toBeTruthy()
  })

  it('distinguishes a message it cannot read from one with no engagement', async () => {
    await renderEmail({ email: null })
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    expect(screen.queryByText('Open rate')).toBeNull()
  })
})
