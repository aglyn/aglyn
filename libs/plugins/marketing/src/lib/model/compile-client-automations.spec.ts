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

import type { HostAction } from '@aglyn/aglyn'
import { compileClientAutomations, type RawHostAction } from './compile-client-automations'

const raw = (id: string, action: Partial<HostAction>): RawHostAction => ({
  id,
  action: {
    name: id,
    trigger: { event: 'elementHoverEnter' },
    steps: [],
    ...action,
  } as HostAction,
})

const hoverOpenMenu = (id: string, selector: string): RawHostAction =>
  raw(id, {
    trigger: { event: 'elementHoverEnter', selector },
    steps: [{ type: 'openMenu', menuNodeId: 'menu-1' } as never],
  })

describe('compileClientAutomations (AGL-830)', () => {
  const opts = { path: '/', actionsEntitled: false, allowJs: false }

  it('maps a hover→open-menu action to a client automation', () => {
    const [automation] = compileClientAutomations(
      [hoverOpenMenu('a1', '[data-aglyn="leaf:x"]')],
      opts,
    )
    expect(automation).toMatchObject({
      id: 'a1',
      event: 'elementHoverEnter',
      selector: '[data-aglyn="leaf:x"]',
      hasServerSteps: false,
    })
    expect(automation.steps).toHaveLength(1)
  })

  it('keeps basic presentational steps even when not actions-entitled', () => {
    const result = compileClientAutomations(
      [hoverOpenMenu('a1', '[data-aglyn="leaf:x"]')],
      opts,
    )
    expect(result).toHaveLength(1)
  })

  it('drops disabled and soft-deleted actions', () => {
    const result = compileClientAutomations(
      [
        raw('off', { enabled: false, steps: [{ type: 'openMenu' } as never] }),
        raw('gone', {
          ...({ deletedAt: 1 } as object),
          steps: [{ type: 'openMenu' } as never],
        }),
      ],
      opts,
    )
    expect(result).toHaveLength(0)
  })

  it('never advertises server steps while un-entitled (no preview dispatch)', () => {
    const result = compileClientAutomations(
      [
        raw('srv', {
          trigger: { event: 'pageVisit' },
          steps: [{ type: 'sendEmail' } as never],
        }),
      ],
      opts,
    )
    // Only a server step + un-entitled → dropped entirely, no dispatch.
    expect(result).toHaveLength(0)
  })

  /**
   * An authored analytics step and a basic presentational step in ONE action.
   *
   * The second is the control. `trackGaEvent` is an advanced client step, so
   * an unentitled site loses it — and an action whose every step is trimmed
   * is dropped whole, which makes "the analytics step was removed" and "the
   * action never compiled" indistinguishable from a length assertion alone.
   * The `openMenu` beside it runs on every plan, so it has to survive both
   * runs, and the trim is only proved when it does.
   */
  const authoredAnalytics = (params?: Record<string, string>): RawHostAction =>
    raw('ga', {
      trigger: { event: 'elementClick', selector: '[data-aglyn="leaf:cta"]' },
      steps: [
        {
          type: 'trackGaEvent',
          eventName: 'cta_click',
          ...(params ? { params } : {}),
        },
        { type: 'openMenu', menuNodeId: 'menu-1' },
      ] as never,
    })

  it('keeps an authored analytics step, parameters intact, for an actions-entitled site', () => {
    const [automation] = compileClientAutomations(
      [authoredAnalytics({ plan: 'starter', placement: 'hero' })],
      { ...opts, actionsEntitled: true },
    )
    // The params reach the payload byte-for-byte: the compiler passes steps
    // through untouched, and the runtime is the only thing that sanitizes.
    expect(automation.steps).toEqual([
      {
        type: 'trackGaEvent',
        eventName: 'cta_click',
        params: { plan: 'starter', placement: 'hero' },
      },
      { type: 'openMenu', menuNodeId: 'menu-1' },
    ])
  })

  it('drops the authored analytics step — and only it — for a site without `actions`', () => {
    const [automation] = compileClientAutomations(
      [authoredAnalytics({ plan: 'starter' })],
      opts,
    )
    expect(automation.steps).toEqual([
      { type: 'openMenu', menuNodeId: 'menu-1' },
    ])
  })

  it('filters by pathPattern unless matchAllPaths is set', () => {
    const action = raw('p', {
      trigger: {
        event: 'elementHoverEnter',
        selector: '[data-aglyn="leaf:x"]',
        pathPattern: '/shop',
      },
      steps: [{ type: 'openMenu' } as never],
    })
    expect(compileClientAutomations([action], { ...opts, path: '/' })).toHaveLength(0)
    expect(
      compileClientAutomations([action], { ...opts, path: '/', matchAllPaths: true }),
    ).toHaveLength(1)
  })

  it('drops a path-scoped action outright when the path is unknowable', () => {
    // AGL-2511, and the opposite of `matchAllPaths` on purpose: Preview knows
    // which page it is showing, the designed 404 does not know which URL it
    // stands in for. `/shop` would otherwise match `/` here through a
    // placeholder path nobody chose.
    const scoped = raw('p', {
      trigger: {
        event: 'elementHoverEnter',
        selector: '[data-aglyn="leaf:x"]',
        pathPattern: '/*',
      },
      steps: [{ type: 'openMenu' } as never],
    })
    expect(
      compileClientAutomations([scoped], { ...opts, path: '/' }),
    ).toHaveLength(1)
    expect(
      compileClientAutomations([scoped], {
        ...opts,
        path: '/',
        dropPathScoped: true,
      }),
    ).toHaveLength(0)
  })

  it('keeps an unscoped action — a nav’s hover choreography — when the path is unknowable', () => {
    // The half that must survive: interactions authored on nodes carry no
    // path pattern, and they are the reason the surface is enriched at all.
    expect(
      compileClientAutomations([hoverOpenMenu('a1', '[data-aglyn="leaf:x"]')], {
        ...opts,
        path: '/',
        dropPathScoped: true,
      }),
    ).toHaveLength(1)
  })
})
