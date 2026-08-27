/**
 * @jest-environment jsdom
 */
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

import {
  ATTRIBUTION_ATTRIBUTE,
  inspectAttributionElement,
  installAttributionGuard,
  resetAttributionGuard,
} from './attribution-guard'

/**
 * The suppression the guard exists for is CSS, so the checks are asserted
 * against computed style. jsdom computes `display`, `visibility`, `opacity`
 * and `pointer-events` from inline styles faithfully; it does not lay out, so
 * geometry and hit-testing are stubbed per case rather than pretended.
 */
const withRect = (element: HTMLElement, rect: Partial<DOMRect>): void => {
  element.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
      x: 10,
      y: 10,
      ...rect,
    }) as DOMRect
}

const makeBadge = (subject = 'report'): HTMLElement => {
  const element = document.createElement('a')
  element.setAttribute(ATTRIBUTION_ATTRIBUTE, subject)
  element.textContent = 'Report abuse'
  document.body.appendChild(element)
  withRect(element, {})
  return element
}

beforeEach(() => {
  // Reset BEFORE clearing the page: the keepers armed by the previous test
  // are still watching `body`, and emptying it in front of them is exactly
  // the removal they exist to undo.
  resetAttributionGuard()
  document.body.innerHTML = ''
  document.elementFromPoint = () => null
})

describe('inspectAttributionElement (AGL-1477)', () => {
  it('passes an element that is really on the page', () => {
    const element = makeBadge()
    document.elementFromPoint = () => element
    expect(inspectAttributionElement(element, window)).toBeNull()
  })

  it('catches the three-line CSS suppressions', () => {
    const cases: Array<[string, string]> = [
      ['display', 'none'],
      ['visibility', 'hidden'],
      ['opacity', '0'],
      ['pointer-events', 'none'],
    ]
    for (const [property, value] of cases) {
      const element = makeBadge()
      element.style.setProperty(property, value)
      document.elementFromPoint = () => element
      expect(inspectAttributionElement(element, window)).toBe(
        property === 'pointer-events' ? 'pointer-events' : property,
      )
    }
  })

  it('catches a collapsed box, which passes every style check', () => {
    const element = makeBadge()
    withRect(element, { width: 0, height: 0, right: 10, bottom: 10 })
    document.elementFromPoint = () => element
    expect(inspectAttributionElement(element, window)).toBe('collapsed')
  })

  it('catches the parked-offscreen trick', () => {
    const element = makeBadge()
    withRect(element, {
      left: -9999,
      right: -9899,
      top: 10,
      bottom: 40,
      width: 100,
      height: 30,
    })
    document.elementFromPoint = () => element
    expect(inspectAttributionElement(element, window)).toBe('offscreen')
  })

  /**
   * The one no style property reports: the element is perfectly visible and
   * something with a higher `z-index` is drawn over it.
   */
  it('catches a full-page overlay drawn on top of it', () => {
    const element = makeBadge()
    const cover = document.createElement('div')
    document.body.appendChild(cover)
    document.elementFromPoint = () => cover
    expect(inspectAttributionElement(element, window)).toBe('covered')
  })

  it('accepts a hit on a descendant or an ancestor of the element', () => {
    const element = makeBadge()
    const label = document.createElement('span')
    element.appendChild(label)
    document.elementFromPoint = () => label
    expect(inspectAttributionElement(element, window)).toBeNull()
    document.elementFromPoint = () => document.body
    expect(inspectAttributionElement(element, window)).toBeNull()
  })

  it('reports a detached element as removed rather than measuring it', () => {
    const element = makeBadge()
    element.remove()
    expect(inspectAttributionElement(element, window)).toBe('removed')
    expect(inspectAttributionElement(null, window)).toBe('removed')
  })
})

describe('installAttributionGuard', () => {
  const flush = async (): Promise<void> => {
    jest.runAllTimers()
    await Promise.resolve()
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('does nothing at all when the page ships no marked element', async () => {
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    await flush()
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('leaves a page that presents its attribution untouched', async () => {
    const element = makeBadge()
    document.elementFromPoint = () => element
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    await flush()
    expect(sendBeacon).not.toHaveBeenCalled()
    expect(document.body.children).toHaveLength(1)
  })

  it('repairs a hidden control into a shadow root and reports it once', async () => {
    const element = makeBadge('report')
    document.elementFromPoint = () => element
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    element.style.setProperty('display', 'none')
    await flush()

    // Reported once, whatever the schedule ran.
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const [endpoint, body] = sendBeacon.mock.calls[0]
    expect(endpoint).toBe('/api/attribution')
    expect(JSON.parse(String(body))).toMatchObject({
      hostId: 'h1',
      reason: 'display',
      subject: 'report',
    })

    // The repair is a NEW host beside the original, and the author's own
    // selector cannot reach what is inside it.
    const host = Array.from(document.body.children).find(
      (child) => child !== element,
    )
    expect(host).toBeTruthy()
    expect(host!.shadowRoot).toBeNull()
    expect(document.querySelectorAll('a').length).toBe(1)
    expect(host!.getAttribute('style')).toContain('position: fixed')
  })

  /**
   * A removed element leaves no node to inspect, so the repair has to work
   * from the copy taken at install — by the time one is missing there is
   * nothing left to clone.
   */
  it('repairs an element that was removed outright', async () => {
    const element = makeBadge('badge')
    document.elementFromPoint = () => element
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    element.remove()
    await flush()

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(sendBeacon.mock.calls[0][1]))).toMatchObject({
      reason: 'removed',
      subject: 'badge',
    })
    expect(document.body.children).toHaveLength(1)
  })

  it('reports the page path only — never the query string', async () => {
    const element = makeBadge()
    document.elementFromPoint = () => element
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    element.remove()
    await flush()
    expect(JSON.parse(String(sendBeacon.mock.calls[0][1])).url).toBe(
      `${location.origin}${location.pathname}`,
    )
  })

  it('installs once, however many times it is called', async () => {
    const element = makeBadge()
    document.elementFromPoint = () => element
    const sendBeacon = jest.fn()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
    installAttributionGuard({ hostId: 'h1' })
    installAttributionGuard({ hostId: 'h1' })
    element.remove()
    await flush()
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })
})
