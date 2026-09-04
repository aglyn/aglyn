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

import * as Aglyn from '@aglyn/aglyn'
import { render, waitFor } from '@testing-library/react'
import type { ClientAutomation } from '../model/site-contract'
import { MarketingSiteRuntime } from './site-runtime'

/**
 * Triggers that resolve their target by querying the DOM (AGL-2512).
 *
 * `elementVisible` and `scrollToElement` are the only two; every other trigger
 * listens on `document` and so never cares when the element shows up. These
 * queried once, at bind time, which made them dead on the two pages whose tree
 * lands after the runtime mounts: a deferred lazy panel patched back in on
 * interaction (AGL-1285), and a gated screen's tree swapped in once the
 * visitor is past the gate (AGL-2510).
 *
 * jsdom has no IntersectionObserver, so the double below is the only way to
 * observe what the runtime observed — which is exactly the assertion: not
 * "did it fire", but "did it ever start watching the element at all".
 */

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS

interface FakeObserver {
  observed: Element[]
  disconnected: boolean
  trigger: () => void
}
let observers: FakeObserver[] = []

beforeAll(() => {
  class FakeIntersectionObserver {
    private callback: (entries: Array<{ isIntersecting: boolean }>) => void
    private record: FakeObserver
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.callback = callback
      this.record = {
        observed: [],
        disconnected: false,
        trigger: () => this.callback([{ isIntersecting: true }]),
      }
      observers.push(this.record)
    }
    observe(element: Element) {
      // The real one ignores a repeat observe of the same element; the rescan
      // relies on that, so the double has to behave the same way or the test
      // would pass on a runtime that re-observes without bound.
      if (!this.record.observed.includes(element)) {
        this.record.observed.push(element)
      }
    }
    unobserve() {
      /* not used */
    }
    disconnect() {
      this.record.disconnected = true
    }
  }
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    FakeIntersectionObserver
})

let unmounts: Array<() => void> = []

const runEngine = (automations: Array<Partial<ClientAutomation>>) => {
  const utils = render(
    <MarketingSiteRuntime
      hostId="host-1"
      screens={{}}
      page={{
        announcementBar: null,
        popup: null,
        experiments: [],
        automationOverlays: null,
        clientAutomations: automations.map((automation, index) => ({
          id: `auto-${index}`,
          hasServerSteps: false,
          steps: [],
          event: 'pageVisit',
          ...automation,
        })),
      }}
    />,
  )
  unmounts.push(utils.unmount)
  return utils
}

const revealLater = (selector: string) => ({
  event: 'elementVisible' as const,
  selector,
  steps: [{ type: 'showElement', selector: '#reveal' }] as never,
})

beforeEach(() => {
  observers = []
  document.body.innerHTML = `<div id="reveal" class="${HIDDEN}"></div>`
})

afterEach(() => {
  for (const unmount of unmounts) unmount()
  unmounts = []
})

describe('element triggers and a tree that arrives late (AGL-2512)', () => {
  it('watches an element inserted after the engine bound', async () => {
    runEngine([revealLater('#panel-content')])
    expect(observers[0]?.observed).toHaveLength(0)

    const late = document.createElement('div')
    late.id = 'panel-content'
    document.body.appendChild(late)

    await waitFor(() => expect(observers[0]?.observed).toEqual([late]))
  })

  it('runs the automation’s steps when that late element comes into view', async () => {
    runEngine([revealLater('#panel-content')])
    const late = document.createElement('div')
    late.id = 'panel-content'
    document.body.appendChild(late)
    await waitFor(() => expect(observers[0]?.observed).toHaveLength(1))

    observers[0].trigger()

    expect(
      document.getElementById('reveal')?.classList.contains(HIDDEN),
    ).toBe(false)
  })

  it('still binds an element that was there all along', async () => {
    const early = document.createElement('div')
    early.id = 'panel-content'
    document.body.appendChild(early)

    runEngine([revealLater('#panel-content')])

    expect(observers[0]?.observed).toEqual([early])
  })

  it('stops watching the document once the trigger has fired', async () => {
    runEngine([revealLater('#panel-content')])
    const late = document.createElement('div')
    late.id = 'panel-content'
    document.body.appendChild(late)
    await waitFor(() => expect(observers[0]?.observed).toHaveLength(1))

    observers[0].trigger()
    expect(observers[0].disconnected).toBe(true)

    // A second element matching the same selector after the fire must not be
    // picked up: these triggers fire once per pageview, and a page that keeps
    // rescanning for the rest of the visit is the cost this guard bounds.
    const another = document.createElement('div')
    // The SAME selector, so this is a real refusal rather than a miss.
    another.id = 'panel-content'
    document.body.appendChild(another)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(observers[0].observed).toHaveLength(1)
  })
})
