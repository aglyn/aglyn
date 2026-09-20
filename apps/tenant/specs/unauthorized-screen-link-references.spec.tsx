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
 * A designed 401 renders inside the screen-link context (AGL-3122).
 *
 * `catch-all-client` gave every other branch a `ScreenLinkContext.Provider`
 * and this one only `EnabledPluginsContext`, so a Screen Link, Button, Link
 * Container or markdown link on a members-only denial screen had no routing
 * map to resolve against. EVERY reference kind was affected — `screen:`,
 * `collection:`, `entry:`, `feed:` — and only a typed external URL survived.
 *
 * That is the worst screen to lose links on: it is the page that says "this is
 * for members", so its "Sign in" or "See plans" link is the way out.
 *
 * Asserted on the CONTEXT rather than on a rendered `href`, which is the whole
 * defect: the nodes and the components were always fine, and a renderer
 * exercised in isolation resolves nothing and still passes. What was missing
 * was the provider around this one branch, so that is what is pinned.
 */

/** The plugin gate loads nothing: this render passes `nodes={null}`. */
jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

/**
 * Stand in for the canvas and report what the context hands it. The real
 * renderer would drag the whole node graph in to answer a question about one
 * provider.
 */
jest.mock('@aglyn/aglyn-node-renderer', () =>
  require('./screen-link-context-probe'),
)

import { act, render, waitFor } from '@testing-library/react'
import CatchAllClient from '../app/[host]/[scheme]/[[...slug]]/catch-all-client'

/** The map the page hands the renderer, as any other branch would receive it. */
const ROUTES = {
  home: '/',
  signin: 'signin',
  'collection:plans': 'plans',
}

/** A denial: `/api/membership/content` answers not-ok, so `memberDenied`. */
const denyMembership = () => {
  const fetchMock = jest.fn(async () => ({ ok: false }) as never)
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  return fetchMock
}

const renderDenied = async () => {
  let container!: HTMLElement
  await act(async () => {
    container = render(
      <CatchAllClient
        data={
          {
            host: { $id: 'host-1' },
            screen: { data: { $id: 'members-only' } },
          } as never
        }
        nodes={null}
        memberScreen
        unauthorizedNodes={
          { '_@_': { $id: '_@_', type: 'root', nodes: [] } } as never
        }
        screenRoutes={ROUTES}
      />,
    ).container
  })
  return container
}

describe('a designed 401 screen’s link references (AGL-3122)', () => {
  beforeEach(() => {
    denyMembership()
  })

  it('renders inside the routing map, so its way-out links can resolve', async () => {
    const container = await renderDenied()

    // The denial branch really rendered — otherwise an empty context below
    // would be a page that never got here rather than a missing provider.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="probe"]')).not.toBeNull()
    })

    const screens = JSON.parse(
      container
        .querySelector('[data-testid="probe"]')
        ?.getAttribute('data-screens') ?? 'null',
    )
    // Without the provider this is the context default — `undefined` screens
    // inside a bare `{}` — and every reference on the screen renders dead.
    expect(screens).not.toBeNull()
    expect(screens).toMatchObject({
      signin: 'signin',
      'collection:plans': 'plans',
    })
  })
})
