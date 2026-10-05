/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import {
  RENDER_PROBE_ISR_PREFIX,
  gradeRenderProbe,
  PLATFORM_CONSOLE_VERCEL_PROJECT_ID,
  PLATFORM_RENDER_ORIGIN,
  freshHostSpelling,
  nextRenderMonitorState,
  pageProbeUrl,
  parseRenderMonitorPages,
  renderMonitorCheckId,
  renderSpellingNumber,
  resolveRenderMonitorPages,
  resolveRenderMonitorTargets,
  runRenderMonitor,
  type RenderMonitorStateDoc,
  type RenderMonitorStore,
} from './render-monitor'

/** A complete document our build produced. */
const PAGE =
  '<!DOCTYPE html><html><head><script src="/_next/static/chunks/main.js"></script></head><body>x</body></html>'

describe('gradeRenderProbe (AGL-3568)', () => {
  const html = 'text/html; charset=utf-8'

  it('passes a complete, freshly rendered document at the expected status', () => {
    expect(gradeRenderProbe({ status: 200, contentType: html, body: PAGE, cacheState: 'MISS' }, 200).ok).toBe(true)
    // A 404 is the pass for the never-requested path: the site's not-found
    // page, drawn inside the same layout.
    expect(gradeRenderProbe({ status: 404, contentType: html, body: PAGE, cacheState: 'MISS' }, 404).ok).toBe(true)
    // No cache header at all (a plain `next start`) cannot be read as cached.
    expect(gradeRenderProbe({ status: 200, contentType: html, body: PAGE }, 200).ok).toBe(true)
  })

  it.each([
    ['the platform timed out', { status: 504, contentType: 'text/plain', body: 'An error occurred' }, 'http-504'],
    ['the render threw', { status: 500, contentType: html, body: PAGE }, 'http-500'],
    ['the status is not the one a render answers', { status: 200, contentType: html, body: PAGE }, 'http-200'],
    ['it redirected', { status: 307, location: '/elsewhere' }, 'redirected'],
    ['it is not HTML', { status: 404, contentType: 'application/json', body: '{}' }, 'not-html'],
    ['the document never finished', { status: 404, contentType: html, body: PAGE.replace('</html>', '') }, 'incomplete'],
    ['our build did not produce it', { status: 404, contentType: html, body: '<html><body>parked</body></html>' }, 'not-our-render'],
    ['a cache answered', { status: 404, contentType: html, body: PAGE, cacheState: 'hit' }, 'served-from-cache'],
  ])('is red when %s', (_label, response, code) => {
    const verdict = gradeRenderProbe(response, 404)
    expect(verdict).toMatchObject({ ok: false, code })
  })

  it('names a bot-protection challenge as its own red, whatever the status', () => {
    const verdict = gradeRenderProbe(
      { status: 200, contentType: html, body: '<title>Vercel Security Checkpoint</title>' },
      200,
    )
    expect(verdict).toMatchObject({ ok: false, challenged: true, code: 'challenged' })
  })
})

describe('resolveRenderMonitorTargets (AGL-3568)', () => {
  it('watches the demonstration site under the configured apex by default', () => {
    expect(resolveRenderMonitorTargets({ NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test' })).toEqual([
      'https://demo.sites.example.test',
    ])
    expect(
      resolveRenderMonitorTargets({ NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test', AGLYN_TENANT_DEMO: 'showcase' }),
    ).toEqual(['https://showcase.sites.example.test'])
  })

  it('prefers the site the operator alerts tick already watches', () => {
    expect(
      resolveRenderMonitorTargets({
        NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test',
        OPERATOR_HEALTH_TENANT_ORIGIN: 'https://Watched.Example.test/',
      }),
    ).toEqual(['https://watched.example.test'])
  })

  it('adds the configured list, deduped, and drops what is not an origin', () => {
    expect(
      resolveRenderMonitorTargets({
        NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test',
        RENDER_MONITOR_ORIGINS:
          'https://www.example.test, https://demo.sites.example.test https://x.test/path not-a-url',
      }),
    ).toEqual(['https://demo.sites.example.test', 'https://www.example.test'])
  })

  it('watches nothing when switched off', () => {
    expect(resolveRenderMonitorTargets({ RENDER_MONITOR_ORIGINS: 'off' })).toEqual([])
  })
})

describe('nextRenderMonitorState (AGL-3568)', () => {
  const origin = 'https://demo.example.test'
  const context = (now: number) => ({ origin, label: 'Page rendering on demo.example.test', threshold: 2, now })
  const fail = { ok: false, detail: 'isr: HTTP 504' }
  const pass = { ok: true, detail: 'Fresh renders pass.' }

  it('says nothing on one failure, and alerts on the second in a row', () => {
    const first = nextRenderMonitorState(null, fail, context(1_000))
    expect(first.transition).toBeNull()
    expect(first.next).toMatchObject({ status: 'ok', consecutiveFailures: 1, failingSinceMs: 1_000 })
    const second = nextRenderMonitorState(first.next, fail, context(301_000))
    expect(second.transition).toBe('failing')
    // Degraded since the FIRST failure, which is when visitors started
    // getting errors.
    expect(second.next).toMatchObject({ status: 'degraded', consecutiveFailures: 2, sinceMs: 1_000 })
    expect(second.next.checkId).toBe(renderMonitorCheckId(origin))
  })

  it('is told once per outage, however long it lasts', () => {
    let state: RenderMonitorStateDoc | null = null
    const transitions: unknown[] = []
    for (let run = 0; run < 6; run += 1) {
      const decided = nextRenderMonitorState(state, fail, context(run * 300_000))
      transitions.push(decided.transition)
      state = decided.next
    }
    expect(transitions.filter(Boolean)).toEqual(['failing'])
    expect(state?.sinceMs).toBe(0)
  })

  it('a pass between failures resets the count', () => {
    const first = nextRenderMonitorState(null, fail, context(0))
    const ok = nextRenderMonitorState(first.next, pass, context(300_000))
    expect(ok.transition).toBeNull()
    const again = nextRenderMonitorState(ok.next, fail, context(600_000))
    expect(again.transition).toBeNull()
    expect(again.next.consecutiveFailures).toBe(1)
  })

  it('recovers on the first passing run after the alert', () => {
    const first = nextRenderMonitorState(null, fail, context(0))
    const down = nextRenderMonitorState(first.next, fail, context(300_000))
    const up = nextRenderMonitorState(down.next, pass, context(900_000))
    expect(up.transition).toBe('recovered')
    expect(up.next).toMatchObject({ status: 'ok', consecutiveFailures: 0, failingSinceMs: null, sinceMs: 900_000 })
  })
})

describe('runRenderMonitor (AGL-3568)', () => {
  const env = { NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test', RENDER_MONITOR_FAILURE_THRESHOLD: '2' }

  function memoryStore(): { store: RenderMonitorStore; docs: Map<string, RenderMonitorStateDoc> } {
    const docs = new Map<string, RenderMonitorStateDoc>()
    const store: RenderMonitorStore = async (checkId, work) => {
      const { next, result } = work(docs.get(checkId) ?? null)
      docs.set(checkId, next)
      return result
    }
    return { store, docs }
  }

  /** A site whose fresh renders answer as `status` decides. */
  function site(answer: (url: string) => { status: number; body: string } | 'hang') {
    const requested: Array<{ url: string; headers: Record<string, string> }> = []
    const fetcher = (async (url: string, init: RequestInit) => {
      requested.push({ url, headers: init.headers as Record<string, string> })
      const reply = answer(url)
      if (reply === 'hang') {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      return new Response(reply.body, {
        status: reply.status,
        headers: { 'content-type': 'text/html', 'x-vercel-cache': 'MISS' },
      })
    }) as unknown as typeof fetch
    return { fetcher, requested }
  }

  const healthy = site((url) => ({ status: url.endsWith('/search') ? 200 : 404, body: PAGE }))

  it('asks for /search and a never-requested path, with our edge headers', async () => {
    const { store } = memoryStore()
    const report = await runRenderMonitor({
      env,
      store,
      fetcher: healthy.fetcher,
      headers: { 'x-aglyn-probe': 'token' },
      nonce: () => 'n1',
      raise: async () => undefined,
    })
    expect(report.sites).toHaveLength(1)
    expect(report.sites[0]).toMatchObject({ origin: 'https://demo.sites.example.test', ok: true, status: 'ok' })
    expect(healthy.requested.map((r) => r.url).sort()).toEqual([
      `https://demo.sites.example.test${RENDER_PROBE_ISR_PREFIX}n1`,
      'https://demo.sites.example.test/search',
    ])
    expect(healthy.requested[0].headers['x-aglyn-probe']).toBe('token')
  })

  it('alerts once after two failing runs, then once on recovery', async () => {
    const { store } = memoryStore()
    const raised: Array<{ type: string; context: Record<string, unknown> }> = []
    const raise = async (type: string, options: { context?: Record<string, unknown> }) => {
      raised.push({ type, context: options.context ?? {} })
    }
    let now = 0
    const hung = site(() => 'hang')
    const run = (fetcher: typeof fetch) =>
      runRenderMonitor({ env, store, fetcher, raise, timeoutMs: 20, now: () => now })

    expect((await run(hung.fetcher)).sites[0]).toMatchObject({ ok: false, status: 'ok', consecutiveFailures: 1 })
    expect(raised).toEqual([])
    now = 300_000
    const second = await run(hung.fetcher)
    expect(second.sites[0]).toMatchObject({ status: 'degraded', transition: 'failing' })
    expect(second.sites[0].probes.every((probe) => probe.code === 'timeout')).toBe(true)
    now = 600_000
    await run(hung.fetcher)
    expect(raised.map((r) => r.type)).toEqual(['system.siteRenderFailing'])
    expect(raised[0].context).toMatchObject({ site: 'demo.sites.example.test', failures: 2 })
    expect(String(raised[0].context['detail'])).toContain('no complete page')

    now = 1_200_000
    const back = await run(healthy.fetcher)
    expect(back.sites[0]).toMatchObject({ ok: true, status: 'ok', transition: 'recovered' })
    expect(raised.map((r) => r.type)).toEqual(['system.siteRenderFailing', 'system.siteRenderRecovered'])
    expect(raised[1].context).toMatchObject({ site: 'demo.sites.example.test', duration: '20 min' })
  })

  it('a dry run fetches and grades and records nothing', async () => {
    const { store, docs } = memoryStore()
    const raise = jest.fn()
    const report = await runRenderMonitor({
      env,
      store,
      raise,
      dryRun: true,
      fetcher: site(() => ({ status: 504, body: '' })).fetcher,
    })
    expect(report.dryRun).toBe(true)
    expect(report.sites[0].ok).toBe(false)
    expect(report.sites[0].status).toBeUndefined()
    expect(docs.size).toBe(0)
    expect(raise).not.toHaveBeenCalled()
  })

  it('reports a store that cannot be written rather than throwing', async () => {
    const report = await runRenderMonitor({
      env,
      fetcher: healthy.fetcher,
      store: async () => {
        throw new Error('firestore down')
      },
      raise: async () => undefined,
    })
    expect(report.sites[0].error).toBe('firestore down')
  })
})

describe('real pages, rendered fresh (AGL-3571)', () => {
  it('spells a site so no cache holds it — the literals the canary and the tenant resolver spec pin', () => {
    expect(freshHostSpelling('ready-to-roll.aglyn.app', 0, 'aglyn.app')).toBe('ready-to-roll.aglyn.app')
    expect(freshHostSpelling('ready-to-roll.aglyn.app', 5, 'aglyn.app')).toBe('ReAdy-to-roll.aglyn.app')
    expect(freshHostSpelling('ready-to-roll.aglyn.app', 2 ** 19 + 1, 'aglyn.app')).toBe('Ready-to-roll.aglyn.app.')
    expect(freshHostSpelling('aglyn.com', 3, 'aglyn.app')).toBe('cname--AGlyn.com')
    expect(freshHostSpelling('aglyn.com', 256 + 3, 'aglyn.app')).toBe('cname--AGlyn.com')
  })

  it('numbers a run by the minute, so a run never reuses an earlier spelling', () => {
    const at = Date.UTC(2026, 9, 5, 18, 33)
    expect(renderSpellingNumber(at + 300_000)).toBe(renderSpellingNumber(at) + 5)
    expect(renderSpellingNumber(0)).toBe(1)
  })

  it('reads the page list like the canary does, dropping what is not a host', () => {
    expect(parseRenderMonitorPages('a.example.app, https://b.example.app/services b.example.app/contact/ nope!')).toEqual([
      { origin: 'https://a.example.app', host: 'a.example.app', paths: ['/'] },
      { origin: 'https://b.example.app', host: 'b.example.app', paths: ['/services', '/contact'] },
    ])
  })

  it("renders Aglyn's client pages on Aglyn's own console only", () => {
    const platform = resolveRenderMonitorPages({ VERCEL_PROJECT_ID: PLATFORM_CONSOLE_VERCEL_PROJECT_ID })
    expect(platform.renderOrigin).toBe(PLATFORM_RENDER_ORIGIN)
    expect(platform.pages.map((page) => [page.host, page.paths])).toEqual([
      ['ready-to-roll.aglyn.app', ['/']],
      ['edr-construction.aglyn.app', ['/', '/services', '/contact']],
    ])
    // Any other install — another Vercel project or none — renders none of them.
    expect(resolveRenderMonitorPages({ VERCEL_PROJECT_ID: 'prj_someone_else' }).pages).toEqual([])
    expect(resolveRenderMonitorPages({}).pages).toEqual([])
    // An operator's own list needs their own render origin.
    expect(resolveRenderMonitorPages({ RENDER_MONITOR_PAGES: 'shop.example.app' }).pages).toEqual([])
    expect(
      resolveRenderMonitorPages({
        RENDER_MONITOR_PAGES: 'shop.example.app/cart',
        RENDER_MONITOR_RENDER_ORIGIN: 'https://tenant-x.vercel.app',
      }),
    ).toEqual({
      renderOrigin: 'https://tenant-x.vercel.app',
      pages: [{ origin: 'https://shop.example.app', host: 'shop.example.app', paths: ['/cart'] }],
    })
    expect(
      resolveRenderMonitorPages({ VERCEL_PROJECT_ID: PLATFORM_CONSOLE_VERCEL_PROJECT_ID, RENDER_MONITOR_ORIGINS: 'off' }).pages,
    ).toEqual([])
    // A site whose pages are rendered is watched whole.
    expect(
      resolveRenderMonitorTargets({ VERCEL_PROJECT_ID: PLATFORM_CONSOLE_VERCEL_PROJECT_ID, NEXT_PUBLIC_TENANT_DOMAIN: 'aglyn.app' }),
    ).toEqual(['https://demo.aglyn.app', 'https://ready-to-roll.aglyn.app', 'https://edr-construction.aglyn.app'])
  })

  it("rotates through a site's pages, one per five-minute slot", () => {
    const site = { origin: 'https://edr-construction.aglyn.app', host: 'edr-construction.aglyn.app', paths: ['/', '/services', '/contact'] }
    const paths = [0, 1, 2, 3].map((slot) => new URL(pageProbeUrl(PLATFORM_RENDER_ORIGIN, site, slot, 7)).pathname)
    expect(paths).toEqual(['/', '/services', '/contact', '/'])
    const url = new URL(pageProbeUrl(PLATFORM_RENDER_ORIGIN, site, 1, 7))
    expect(url.origin).toBe(PLATFORM_RENDER_ORIGIN)
    expect(url.searchParams.get('tenantHost')).toBe(freshHostSpelling('edr-construction.aglyn.app', 7))
  })

  const env = {
    NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.test',
    RENDER_MONITOR_PAGES: 'shop.sites.example.test/cart',
    RENDER_MONITOR_RENDER_ORIGIN: 'https://tenant-x.vercel.app',
  }
  const store: RenderMonitorStore = async (_checkId, work) => work(null).result

  function fetcherFor(page: 'ok' | 'hang') {
    const requested: Array<{ url: string; headers: Record<string, string> }> = []
    const fetcher = (async (url: string, init: RequestInit) => {
      requested.push({ url, headers: init.headers as Record<string, string> })
      if (url.startsWith('https://tenant-x.vercel.app') && page === 'hang') {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      }
      const status = url.endsWith('/search') || url.startsWith('https://tenant-x.vercel.app') ? 200 : 404
      return new Response(PAGE, { status, headers: { 'content-type': 'text/html', 'x-vercel-cache': 'MISS' } })
    }) as unknown as typeof fetch
    return { fetcher, requested }
  }

  it('renders the real page through the render origin with the bypass, and fails the site when it hangs', async () => {
    const healthy = fetcherFor('ok')
    const report = await runRenderMonitor({
      env,
      store,
      fetcher: healthy.fetcher,
      headers: { 'x-vercel-protection-bypass': 'b' },
      raise: async () => undefined,
      now: () => Date.UTC(2026, 9, 5, 18, 35),
    })
    const shop = report.sites.find((site) => site.origin === 'https://shop.sites.example.test')
    expect(shop?.ok).toBe(true)
    const page = shop?.probes.find((probe) => probe.kind === 'page')
    expect(page?.url).toMatch(/^https:\/\/tenant-x\.vercel\.app\/cart\?tenantHost=/)
    expect(healthy.requested.find((r) => r.url === page?.url)?.headers['x-vercel-protection-bypass']).toBe('b')

    // The beta.223 shape: layout probes pass, the page body hangs.
    const hung = await runRenderMonitor({
      env,
      store,
      fetcher: fetcherFor('hang').fetcher,
      headers: { 'x-vercel-protection-bypass': 'b' },
      raise: async () => undefined,
      timeoutMs: 20,
    })
    const broken = hung.sites.find((site) => site.origin === 'https://shop.sites.example.test')
    expect(broken?.ok).toBe(false)
    expect(broken?.probes.filter((probe) => !probe.ok).map((probe) => [probe.kind, probe.code])).toEqual([['page', 'timeout']])
  })

  it('makes no page probe without the bypass, which could only be refused', async () => {
    const { fetcher, requested } = fetcherFor('ok')
    const report = await runRenderMonitor({ env, store, fetcher, raise: async () => undefined })
    expect(report.sites.flatMap((site) => site.probes).some((probe) => probe.kind === 'page')).toBe(false)
    expect(requested.some((r) => r.url.startsWith('https://tenant-x.vercel.app'))).toBe(false)
  })
})
