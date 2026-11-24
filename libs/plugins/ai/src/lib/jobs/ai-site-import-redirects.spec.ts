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

import type {
  PluginDraftRequest,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiJobItemLedger } from '../model/ai-jobs.types'
import type { AiSiteImportPage, AiSiteImportState } from '../model/ai-site-import'
import { AI_SITE_IMPORT_REDIRECT_RESOURCE, aiSiteImportRedirectId, aiSiteImportWriteRedirects } from './ai-site-import-redirects'

/**
 * A closed wave's redirects (AGL-4245), written through a fake of the
 * redirects plugin's writer on the resource-drafts seam: what is asked for,
 * under which id, and how each of the writer's answers is reported. No
 * Firestore, no network: the site is one hand-built host document.
 */

const NOW = new Date('2026-11-24T12:00:00Z')
const JOB = { $id: 'job-1', orgId: 'org-1', hostId: 'host-1', createdBy: 'uid-owner' }

function page(slot: string, path: string, slug: string): AiSiteImportPage {
  return { slot, url: `https://old.example.com${path}`, path, title: slot, group: 'main', wave: 0, draftId: `d-${slot}`, slug, words: 50, images: 0 }
}

const PAGES = [page('p0', '/', '/'), page('p1', '/about-us.html', 'about-us'), page('p2', '/menu.php', 'menu'), page('p3', '/contact.php', 'contact')]

function state(extra: Partial<AiSiteImportState> = {}): AiSiteImportState {
  return {
    domain: 'old.example.com',
    siteName: 'Old',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: '2026-11-24T00:00:00Z',
    pageLimit: null,
    existingPages: 0,
    found: PAGES.length,
    stoppedBy: null,
    groups: [],
    pages: PAGES,
    waves: [{ index: 0, label: 'Main pages', group: 'main', slots: PAGES.map((entry) => entry.slot), frame: false, status: 'review', startedAt: null, finishedAt: null }],
    leftOut: [],
    leftOutCount: {},
    frame: null,
    ...extra,
  }
}

const ITEMS = PAGES.map(
  (entry) => ({ slot: entry.slot, op: 'page', label: entry.slot, status: 'succeeded', attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [] }) as AiJobItemLedger,
)

const firestore = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ screens: { 'd-p0': '/', 'd-p1': 'about-us', 'd-p2': 'menu', 'd-p3': 'contact' } }) }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

/** A writer that answers each create by its from-path, and records what it was asked. */
function fakeWriter(answers: Record<string, PluginDraftWrite> = {}, refusal: Awaited<ReturnType<PluginResourceDraftWriter['refusal']>> = null) {
  const asked: PluginDraftRequest[] = []
  const writer: PluginResourceDraftWriter = {
    refusal: async () => refusal,
    check: (content) => {
      const source = String(content['source'] ?? '')
      return { ok: true, facts: { storedSource: source.split('?')[0]!.toLowerCase().replace(/(.)\/+$/, '$1') } }
    },
    read: async () => null,
    write: async (request) => {
      asked.push(request)
      const source = String(request.content['source'])
      return (
        answers[source] ?? {
          ok: true,
          replayed: false,
          id: request.id,
          name: request.name,
          versionId: null,
          facts: { source, destination: request.content['destination'], live: true },
        }
      )
    },
  }
  return { writer, asked }
}

function run(writer: PluginResourceDraftWriter | null, input: Partial<{ state: AiSiteImportState; on: boolean }> = {}) {
  return aiSiteImportWriteRedirects(
    firestore,
    { job: JOB, state: input.state ?? state(), items: ITEMS, org: { plan: 'starter' }, now: NOW },
    {
      writerFor: (resource) => (resource === AI_SITE_IMPORT_REDIRECT_RESOURCE ? writer : null),
      ownerFor: () => (writer ? 'aglyn-redirects' : null),
      pluginOn: async () => input.on ?? true,
    },
  )
}

describe('a closed wave’s redirects', () => {
  it('asks the redirects plugin for a permanent redirect from each moved address, under the job’s own id', async () => {
    const { writer, asked } = fakeWriter()
    const entries = await run(writer)
    expect(asked.map((request) => request.content)).toEqual([
      { action: 'create', source: '/about-us.html', destination: '/about-us', statusCode: 301, followChain: true },
      { action: 'create', source: '/menu.php', destination: '/menu', statusCode: 301, followChain: true },
      { action: 'create', source: '/contact.php', destination: '/contact', statusCode: 301, followChain: true },
    ])
    expect(asked[0]).toMatchObject({ uid: 'uid-owner', hostId: 'host-1', orgId: 'org-1', id: aiSiteImportRedirectId('job-1', '/about-us.html') })
    expect(aiSiteImportRedirectId('job-1', '/about-us.html')).toMatch(/^job-1-[0-9a-f]{16}$/)
    expect(entries).toEqual([
      { from: '/', to: '/', outcome: 'same', slot: 'p0' },
      { from: '/about-us.html', to: '/about-us', outcome: 'created', slot: 'p1', ruleId: aiSiteImportRedirectId('job-1', '/about-us.html') },
      { from: '/menu.php', to: '/menu', outcome: 'created', slot: 'p2', ruleId: aiSiteImportRedirectId('job-1', '/menu.php') },
      { from: '/contact.php', to: '/contact', outcome: 'created', slot: 'p3', ruleId: aiSiteImportRedirectId('job-1', '/contact.php') },
    ])
  })

  it('keeps the owner’s rule, reports a chain followed, and holds the rest once the plan is full', async () => {
    const { writer, asked } = fakeWriter({
      '/about-us.html': { ok: false, status: 409, error: 'A rule for /about-us.html already exists', code: 'duplicate' },
      '/menu.php': { ok: true, replayed: false, id: 'x', name: 'x', versionId: null, facts: { destination: '/food-menu' } },
      '/contact.php': { ok: false, status: 403, error: 'Your plan includes 25 redirects — upgrade in Billing for more', code: 'plan-limit' },
    })
    const entries = await run(writer)
    expect(entries?.slice(1)).toEqual([
      { from: '/about-us.html', to: null, outcome: 'kept', slot: 'p1' },
      { from: '/menu.php', to: '/food-menu', outcome: 'created', slot: 'p2', ruleId: 'x' },
      {
        from: '/contact.php',
        to: '/contact',
        outcome: 'left-out',
        reason: 'plan-limit',
        note: 'Your plan includes 25 redirects — upgrade in Billing for more',
        slot: 'p3',
      },
    ])
    expect(asked).toHaveLength(3)
  })

  it('asks nothing past a full plan', async () => {
    const full: PluginDraftWrite = { ok: false, status: 403, error: 'Your plan includes 25 redirects', code: 'plan-limit' }
    const { writer, asked } = fakeWriter({ '/about-us.html': full })
    const entries = await run(writer)
    expect(asked).toHaveLength(1)
    expect(entries?.filter((entry) => entry.reason === 'plan-limit')).toHaveLength(3)
  })

  it('reports a published page and any other refusal in the plugin’s words, and a write that throws as left out', async () => {
    const { writer } = fakeWriter({
      '/about-us.html': { ok: false, status: 409, error: '/about-us.html is a published page', code: 'live-page' },
      '/menu.php': { ok: false, status: 409, error: 'That destination leads into a redirect loop other rules already make', code: 'loop' },
    })
    const throwing: PluginResourceDraftWriter = {
      ...writer,
      write: async (request) => {
        if (request.content['source'] === '/contact.php') throw new Error('unavailable')
        return writer.write(request)
      },
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const entries = await run(throwing)
    error.mockRestore()
    expect(entries?.slice(1).map((entry) => [entry.outcome, entry.reason, entry.note ?? null])).toEqual([
      ['left-out', 'page-there', null],
      ['left-out', 'refused', 'That destination leads into a redirect loop other rules already make'],
      ['left-out', 'refused', null],
    ])
  })

  it('leaves every address out with why where redirects are off, refused, or have no writer', async () => {
    const off = await run(fakeWriter().writer, { on: false })
    expect(off?.slice(1).every((entry) => entry.outcome === 'left-out' && entry.reason === 'off')).toBe(true)
    const refused = await run(fakeWriter({}, { status: 403, error: 'URL redirects require a Starter plan — see Billing to upgrade' }).writer)
    expect(refused?.[1]).toMatchObject({ outcome: 'left-out', reason: 'off', note: 'URL redirects require a Starter plan — see Billing to upgrade' })
    const none = await run(null)
    expect(none?.slice(1).map((entry) => entry.reason)).toEqual(['off', 'off', 'off'])
  })

  it('asks nothing again for an address already settled, and nothing at all without a site', async () => {
    const { writer, asked } = fakeWriter()
    const first = await run(writer)
    asked.length = 0
    const again = await run(writer, { state: state({ redirects: first }) })
    expect(asked).toEqual([])
    expect(again).toEqual(first)
    expect(
      await aiSiteImportWriteRedirects(firestore, { job: { ...JOB, hostId: null }, state: state(), items: ITEMS, org: null, now: NOW }),
    ).toBeNull()
  })
})
