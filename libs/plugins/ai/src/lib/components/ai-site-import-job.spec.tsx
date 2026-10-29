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
 * An import job's page (AGL-3976): the read with the first wave's quote and
 * its button, a wave in for its review with its drafts and the next wave's
 * button, and a wave held for a new proof, which only a verified site starts.
 */

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/acme/hosts/harbor/ai-jobs/job-1',
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiJobItemLedger, AiJobSummary } from '../model/ai-jobs.types'
import {
  aiSiteImportCanceled,
  aiSiteImportInventory,
  aiSiteImportLedger,
  aiSiteImportWaveClosed,
  aiSiteImportWaveStarted,
  type AiSiteImportListedPage,
  type AiSiteImportState,
} from '../model/ai-site-import'
import { AiSiteImportJob } from './ai-site-import-job.component'

const user = { uid: 'u1', getIdToken: async () => 'tok' }
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const listed = (path: string): AiSiteImportListedPage => ({
  url: `https://harbor-dental.com${path}`,
  path,
  title: path === '/' ? 'Home' : (path.split('/').pop() as string),
  foundBy: path === '/' ? 'home' : 'sitemap',
  words: 100,
  images: 1,
})

function harbor(): AiSiteImportState {
  let id = 0
  return aiSiteImportInventory({
    domain: 'harbor-dental.com',
    siteName: 'Harbor Dental',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: 'x',
    pages: ['/', '/about', ...Array.from({ length: 4 }, (_, index) => `/blog/post-${index + 1}`)].map(listed),
    menu: ['/', '/about'],
    skipped: [],
    stoppedBy: null,
    pageLimit: 25,
    existingPages: 0,
    mintId: () => `d${++id}`,
  })
}

function summary(patch: Partial<AiJobSummary>): AiJobSummary {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'import',
    status: 'needs_review',
    brief: 'Bring in harbor-dental.com',
    batch: null,
    steps: [{ name: 'generate', status: 'pending', startedAt: null, endedAt: null, creditsSpent: 0, error: null }],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: 'x',
    updatedAt: 'x',
    error: null,
    running: false,
    plan: null,
    review: { reason: 'wave', message: 'Your site is read: 6 pages to bring in, in 2 waves. Start the first wave when you are ready.', findings: [] },
    ...patch,
  }
}

let mockFetch: jest.Mock
beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

const view = (job: AiJobSummary, onResume = jest.fn(), onStartAll?: () => void) =>
  render(
    <AiSiteImportJob
      job={job}
      orgId="org-1"
      orgSlug="acme"
      host="harbor"
      siteName="Harbor Dental"
      user={user}
      busy={false}
      notice={null}
      onResume={onResume}
      {...(onStartAll ? { onStartAll } : {})}
      onJob={jest.fn()}
    />,
  )

describe('a canceled import (AGL-4107)', () => {
  it('lists its running wave as stopped and the next as not started, never as running', () => {
    const state = aiSiteImportCanceled(aiSiteImportWaveStarted(harbor(), 0, 'x', new Map()), 'y')
    view(summary({ status: 'canceled', review: null, siteImport: state, items: aiSiteImportLedger(state) }))
    fireEvent.click(screen.getByText(/^Every wave/))
    expect(screen.getByText(/\(stopped\)$/)).toBeTruthy()
    expect(screen.getByText(/\(not started\)$/)).toBeTruthy()
    expect(screen.queryByText(/\(running\)$/)).toBeNull()
  })
})

describe('an import job’s page', () => {
  it('says the site is read, what was found, and starts the first wave only when asked, quoting it first', () => {
    const state = harbor()
    const onResume = jest.fn()
    view(summary({ siteImport: state, items: aiSiteImportLedger(state) }), onResume)
    expect(screen.getByRole('heading', { level: 1, name: 'Your site is read' })).toBeTruthy()
    expect(screen.getByText('Found 6 pages on harbor-dental.com: Main pages (2) and Blog (4).')).toBeTruthy()
    expect(screen.getByText('First: Main pages')).toBeTruthy()
    expect(screen.getByText('About 83 credits (up to 250), from your AI credits. Its pages land in your site’s preview, or as drafts where the site is not in preview.')).toBeTruthy()
    expect(onResume).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start Main pages' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('shows a wave in for review with its drafts to open, and the next wave’s button', () => {
    let state = harbor()
    state = aiSiteImportWaveClosed(aiSiteImportWaveStarted(state, 0, 'x', new Map()), 0, 'y')
    const items = aiSiteImportLedger(state).map((row): AiJobItemLedger =>
      row.slot === 'frame' || row.slot === 'p0' || row.slot === 'p1'
        ? { ...row, status: 'succeeded', creditsSpent: 27, outputs: [`out-${row.slot}`] }
        : row,
    )
    const outputs = [
      { resource: 'screen' as const, id: 'out-p0', versionId: 'v1', hostId: 'host-1', hostSubdomain: 'harbor', label: 'Home' },
      { resource: 'screen' as const, id: 'out-p1', versionId: 'v1', hostId: 'host-1', hostSubdomain: 'harbor', label: 'about' },
    ]
    view(summary({ siteImport: state, items, outputs, review: { reason: 'wave', message: 'Main pages is in.', findings: [] } }))
    expect(screen.getByRole('heading', { level: 1, name: 'Main pages is in' })).toBeTruthy()
    const drafts = screen.getAllByRole('link', { name: 'Open draft' })
    expect(drafts.map((link) => link.getAttribute('href'))).toEqual([
      '/acme/hosts/harbor/screens/out-p0/versions/v1/besigner',
      '/acme/hosts/harbor/screens/out-p1/versions/v1/besigner',
    ])
    expect(screen.getByText('This wave used 81 AI credits.')).toBeTruthy()
    expect(screen.getByText('Next: Blog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start Blog' })).toBeTruthy()
  })

  it('holds a wave for a new proof: the wave starts only once the site is verified again', async () => {
    const state = harbor()
    const onResume = jest.fn()
    view(
      summary({
        siteImport: state,
        items: aiSiteImportLedger(state),
        review: { reason: 'ownership', message: 'Verify that you own harbor-dental.com before bringing it in.', findings: [] },
      }),
      onResume,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Verify your site again' })).toBeTruthy()
    const start = screen.getByRole('button', { name: 'Start Main pages again' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    mockFetch.mockResolvedValueOnce(
      json({
        claim: {
          domain: 'harbor-dental.com',
          status: 'proven',
          current: false,
          provenMethod: 'dns',
          provenAt: 1,
          provenDetail: null,
          lastChecks: {},
          dns: { host: '_aglyn-challenge.harbor-dental.com', type: 'TXT', value: 'aglyn-domain-verification=t' },
          meta: { name: 'aglyn-site-verification', content: 't', tag: '<meta name="aglyn-site-verification" content="t">' },
          email: { domain: 'harbor-dental.com', pendingAddress: null, expiresAt: null, attemptsLeft: null },
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Verify again' }))
    await screen.findByText('Add a DNS record')
    expect(screen.getByText('Verify again')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Start Main pages again' }) as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ orgId: 'org-1', action: 'claim', domain: 'harbor-dental.com' })
    await waitFor(() => expect(onResume).not.toHaveBeenCalled())
  })

  it('says the site is being read before anything else', () => {
    view(summary({ status: 'running', review: null }))
    expect(screen.getByRole('heading', { level: 1, name: 'Reading your site' })).toBeTruthy()
  })

  it('holds a site whose home page bot protection turned away, says so, and checks again on the person’s say-so (AGL-4083)', () => {
    const onResume = jest.fn()
    const message =
      'Your site’s bot protection or firewall turned AglynBot away before it could read your home page, and 110 other pages. Nothing was brought in and no AI credits were used. Allow AglynBot in your site’s bot or firewall settings, then choose Check again.'
    view(summary({ review: { reason: 'blocked', message, findings: [] } }), onResume)
    expect(screen.getByRole('heading', { level: 1, name: 'AglynBot was turned away' })).toBeTruthy()
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Start / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('offers every remaining wave beside the next one only where the page can start them, quoting them all (AGL-4083)', () => {
    const state = harbor()
    const job = summary({ siteImport: state, items: aiSiteImportLedger(state) })
    const { unmount } = view(job)
    expect(screen.queryByRole('button', { name: 'Start every remaining wave' })).toBeNull()
    unmount()
    const onStartAll = jest.fn()
    view(job, jest.fn(), onStartAll)
    fireEvent.click(screen.getByRole('button', { name: 'Start every remaining wave' }))
    expect(onStartAll).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/^About \d+ credits \(up to [\d,]+\) for every remaining wave/)).toBeTruthy()
  })

  it('links each page to its old page on the source site (AGL-4083)', () => {
    const state = harbor()
    view(summary({ siteImport: state, items: aiSiteImportLedger(state) }))
    const old = screen.getAllByRole('link', { name: /Old page/ })
    expect(old[0].getAttribute('href')).toBe('https://harbor-dental.com/')
    expect(old[0].getAttribute('target')).toBe('_blank')
  })
})
