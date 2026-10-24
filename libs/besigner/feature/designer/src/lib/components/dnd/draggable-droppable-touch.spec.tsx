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
import * as Besigner from '@aglyn/besigner'
import { DndContext } from '@dnd-kit/core'
import { Box } from '@mui/material'
import { render } from '@testing-library/react'
import { inlineTextEdit } from '../../utils/inline-text-edit.store'
import DraggableDroppable from './draggable-droppable'

const HEADING = 'touchHeading'
const noopFactory = (() => null) as any

function seed() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: HEADING,
    displayName: 'Heading',
    flags: {
      textEditable: Aglyn.FEATURE_FLAG.ENABLED,
      dragging: Aglyn.FEATURE_FLAG.ENABLED,
    },
  })
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['heading'],
    },
    heading: {
      $id: 'heading',
      componentId: HEADING,
      parentId: Aglyn.NODE_ROOT_ID,
      props: { children: 'Fresh sourdough' },
      nodes: [],
    },
  } as any)
}

function mount() {
  const node = Aglyn.canvas.getNode('heading') as Aglyn.NodeSchema<any>
  render(
    <DndContext>
      <DraggableDroppable
        node={node}
        type={Besigner.DragType.CANVAS}
        accept={Object.values(Besigner.DragType)}
      >
        <Box data-testid="heading">Fresh sourdough</Box>
      </DraggableDroppable>
    </DndContext>,
  )
  return document.querySelector('[data-testid="heading"]') as HTMLElement
}

/** jsdom has no Touch; the handlers read only these fields. */
function touch(
  target: HTMLElement,
  type: 'touchstart' | 'touchend',
  at: { x: number; y: number; t: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: at.x, clientY: at.y }
  Object.defineProperty(event, 'touches', {
    value: type === 'touchstart' ? [point] : [],
  })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  Object.defineProperty(event, 'timeStamp', { value: at.t })
  target.dispatchEvent(event)
  return event
}

function tap(target: HTMLElement, x: number, y: number, t: number, hold = 60) {
  touch(target, 'touchstart', { x, y, t })
  return touch(target, 'touchend', { x, y, t: t + hold })
}

beforeEach(() => {
  seed()
  inlineTextEdit.close()
})

afterEach(() => {
  inlineTextEdit.close()
  document.querySelectorAll('input[aria-hidden="true"]').forEach((el) => el.remove())
})

describe('double-tap to edit text on a touch screen', () => {
  it('opens the in-place editor on two quick taps, without waiting for a dblclick', () => {
    const heading = mount()
    tap(heading, 100, 40, 1000)
    expect(inlineTextEdit.node).toBeUndefined()
    const second = tap(heading, 104, 42, 1200)
    expect(inlineTextEdit.node?.$id).toBe('heading')
    expect(inlineTextEdit.anchor).toBe(heading)
    // Spent here: no zoom, no synthetic click or dblclick after it.
    expect(second.defaultPrevented).toBe(true)
  })

  it('puts the keyboard up inside the tap', () => {
    const heading = mount()
    tap(heading, 100, 40, 1000)
    tap(heading, 100, 40, 1200)
    const active = document.activeElement as HTMLElement
    expect(active.tagName).toBe('INPUT')
    expect(active.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not count taps too far apart in time or place, a hold, or a slide', () => {
    const heading = mount()
    tap(heading, 100, 40, 1000)
    tap(heading, 100, 40, 1600)
    expect(inlineTextEdit.node).toBeUndefined()

    tap(heading, 100, 40, 3000)
    tap(heading, 180, 40, 3150)
    expect(inlineTextEdit.node).toBeUndefined()

    tap(heading, 100, 40, 5000)
    tap(heading, 100, 40, 5150, 600)
    expect(inlineTextEdit.node).toBeUndefined()

    touch(heading, 'touchstart', { x: 100, y: 40, t: 7000 })
    touch(heading, 'touchend', { x: 100, y: 90, t: 7060 })
    tap(heading, 100, 90, 7200)
    expect(inlineTextEdit.node).toBeUndefined()
  })

  it("ignores the browser's own dblclick for the same two taps", () => {
    const heading = mount()
    tap(heading, 100, 40, 1000)
    tap(heading, 100, 40, 1200)
    inlineTextEdit.close()
    const dblclick = new MouseEvent('dblclick', { bubbles: true, cancelable: true })
    Object.defineProperty(dblclick, 'timeStamp', { value: 1260 })
    heading.dispatchEvent(dblclick)
    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('still opens from a mouse double-click', () => {
    const heading = mount()
    heading.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    )
    expect(inlineTextEdit.node?.$id).toBe('heading')
  })
})
