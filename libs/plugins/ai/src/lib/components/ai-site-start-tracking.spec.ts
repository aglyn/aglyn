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
 * The guided start's struggle detector (AGL-3898), on fake timers: rage
 * clicks, dead clicks, the same answer changed again and again, an idle step,
 * and an abandonment reported once.
 */

import {
  AI_SITE_START_DEAD_CLICKS_PER_STEP,
  AI_SITE_START_IDLE_MS,
  aiSiteStartClickOf,
  createAiSiteStartTracker,
} from './ai-site-start-tracking'

let sent: Array<[string, Record<string, unknown>]>
let clock: number
let hidden: boolean

const tracker = () =>
  createAiSiteStartTracker({
    send: (name, params) => sent.push([name, params as Record<string, unknown>]),
    now: () => clock,
    hidden: () => hidden,
  })
const named = (name: string) => sent.filter(([event]) => event === name).map(([, params]) => params)
const click = (x: number, y: number, interactive = true, area = 'style-cards') => ({ x, y, interactive, area })

beforeEach(() => {
  jest.useFakeTimers()
  sent = []
  clock = 1_000
  hidden = false
})

afterEach(() => {
  jest.useRealTimers()
})

describe('steps, as a funnel', () => {
  it('reports a step drawn, and the time spent on it when it is left forward or back', () => {
    const t = tracker()
    t.view('kind')
    clock += 4_200
    t.complete()
    t.view('audience')
    clock += 1_000
    t.back()
    expect(sent).toEqual([
      ['site_start_step_viewed', { step: 'kind', step_index: 1, step_count: 6 }],
      ['site_start_step_completed', { step: 'kind', step_index: 1, duration_ms: 4_200 }],
      ['site_start_step_viewed', { step: 'audience', step_index: 2, step_count: 6 }],
      ['site_start_step_back', { step: 'audience', step_index: 2, duration_ms: 1_000 }],
    ])
  })

  it('reports an abandonment once, with the step it was on and the time since it opened', () => {
    const t = tracker()
    t.view('choose')
    clock += 2_000
    t.view('style')
    clock += 3_000
    t.abandon('close')
    t.abandon('route')
    expect(named('site_start_abandoned')).toEqual([{ step: 'style', step_index: 3, reason: 'close', duration_ms: 3_000, total_ms: 5_000 }])
  })

  it('reports nothing after the start is finished, abandonment least of all', () => {
    const t = tracker()
    t.view('review')
    t.finish()
    t.abandon('route')
    t.click(click(1, 1, false))
    jest.advanceTimersByTime(AI_SITE_START_IDLE_MS * 2)
    expect(named('site_start_abandoned')).toEqual([])
    expect(sent.map(([name]) => name)).toEqual(['site_start_step_viewed'])
  })

  it('reports a refused field by its id and a closed code', () => {
    const t = tracker()
    t.view('kind')
    t.fieldError('siteType', 'required')
    expect(named('site_start_field_error')).toEqual([{ step: 'kind', field: 'siteType', error: 'required' }])
  })
})

describe('rage clicks', () => {
  it('reports three clicks within 700 ms and 30 px as one rage click', () => {
    const t = tracker()
    t.view('style')
    t.click(click(100, 100))
    clock += 200
    t.click(click(110, 105))
    clock += 200
    t.click(click(95, 120))
    clock += 100
    t.click(click(100, 100))
    expect(named('site_start_rage_click')).toEqual([{ step: 'style', area: 'style-cards', clicks: 3 }])
  })

  it('does not count clicks that are too slow', () => {
    const t = tracker()
    t.view('style')
    for (let index = 0; index < 4; index += 1) {
      t.click(click(100, 100))
      clock += 701
    }
    expect(named('site_start_rage_click')).toEqual([])
  })

  it('does not count clicks that are too far apart', () => {
    const t = tracker()
    t.view('style')
    t.click(click(100, 100))
    clock += 100
    t.click(click(140, 100))
    clock += 100
    t.click(click(180, 100))
    expect(named('site_start_rage_click')).toEqual([])
  })

  it('reports a second burst on its own', () => {
    const t = tracker()
    t.view('details')
    for (const x of [10, 12, 14]) {
      t.click(click(x, 10, true, 'footer'))
      clock += 100
    }
    clock += 2_000
    for (const x of [300, 301, 302]) {
      t.click(click(x, 10, true, 'footer'))
      clock += 100
    }
    expect(named('site_start_rage_click')).toHaveLength(2)
  })
})

describe('dead clicks', () => {
  it('reports a click on a part of the form that does nothing, by its area', () => {
    const t = tracker()
    t.view('style')
    t.click(click(5, 5, false, 'heading'))
    t.click(click(500, 500, true))
    expect(named('site_start_dead_click')).toEqual([{ step: 'style', area: 'heading' }])
  })

  it('reports at most three on one visit to a step, and counts again on the next', () => {
    const t = tracker()
    t.view('style')
    for (let index = 0; index < 6; index += 1) {
      t.click(click(index * 100, 0, false, 'form'))
      clock += 1_000
    }
    expect(named('site_start_dead_click')).toHaveLength(AI_SITE_START_DEAD_CLICKS_PER_STEP)
    t.view('details')
    t.click(click(0, 0, false, 'form'))
    expect(named('site_start_dead_click')).toHaveLength(AI_SITE_START_DEAD_CLICKS_PER_STEP + 1)
  })

  it('reads a click on a button, a field or a card as interactive, and on text as dead', () => {
    document.body.innerHTML = `
      <div data-start-area="heading"><h1 id="title">Choose a style</h1></div>
      <div data-start-area="style-cards"><button id="card"><span id="inner">Portfolio</span></button></div>
      <div data-start-area="field-siteType"><div class="MuiInputBase-root" id="base"><input id="input" /></div></div>
      <p id="loose">Words</p>`
    const at = (id: string) => aiSiteStartClickOf({ clientX: 1, clientY: 2, target: document.getElementById(id) })
    expect(at('title')).toEqual({ x: 1, y: 2, interactive: false, area: 'heading' })
    expect(at('inner')).toEqual({ x: 1, y: 2, interactive: true, area: 'style-cards' })
    expect(at('base')).toEqual({ x: 1, y: 2, interactive: true, area: 'field-siteType' })
    expect(at('input').interactive).toBe(true)
    expect(at('loose')).toEqual({ x: 1, y: 2, interactive: false, area: 'form' })
    document.body.innerHTML = ''
  })
})

describe('struggle', () => {
  it('reports one answer changed three times, once, by its field', () => {
    const t = tracker()
    t.view('kind')
    for (let index = 0; index < 2; index += 1) {
      t.fieldChanged('siteType')
      t.fieldChanged('siteType')
      t.fieldLeft('siteType')
    }
    expect(named('site_start_struggle')).toEqual([])
    t.fieldChanged('siteType')
    t.fieldLeft('siteType')
    t.fieldPicked('siteType')
    expect(named('site_start_struggle')).toEqual([{ step: 'kind', signal: 'edits', field: 'siteType', count: 3 }])
  })

  it('counts leaving a field it did not change as no edit', () => {
    const t = tracker()
    t.view('audience')
    for (let index = 0; index < 5; index += 1) t.fieldLeft('audience')
    expect(named('site_start_struggle')).toEqual([])
  })

  it('counts each pick of a choice as an edit', () => {
    const t = tracker()
    t.view('style')
    t.fieldPicked('kind')
    t.fieldPicked('kind')
    t.fieldPicked('kind')
    expect(named('site_start_struggle')).toEqual([{ step: 'style', signal: 'edits', field: 'kind', count: 3 }])
  })

  it('reports a step left idle for 30 seconds, once a visit', () => {
    const t = tracker()
    t.view('style')
    jest.advanceTimersByTime(AI_SITE_START_IDLE_MS - 1)
    expect(named('site_start_struggle')).toEqual([])
    jest.advanceTimersByTime(1)
    expect(named('site_start_struggle')).toEqual([{ step: 'style', signal: 'idle', duration_ms: AI_SITE_START_IDLE_MS }])
    jest.advanceTimersByTime(AI_SITE_START_IDLE_MS * 3)
    expect(named('site_start_struggle')).toHaveLength(1)
  })

  it('puts off the idle signal on any input', () => {
    const t = tracker()
    t.view('kind')
    jest.advanceTimersByTime(20_000)
    t.activity()
    jest.advanceTimersByTime(20_000)
    t.click(click(1, 1))
    jest.advanceTimersByTime(20_000)
    expect(named('site_start_struggle')).toEqual([])
    jest.advanceTimersByTime(10_000)
    expect(named('site_start_struggle')).toHaveLength(1)
  })

  it('does not call a hidden tab idle', () => {
    hidden = true
    const t = tracker()
    t.view('kind')
    jest.advanceTimersByTime(AI_SITE_START_IDLE_MS)
    expect(named('site_start_struggle')).toEqual([])
  })

  it('stops watching for idle once the start is abandoned', () => {
    const t = tracker()
    t.view('kind')
    t.abandon('skip')
    jest.advanceTimersByTime(AI_SITE_START_IDLE_MS)
    expect(named('site_start_struggle')).toEqual([])
  })
})

describe('the default sender', () => {
  it('goes through trackEvent, the console taxonomy’s one consent-gated door', () => {
    jest.isolateModules(() => {
      const track = jest.fn()
      jest.doMock('@aglyn/aglyn/app-utils/analytics-events', () => ({ trackEvent: track }))
      const { createAiSiteStartTracker: create } = require('./ai-site-start-tracking') as typeof import('./ai-site-start-tracking')
      create({ now: () => 0 }).view('kind')
      expect(track).toHaveBeenCalledWith('site_start_step_viewed', { step: 'kind', step_index: 1, step_count: 6 })
    })
  })
})
