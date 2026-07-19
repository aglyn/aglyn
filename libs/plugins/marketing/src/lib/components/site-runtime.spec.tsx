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
import { fireEvent, render } from '@testing-library/react'
import type { ClientAutomation } from '../model/site-contract'
import { MarketingSiteRuntime } from './site-runtime'

/**
 * Interaction executor matrix (AGL-562): the automations engine armed
 * with click/hover triggers running the element show/hide and drawer
 * steps against a real (jsdom) DOM.
 */

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS

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

describe('automations engine — nav interactions (AGL-562)', () => {
  let target: HTMLElement
  let button: HTMLElement

  beforeEach(() => {
    document.body.innerHTML =
      '<button id="menu-button">Menu</button>' +
      '<nav id="links" data-aglyn="leaf:links-1">Links</nav>'
    target = document.getElementById('links') as HTMLElement
    button = document.getElementById('menu-button') as HTMLElement
  })

  afterEach(() => {
    for (const unmount of unmounts) unmount()
    unmounts = []
  })

  it('toggles the target on every click when everyTime is set', () => {
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'toggleElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(true)
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('fires once per pageview without everyTime (legacy default)', () => {
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        steps: [
          { type: 'toggleElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    fireEvent.click(button)
    // A repeat toggle would have flipped it back visible.
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('shows on hover enter and hides on hover leave', () => {
    runEngine([
      {
        event: 'elementHoverEnter',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'showElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
      {
        event: 'elementHoverLeave',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    target.classList.add(HIDDEN)
    fireEvent.mouseOver(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.mouseOut(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('ignores hover moves within the matched element', () => {
    button.innerHTML = '<span id="inner">Menu</span>'
    const inner = document.getElementById('inner') as HTMLElement
    runEngine([
      {
        event: 'elementHoverLeave',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    // Pointer moves from the button onto its own child — not a leave.
    fireEvent.mouseOut(button, { relatedTarget: inner })
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.mouseOut(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('shows a target that was hidden with inline display too', () => {
    target.style.display = 'none'
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'showElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(target.style.display).toBe('')
    expect(target.classList.contains(HIDDEN)).toBe(false)
  })

  it('dispatches drawer commands over the shared event bus', () => {
    const seen: Aglyn.DrawerCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeDrawerCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'openDrawer', drawerNodeId: 'drawer-9' },
          { type: 'toggleDrawer' },
          { type: 'closeDrawer', drawerNodeId: 'drawer-9' },
        ],
      },
    ])
    fireEvent.click(button)
    unsubscribe()
    expect(seen).toEqual([
      { command: 'open', nodeId: 'drawer-9' },
      { command: 'toggle' },
      { command: 'close', nodeId: 'drawer-9' },
    ])
  })

  it('injects the hidden-class rule when running the element steps', () => {
    document.getElementById(Aglyn.ELEMENT_HIDDEN_STYLE_ID)?.remove()
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(
      document.getElementById(Aglyn.ELEMENT_HIDDEN_STYLE_ID),
    ).toBeTruthy()
  })
})
