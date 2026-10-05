/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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

/**
 * `/api/health/pages` (AGL-3580): the render monitor's verdict on real pages,
 * per site, for the status page's keyword monitors. The verdict rules are
 * specified beside `renderPagesHealth`; this pins the route: it reads the
 * stored state of the sites the console watches, filters by `?site=`, and
 * answers 503 when a site is not rendering, when the state cannot be read,
 * and when a monitor asks about a site nobody renders.
 */

// No static imports, so each test loads a fresh route with a fresh memo.
export {}

const NOW = Date.UTC(2026, 9, 5, 23, 0)

let mockStates: Map<string, Record<string, unknown>> | null

jest.mock('@aglyn/tenant-data-admin/server/render-monitor', () => {
  const actual = jest.requireActual('@aglyn/tenant-data-admin/server/render-monitor')
  return {
    ...actual,
    readRenderMonitorStates: async () => mockStates,
  }
})

const ENV = {
  RENDER_MONITOR_ORIGINS: 'https://aglyn.com',
  RENDER_MONITOR_PAGES: 'ready-to-roll.aglyn.app/',
  RENDER_MONITOR_RENDER_ORIGIN: 'https://render.example.test',
  OPERATOR_HEALTH_TENANT_ORIGIN: 'https://aglyn.com',
}

function state(host: string, fields: Record<string, unknown>): [string, Record<string, unknown>] {
  return [
    `render-monitor--${host}`,
    { status: 'ok', updatedAtMs: NOW - 60_000, lastObservedAtMs: NOW - 60_000, sinceMs: NOW - 86_400_000, ...fields },
  ]
}

async function get(query = ''): Promise<{ status: number; body: any }> {
  let route: { GET: (request: Request) => Promise<Response> } | undefined
  jest.isolateModules(() => {
    route = require('../app/api/health/pages/route')
  })
  const response = await route!.GET(new Request(`https://app.example.test/api/health/pages${query}`))
  return { status: response.status, body: await response.json() }
}

describe('/api/health/pages (AGL-3580)', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] })
    Object.assign(process.env, ENV)
    mockStates = new Map([state('aglyn.com', {}), state('ready-to-roll.aglyn.app', {})])
  })

  afterEach(() => {
    jest.useRealTimers()
    process.env = { ...saved }
  })

  it('is green when every watched site rendered fresh pages', async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(Object.keys(body.checks).sort()).toEqual(['aglyn.com', 'ready-to-roll.aglyn.app'])
  })

  it('goes red when the monitor saw a site fail to render', async () => {
    mockStates = new Map([state('aglyn.com', {}), state('ready-to-roll.aglyn.app', { status: 'degraded' })])
    const all = await get()
    expect(all.status).toBe(503)
    expect(all.body.status).toBe('degraded')
    expect(all.body.checks['ready-to-roll.aglyn.app']).toMatchObject({ ok: false, code: 'not-rendering' })

    // One site's monitor stays green while another site is down.
    const marketing = await get('?site=aglyn.com')
    expect(marketing.status).toBe(200)
    expect(Object.keys(marketing.body.checks)).toEqual(['aglyn.com'])
  })

  it('stays green, and says why, while bot protection blinds the monitor', async () => {
    mockStates = new Map([state('aglyn.com', { consecutiveBlindRuns: 36, blindSinceMs: NOW - 3 * 3_600_000 })])
    const { status, body } = await get('?site=aglyn.com')
    expect(status).toBe(200)
    expect(body.checks['aglyn.com']).toMatchObject({ ok: true, code: 'monitor-blind' })
  })

  it('goes red for a site the monitor does not render, so a monitor cannot point at nothing', async () => {
    const { status, body } = await get('?site=nobody.aglyn.app')
    expect(status).toBe(503)
    expect(body.checks['nobody.aglyn.app']).toMatchObject({ ok: false, code: 'not-watched' })
  })

  it('goes red when the stored verdicts cannot be read', async () => {
    mockStates = null
    const { status, body } = await get('?site=aglyn.com')
    expect(status).toBe(503)
    expect(body.checks['aglyn.com']).toMatchObject({ ok: false, code: 'state-unavailable' })
  })

  it('answers HEAD with the same status as GET', async () => {
    mockStates = new Map([state('aglyn.com', { status: 'degraded' })])
    let route: { HEAD: (request: Request) => Promise<Response> } | undefined
    jest.isolateModules(() => {
      route = require('../app/api/health/pages/route')
    })
    const head = await route!.HEAD(new Request('https://app.example.test/api/health/pages?site=aglyn.com'))
    expect(head.status).toBe(503)
    expect(await head.text()).toBe('')
  })
})
