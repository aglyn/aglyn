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
 * AGL-2486. Behaviour of the inline scroll runtime, executed as the EXACT
 * string the tenant ships — not a re-implementation of it, which would let the
 * shipped copy rot independently.
 *
 * The pragma lives inside the license docblock deliberately: jest only reads
 * the FIRST docblock in a file, so a `@jest-environment` in a second one is
 * silently ignored and the suite runs under `node` with no `document`.
 */

import { ELEMENT_ANIMATION_SCRIPT_TEXT } from './element-animation-assets'

/**
 * A faithful `IntersectionObserver` double.
 *
 * "Faithful" is the whole point (an unfaithful fake fabricates false greens
 * AND false reds): `observe` on an already-observed element is a NO-OP in the
 * real API, and the runtime leans on exactly that when it rescans. A `Set`
 * models it; an array would double-deliver entries and hide a real bug.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  readonly unobserved: Element[] = []
  constructor(
    public callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
    public options?: Record<string, unknown>,
  ) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.add(el)
  }
  unobserve(el: Element) {
    this.observed.delete(el)
    this.unobserved.push(el)
  }
  disconnect() {
    this.observed.clear()
  }
  /** Drive the callback the way the browser would. */
  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries)
  }
}

const html = `
  <div id="a" class="aglyn-anim aglyn-anim--slide-up" data-aglyn-anim-trigger="scroll"></div>
  <div id="b" class="aglyn-anim aglyn-anim--fade" data-aglyn-anim-trigger="scroll" data-aglyn-anim-repeat="1"></div>
  <div id="c" class="aglyn-anim aglyn-anim--fade" data-aglyn-anim-trigger="load"></div>
`

function boot() {
  document.documentElement.className = ''
  document.body.innerHTML = html
  FakeIntersectionObserver.instances.length = 0
  ;(window as any).IntersectionObserver = FakeIntersectionObserver
  // eslint-disable-next-line no-eval
  window.eval(ELEMENT_ANIMATION_SCRIPT_TEXT)
  return FakeIntersectionObserver.instances[0]
}

const el = (id: string) => document.getElementById(id) as HTMLElement

describe('the inline scroll runtime (AGL-2486)', () => {
  afterEach(() => {
    delete (window as any).IntersectionObserver
  })

  it('marks the document ready so the hide rule can apply', () => {
    boot()
    expect(document.documentElement.classList.contains('aglyn-anim-js')).toBe(true)
  })

  it('observes scroll-triggered elements and ONLY those', () => {
    const observer = boot()
    expect([...observer.observed].map((node) => node.id).sort()).toEqual(['a', 'b'])
  })

  it('reveals an element when it enters the viewport', () => {
    const observer = boot()
    expect(el('a').classList.contains('aglyn-anim--in')).toBe(false)
    observer.fire([{ target: el('a'), isIntersecting: true }])
    expect(el('a').classList.contains('aglyn-anim--in')).toBe(true)
  })

  it('stops watching a one-shot element once it has played', () => {
    const observer = boot()
    observer.fire([{ target: el('a'), isIntersecting: true }])
    expect(observer.unobserved.map((node) => node.id)).toEqual(['a'])
    // Leaving the viewport must NOT un-reveal it.
    observer.fire([{ target: el('a'), isIntersecting: false }])
    expect(el('a').classList.contains('aglyn-anim--in')).toBe(true)
  })

  it('keeps watching a replay element and resets it on exit', () => {
    const observer = boot()
    observer.fire([{ target: el('b'), isIntersecting: true }])
    expect(el('b').classList.contains('aglyn-anim--in')).toBe(true)
    expect(observer.unobserved).toHaveLength(0)
    observer.fire([{ target: el('b'), isIntersecting: false }])
    expect(el('b').classList.contains('aglyn-anim--in')).toBe(false)
    observer.fire([{ target: el('b'), isIntersecting: true }])
    expect(el('b').classList.contains('aglyn-anim--in')).toBe(true)
  })

  it('never touches a load-triggered element — that one is pure CSS', () => {
    const observer = boot()
    expect(observer.observed.has(el('c'))).toBe(false)
  })

  it('picks up elements inserted after load, which would otherwise stay invisible', async () => {
    // A deferred lazy tab panel the reader opens inserts nodes the first scan
    // never saw. The hide rule already applies to them, so without the
    // mutation rescan they are invisible for the rest of the session.
    const observer = boot()
    const late = document.createElement('div')
    late.id = 'late'
    late.className = 'aglyn-anim aglyn-anim--fade'
    late.setAttribute('data-aglyn-anim-trigger', 'scroll')
    document.body.appendChild(late)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(observer.observed.has(late)).toBe(true)
    observer.fire([{ target: late, isIntersecting: true }])
    expect(late.classList.contains('aglyn-anim--in')).toBe(true)
  })

  it('does nothing at all when IntersectionObserver is missing', () => {
    document.documentElement.className = ''
    document.body.innerHTML = html
    delete (window as any).IntersectionObserver
    // eslint-disable-next-line no-eval
    window.eval(ELEMENT_ANIMATION_SCRIPT_TEXT)
    // The ready class is what arms the hide rule. Without observer support it
    // must never be set, or every scroll element is permanently invisible.
    expect(document.documentElement.classList.contains('aglyn-anim-js')).toBe(false)
  })

  it('uses a bottom rootMargin so an element plays just inside the fold', () => {
    const observer = boot()
    expect(observer.options?.['rootMargin']).toBe('0px 0px -10% 0px')
  })
})
