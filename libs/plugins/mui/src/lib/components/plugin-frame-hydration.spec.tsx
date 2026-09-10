/**
 * @jest-environment jsdom
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

/**
 * The plugin frame renders the same element on both sides of hydration
 * (AGL-2735).
 *
 * The origin check reads `window.location.origin`, which a server render
 * does not have. It used to answer that with a constant, so the server chose
 * one branch and the browser chose the other for any `pluginOrigin` that was
 * same-origin to the app — a misconfigured env, or a self-host container that
 * points plugins at itself. Both sides rendered, both looked right, and the
 * only trace was a React #418 in production. Flipping the constant does not
 * fix it; it moves the disagreement to the correctly configured case, which
 * is every site.
 *
 * So the first render asks nothing about the origin at all, and the two
 * assertions below are what that has to mean: the same markup for a
 * same-origin and a cross-origin `pluginOrigin`, and no plugin address in it.
 * The second is a security property in its own right — an unverified origin
 * in the server HTML is one the browser starts loading, under
 * `allow-same-origin`, before the check that would have refused it has run.
 *
 * The assertions read what React SAID, not what the DOM ended up as:
 * hydration recovers by re-rendering on the client, so the recovered DOM
 * looks correct either way.
 *
 * WHICH ASSERTIONS CARRY THE GUARD: the two markup ones. `renderToString`
 * runs here under jsdom, where `window` exists, so this file cannot stage a
 * real server render and the hydration cases pass against the defective code
 * too — measured, not assumed. What the defective code cannot pass is a
 * server render that declined to branch on the origin, which is the whole
 * mechanism. Loosen those two and this file stops testing anything.
 */

import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import PluginFrame from './plugin-frame'
import type { PluginFrameProps } from './plugin-frame'

const BASE: Omit<PluginFrameProps, 'pluginOrigin'> = {
  listingId: 'listing-1',
  version: '1.0.0',
  sha256: 'deadbeef',
}

/** A dedicated plugin origin, the configuration every site should have. */
const CROSS_ORIGIN = 'https://plugins.example.com'

/**
 * The app's own origin — jsdom serves the tests from it. This is the
 * misconfiguration: the value the sandbox exists to refuse.
 */
const SAME_ORIGIN = window.location.origin

function frame(pluginOrigin: string, extra?: Partial<PluginFrameProps>) {
  return <PluginFrame {...BASE} pluginOrigin={pluginOrigin} {...extra} />
}

/** Tag names and `tag@attribute` pairs present in a markup string. */
function shapeOf(markup: string): string[] {
  const host = document.createElement('div')
  host.innerHTML = markup
  const shape = new Set<string>()
  for (const element of Array.from(host.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase()
    shape.add(tag)
    for (const attribute of Array.from(element.attributes)) {
      // Emotion's generated class names differ per style object; the point
      // here is which elements and attributes exist, not their values.
      if (attribute.name.toLowerCase() === 'class') continue
      shape.add(`${tag}@${attribute.name.toLowerCase()}`)
    }
  }
  return [...shape].sort()
}

describe('the plugin frame hydrates without a mismatch (AGL-2735)', () => {
  let errors: unknown[][]
  let spy: jest.SpyInstance

  beforeEach(() => {
    errors = []
    spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })
  })
  afterEach(() => spy.mockRestore())

  /** React's mismatch reports, by the words and codes it uses for them. */
  function hydrationComplaints(): string[] {
    return errors
      .map((entry) => entry.map((part) => String(part)).join(' '))
      .filter((text) =>
        /hydrat|did not match|server (?:rendered )?HTML|#418|#423|#425|removeChild|insertBefore/i.test(
          text,
        ),
      )
  }

  interface HydrationReport {
    /** Everything React said about the mismatch, through either channel. */
    complaints: string[]
    container: HTMLElement
  }

  /**
   * Hydrates `client` into the markup `server` produced, and collects what
   * React made of the difference.
   *
   * React 19 reports a mismatch through two different channels depending on
   * its shape. A text-level disagreement is patched in place with a
   * `console.error` warning. A structural one — the element type itself
   * changing, which is exactly the defect this file pins — throws, is caught
   * by React, and arrives as a RECOVERABLE error; left alone, React's
   * default handler forwards it to `reportError`, where it surfaces as an
   * unrelated-looking uncaught error rather than as anything this file can
   * assert on. Passing `onRecoverableError` claims that channel, so both
   * shapes land in one list and the assertions never have to know which one
   * a given case took.
   */
  async function hydrationReport(
    server: React.ReactElement,
    client: React.ReactElement,
  ): Promise<HydrationReport> {
    const container = document.createElement('div')
    container.innerHTML = renderToString(server)
    // Emotion emits its `<style data-emotion>` INLINE during a server render
    // and inserts through CSSOM on the client, so the two sides legitimately
    // disagree about those elements; production hoists them to <head> with
    // `createEmotionServer`, and this does the same. The negative control
    // below fails if this ever stops being true.
    for (const style of Array.from(
      container.querySelectorAll('style[data-emotion]'),
    )) {
      document.head.appendChild(style)
    }
    document.body.appendChild(container)
    const recovered: string[] = []
    try {
      await act(async () => {
        hydrateRoot(container, client, {
          onRecoverableError: (error) =>
            recovered.push(String((error as Error)?.message ?? error)),
        })
      })
    } catch (error) {
      recovered.push(String((error as Error)?.message ?? error))
    }
    return { complaints: [...hydrationComplaints(), ...recovered], container }
  }

  /** Server and client render the same element, the normal case. */
  const hydrate = (pluginOrigin: string, extra?: Partial<PluginFrameProps>) =>
    hydrationReport(frame(pluginOrigin, extra), frame(pluginOrigin, extra))

  it('the harness DOES catch a mismatch when there is one', async () => {
    // The negative control, in the defect's own shape: a server that rendered
    // the placeholder against a client that renders the frame. Every
    // assertion below is on an EMPTY complaint list, so this file proves
    // nothing if the harness cannot hear React say this.
    const report = await hydrationReport(
      <div>
        <span>the placeholder the server used to choose</span>
      </div>,
      frame(CROSS_ORIGIN),
    )
    expect(report.complaints.length).toBeGreaterThan(0)
  })

  it('renders the same server markup for a same-origin and a cross-origin plugin origin', () => {
    // The bug, stated directly: the origin decided the server's branch.
    expect(shapeOf(renderToString(frame(SAME_ORIGIN)))).toEqual(
      shapeOf(renderToString(frame(CROSS_ORIGIN))),
    )
  })

  it('puts no plugin address in the server markup', () => {
    const markup = renderToString(frame(CROSS_ORIGIN))
    expect(markup).toContain('<iframe')
    expect(markup).not.toContain('src=')
    expect(markup).not.toContain(CROSS_ORIGIN)
    // The containment is stamped from the first render, not added later.
    expect(markup).toContain('sandbox="allow-scripts allow-same-origin"')
  })

  it('hydrates a correctly configured cross-origin frame with no complaint', async () => {
    const report = await hydrate(CROSS_ORIGIN)
    expect(report.complaints).toEqual([])
    // And the address arrives once the origin has been checked.
    const iframe = report.container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toContain(`${CROSS_ORIGIN}/load`)
  })

  it('hydrates a same-origin misconfiguration with no complaint, and still refuses it', async () => {
    const report = await hydrate(SAME_ORIGIN)
    expect(report.complaints).toEqual([])
    // The refusal is the whole point of the check; deferring it must not
    // weaken it. Post-mount there is no frame, only the placeholder.
    expect(report.container.querySelector('iframe')).toBeNull()
    expect(report.container.textContent).toContain(
      'Plugin cannot be loaded safely here.',
    )
  })

  it('hydrates a revoked version with no complaint', async () => {
    const report = await hydrate(CROSS_ORIGIN, { revoked: true })
    expect(report.complaints).toEqual([])
    expect(report.container.textContent).toContain('disabled by the platform')
  })

  it('hydrates an unconfigured deployment with no complaint', async () => {
    const report = await hydrationReport(
      <PluginFrame {...BASE} />,
      <PluginFrame {...BASE} />,
    )
    expect(report.complaints).toEqual([])
    expect(report.container.textContent).toContain('not enabled on this deployment')
  })
})
