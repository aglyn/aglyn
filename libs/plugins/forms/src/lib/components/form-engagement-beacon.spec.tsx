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
 * @jest-environment-options {"url": "https://customer.example/"}
 */

/**
 * THE DENOMINATORS, MEASURED AT THE CHEAPEST POINT THAT CAN SEE THEM.
 *
 * A form's counters recorded what ARRIVED and nothing about what was offered,
 * so completion and abandonment were percentages over a population nobody had
 * counted. The only place a view or a start is observable is the component
 * that renders the form, and the constraint that governs it there is cost:
 * this is a component on a customer's public pages, so the measurement must
 * not be a Firestore write per RENDER.
 *
 * Every assertion below is about that. What is under test is not that a
 * request goes out — it is HOW MANY, and which renders are exempt.
 *
 * ## Why this file states a deployment
 *
 * These beacons share the metered collector with the pageview, so they share
 * its gate: `sendAnalyticsBeacon` counts only from a real production surface,
 * and jsdom's default document is served from `localhost`. Without the URL
 * pragma above and the environment below, every case here would assert an
 * absence it got for free from the loopback rule — a suite that cannot fail.
 * The last case is the gate itself, so the arrangement stays honest.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render } from '@testing-library/react'
import Form, { FormField } from './form'

/** Every beacon body the component handed the browser, parsed. */
let beacons: Record<string, any>[]

/** `NODE_ENV` is typed read-only here as it is in the apps. One named cast. */
const mutableEnv = process.env as Record<string, string | undefined>
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}

afterEach(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

beforeEach(() => {
  beacons = []
  // The deployment every case but the last one describes: ours, in production.
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) }) as never
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (_url: string, body: string) => {
      beacons.push(JSON.parse(body))
      return true
    },
  })
})

/**
 * A form on a LIVE page unless `suppressNavigation` says otherwise — the flag
 * the besigner canvas and the console's preview set, and the one thing that
 * separates a visitor from an author looking at their own draft.
 */
const renderForm = (
  options: {
    formId?: string
    hostId?: string
    suppressNavigation?: boolean
  } = {},
) => {
  // `in` rather than a default: the two interesting cases pass `undefined`
  // deliberately, and a default parameter would replace exactly the value
  // under test with the one it is supposed to differ from.
  const formId = 'formId' in options ? options.formId : 'form-1'
  const hostId = 'hostId' in options ? options.hostId : 'host-1'
  const { suppressNavigation } = options
  return render(
    <Aglyn.SiteContext.Provider value={{ hostId } as never}>
      <Aglyn.ScreenLinkContext.Provider
        value={{ screens: {}, suppressNavigation }}
      >
        <Form formId={formId} formName="Survey">
          <FormField fieldName="email" label="Email" />
        </Form>
      </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>,
  )
}

const kinds = () => beacons.map((body) => body['form'])

describe('a rendered form reports the view its rates are taken over', () => {
  it('reports ONE view, naming the host and the form', () => {
    renderForm()
    expect(beacons).toEqual([
      { hostId: 'host-1', formId: 'form-1', form: 'view' },
    ])
  })

  it('reports one view across a re-render, not one per render', () => {
    // THE COST ASSERTION. Each of these is a Firestore write on a public
    // page; a counter driven by render rather than by mount would be a write
    // per keystroke on every form on the platform.
    const { rerender } = renderForm()
    // The SAME tree shape, so React re-renders this Form rather than
    // unmounting and mounting a new one — which would be a new view, and
    // correctly so.
    rerender(
      <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' } as never}>
        <Aglyn.ScreenLinkContext.Provider value={{ screens: {} }}>
          <Form formId="form-1" formName="Survey">
            <FormField fieldName="email" label="Renamed" />
          </Form>
        </Aglyn.ScreenLinkContext.Provider>
      </Aglyn.SiteContext.Provider>,
    )
    expect(kinds().filter((kind) => kind === 'view')).toHaveLength(1)
  })

  it('reports NOTHING on an editing surface', () => {
    // The besigner canvas and the console preview render this component for
    // its author. Counting an author looking at their own draft would put the
    // merchant into the denominator of their own completion rate.
    renderForm({ suppressNavigation: true })
    expect(beacons).toEqual([])
  })

  it('reports NOTHING without a site', () => {
    renderForm({ hostId: undefined })
    expect(beacons).toEqual([])
  })

  it('reports NOTHING for a form that is not bound to a form entity', () => {
    // An unbound form has no document to count on, and an id is never
    // invented for it — the collector's `update` would find nothing.
    renderForm({ formId: undefined })
    expect(beacons).toEqual([])
  })
})

describe('a START is the first edit, once', () => {
  it('reports a start when a visitor types', () => {
    const { container } = renderForm()
    fireEvent.input(container.querySelector('input[name="email"]') as Element, {
      target: { value: 'a' },
    })
    expect(kinds()).toEqual(['view', 'start'])
  })

  it('reports ONE start however much is typed', () => {
    const { container } = renderForm()
    const input = container.querySelector('input[name="email"]') as Element
    for (const value of ['a', 'ab', 'abc']) {
      fireEvent.input(input, { target: { value } })
    }
    expect(kinds().filter((kind) => kind === 'start')).toHaveLength(1)
  })

  it('does NOT report a start for a form that is only looked at', () => {
    // Abandonment is measured over starts, so a form tabbed through and left
    // alone must not enter that denominator — the rate would then read as
    // people abandoning a form they never began.
    renderForm()
    expect(kinds()).toEqual(['view'])
  })

  it('reports no start on an editing surface either', () => {
    const { container } = renderForm({ suppressNavigation: true })
    fireEvent.input(container.querySelector('input[name="email"]') as Element, {
      target: { value: 'a' },
    })
    expect(beacons).toEqual([])
  })
})

describe('the beacon can never break the form it measures', () => {
  it('renders and submits normally when sendBeacon throws', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('blocked')
      },
    })
    const { container } = renderForm()
    const input = container.querySelector('input[name="email"]') as Element
    expect(() =>
      fireEvent.input(input, { target: { value: 'a' } }),
    ).not.toThrow()
    expect(container.querySelector('form')).toBeTruthy()
  })
})


describe('a form counts only where a pageview would', () => {
  /**
   * The same gate as the pageview beacon, for the same reason: these counters
   * live on the metered collector and the tenant app names the PRODUCTION
   * Firebase project in every environment, so a `next dev` and a preview
   * deployment used to write a real customer's form views.
   *
   * Planted red, verified: send through a raw `navigator.sendBeacon` in
   * `sendFormBeacon` → both cases go red.
   */
  it('reports nothing under next dev', () => {
    mutableEnv.NODE_ENV = 'development'
    renderForm()
    expect(beacons).toEqual([])
  })

  it('reports nothing from a Vercel preview, whose NODE_ENV is production', () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'preview'
    const { container } = renderForm()
    fireEvent.input(container.querySelector('input[name="email"]') as Element, {
      target: { value: 'a' },
    })
    expect(beacons).toEqual([])
  })
})
