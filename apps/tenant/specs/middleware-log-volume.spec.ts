/**
 * @jest-environment node
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

/**
 * What the tenant writes to its log on an ordinary request (AGL-4121).
 *
 * Every line that carries no status code reaches the log drain, and every
 * delivery is billed. So: the middleware's host-switch trace only when it is
 * switched on, one heartbeat per isolate per five minutes so the receiver's
 * one-hour silence watcher stays accurate, and the render timing line only
 * for cold or slow renders.
 */

import {
  __resetMiddlewareHeartbeat,
  MIDDLEWARE_HEARTBEAT_INTERVAL_MS,
  middlewareDebug,
  middlewareHeartbeat,
} from '../utils/middleware-log'
import {
  RENDER_REPORT_SLOW_MS,
  shouldReportRender,
  startRenderTimer,
} from '../utils/render-timings'

const ORIGINAL = process.env['AGLYN_DEBUG_MIDDLEWARE']

afterEach(() => {
  jest.restoreAllMocks()
  if (ORIGINAL === undefined) delete process.env['AGLYN_DEBUG_MIDDLEWARE']
  else process.env['AGLYN_DEBUG_MIDDLEWARE'] = ORIGINAL
})

describe('the middleware trace is off unless switched on', () => {
  it('writes nothing by default', () => {
    delete process.env['AGLYN_DEBUG_MIDDLEWARE']
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
    middlewareDebug('Tenant Host Switch=', 'cname')
    expect(debug).not.toHaveBeenCalled()
  })

  it('writes the trace with AGLYN_DEBUG_MIDDLEWARE=1', () => {
    process.env['AGLYN_DEBUG_MIDDLEWARE'] = '1'
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
    middlewareDebug('Tenant Host Switch=', 'cname')
    expect(debug).toHaveBeenCalledWith('Tenant Host Switch=', 'cname')
  })
})

describe('the drain heartbeat keeps the silence watcher fed', () => {
  beforeEach(() => __resetMiddlewareHeartbeat())

  it('writes once, then not again inside the interval, then again after it', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const t0 = 1_000_000
    expect(middlewareHeartbeat(t0)).toBe(true)
    expect(middlewareHeartbeat(t0 + 1)).toBe(false)
    expect(middlewareHeartbeat(t0 + MIDDLEWARE_HEARTBEAT_INTERVAL_MS - 1)).toBe(false)
    expect(middlewareHeartbeat(t0 + MIDDLEWARE_HEARTBEAT_INTERVAL_MS)).toBe(true)
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('beats well inside the watcher’s one-hour absence window', () => {
    expect(MIDDLEWARE_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(10 * 60_000)
  })

  it('beats whether or not the trace is on', () => {
    delete process.env['AGLYN_DEBUG_MIDDLEWARE']
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    middlewareHeartbeat(5)
    expect(info).toHaveBeenCalledWith(JSON.stringify({ tag: 'tenant-middleware:heartbeat' }))
  })
})

describe('the render timing line: every cold render, and slow warm ones', () => {
  it('decides by cold and by duration', () => {
    expect(shouldReportRender(true, 10)).toBe(true)
    expect(shouldReportRender(false, RENDER_REPORT_SLOW_MS)).toBe(true)
    expect(shouldReportRender(false, RENDER_REPORT_SLOW_MS - 1)).toBe(false)
  })

  it('reports the first (cold) render and skips a fast warm one', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    startRenderTimer().report({ path: '/' })
    startRenderTimer().report({ path: '/' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      tag: 'AGL-1152:render',
      cold: true,
      path: '/',
    })
  })
})
