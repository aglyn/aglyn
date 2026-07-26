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
})
