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
 * An open help tip re-places itself when its content changes size (AGL-2855).
 *
 * Popper places a tooltip when it opens. A console help excerpt is a chunk
 * fetched on that first open (AGL-2706), so the tip is placed while it holds
 * only its title and link, and grows afterward — and Popper recomputes only on
 * scroll, on a window resize, or when the popper component itself re-renders.
 * The Aglyn Assist panel's tip, at the right edge of the window, grew 137px
 * off the screen that way.
 *
 * jsdom has no layout, so a position cannot be measured here. What is pinned
 * is the wiring the fix consists of: the open tip's content is observed, and a
 * size change reaches the tip's own popper as an update. Both kinds of tip are
 * held to it, because `DocsHelpTip` is only correct for as long as it renders
 * the shared `HelpTip` rather than a copy of its markup.
 */

import { HelpTip } from '@aglyn/shared-ui-jsx'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { DocsHelpTip } from '../components/docs-help-tip.component'

interface SpiedPopper {
  update: jest.Mock
}

const mockPoppers: SpiedPopper[] = []

jest.mock('@popperjs/core', () => {
  const actual = jest.requireActual('@popperjs/core')
  return {
    ...actual,
    createPopper: (...args: unknown[]) => {
      const instance = actual.createPopper(...args)
      instance.update = jest.fn(instance.update)
      mockPoppers.push(instance)
      return instance
    },
  }
})

class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = []
  readonly observed: Element[] = []
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    RecordingResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.push(target)
  }

  unobserve(target: Element) {
    this.observed.splice(this.observed.indexOf(target), 1)
  }

  disconnect() {
    this.observed.length = 0
  }
}

const globals = globalThis as unknown as { ResizeObserver?: unknown }

beforeEach(() => {
  RecordingResizeObserver.instances = []
  mockPoppers.length = 0
  globals.ResizeObserver = RecordingResizeObserver
})

afterEach(() => {
  delete globals.ResizeObserver
})

describe.each([
  [
    'the shared HelpTip',
    () => (
      <HelpTip
        title="Billing"
        excerpt="Plans, seats and invoices."
        href="https://docs.aglyn.com/workspace-and-billing/billing"
      />
    ),
  ],
  [
    'DocsHelpTip',
    () => <DocsHelpTip topic="billing" excerpt="Plans, seats and invoices." />,
  ],
])('%s', (_name, tip) => {
  it('asks its popper to re-place it when the open content changes size', async () => {
    render(tip())
    fireEvent.mouseOver(screen.getByRole('link', { name: /^Help: Billing/ }))
    const tooltip = await screen.findByRole('tooltip')

    const observer = RecordingResizeObserver.instances.find((candidate) =>
      candidate.observed.some((node) => tooltip.contains(node)),
    )
    expect(observer).toBeDefined()
    expect(mockPoppers).toHaveLength(1)

    const [popper] = mockPoppers
    popper.update.mockClear()
    act(() => {
      observer?.callback([], observer as unknown as ResizeObserver)
    })
    expect(popper.update).toHaveBeenCalledTimes(1)
  })
})
