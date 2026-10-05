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
import { act, renderHook } from '@testing-library/react'
import type { CanvasBindingLookups } from '../utils/normalize-canvas-binding-tokens'
import useBesignerDocument from './use-besigner-document'

/**
 * Every Besigner save writes rename-safe id tokens (AGL-3481), against the
 * REAL canvas.
 *
 * A published page resolves only `{{var:id}}`. A layout saved through EDIT →
 * Raw JSON kept `{{phone}}` as typed, and the live page drew the token: the
 * only conversions were the Attributes panel's field commit and the Versions
 * panel's Publish, and neither sees text that reaches the canvas any other
 * way. `handleSave` is the one seam every editor's write passes through, so
 * that is where these cases drive it.
 */
describe('useBesignerDocument: a save converts typed binding names (AGL-3481)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID
  const PHONE_ID = 'L03fATT870'
  const QUOTE_ID = 'qT9fnAbC12'

  /** The site's variables and functions, keyed as the console keys them. */
  const PHONE = { $id: PHONE_ID, name: 'phone' }
  const QUOTE = { $id: QUOTE_ID, name: 'Quote' }
  const LOOKUPS: CanvasBindingLookups = {
    variables: { phone: PHONE, [PHONE_ID]: PHONE },
    functions: { Quote: QUOTE, [QUOTE_ID]: QUOTE },
  }

  const nodesWith = (props: Record<string, unknown>) =>
    ({
      [ROOT]: { $id: ROOT, type: 'node', componentId: 'div', nodes: ['cta'] },
      cta: {
        $id: 'cta',
        type: 'node',
        parentId: ROOT,
        componentId: 'muiTypography',
        props,
        nodes: [],
      },
    }) as never

  /** What the store holds: the header as the picker would have written it. */
  const STORED = nodesWith({ children: 'Call {{var:L03fATT870}}' })

  function open(overrides: Record<string, unknown> = {}) {
    const save = jest.fn().mockResolvedValue(undefined)
    const notify = jest.fn()
    const rendered = renderHook(() =>
      useBesignerDocument({
        nodes: STORED,
        status: 'success',
        save,
        notify,
        noun: 'layout',
        bindingLookups: LOOKUPS,
        ...overrides,
      } as never),
    )
    return { ...rendered, save, notify }
  }

  const ctaProps = () =>
    (
      Aglyn.canvas.toJSON().nodes as Record<
        string,
        { props?: Record<string, unknown> }
      >
    ).cta?.props
  const savedProps = (save: jest.Mock) =>
    (save.mock.calls.at(-1)?.[0] as Record<string, { props?: unknown }>).cta
      ?.props

  beforeEach(() => {
    Aglyn.canvas.reset()
  })
  afterEach(() => {
    Aglyn.canvas.reset()
  })

  it('writes the id token for a name typed through Raw JSON', async () => {
    const { result, save } = open()
    act(() =>
      result.current.handleJsonSave(
        null,
        nodesWith({ children: 'Call {{phone}}', href: 'tel:{{phone}}' }),
      ),
    )

    await act(async () => {
      await result.current.handleSave()
    })

    expect(savedProps(save)).toEqual({
      children: 'Call {{var:L03fATT870}}',
      href: 'tel:{{var:L03fATT870}}',
    })
  })

  it('writes the id token for a name typed through Edit JSON', async () => {
    const { result, save } = open()
    // Edit JSON replaces the element's subtree through `applyNodes`.
    act(() => {
      Aglyn.canvas.applyNodes(nodesWith({ children: 'Call {{ phone }}' }))
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(savedProps(save)).toEqual({ children: 'Call {{var:L03fATT870}}' })
  })

  it('writes the id token for a name typed on the canvas itself', async () => {
    const { result, save } = open()
    act(() => {
      Aglyn.canvas.updateNodeProps(Aglyn.canvas.getNode('cta')!, {
        children: 'From ${{fn:Quote(100)}}, call {{phone}}',
      })
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(savedProps(save)).toEqual({
      children: 'From ${{fn:qT9fnAbC12(100)}}, call {{var:L03fATT870}}',
    })
  })

  it('leaves the canvas holding exactly what it wrote, so the editor reads saved', async () => {
    const { result, save, rerender } = open()
    act(() =>
      result.current.handleJsonSave(null, nodesWith({ children: '{{phone}}' })),
    )

    await act(async () => {
      await result.current.handleSave()
    })
    act(() => rerender())

    expect(ctaProps()).toEqual(savedProps(save))
    expect(result.current.saveAvailable).toBe(false)
  })

  it('converts a document stored with a name token when Save is pressed, rather than calling it saved', async () => {
    const storedRaw = nodesWith({ children: 'Call {{phone}}' })
    const { result, save, notify, rerender } = open({ nodes: storedRaw })
    act(() => rerender())
    // Loaded clean: nothing on the canvas differs from the store.
    expect(result.current.saveAvailable).toBe(false)

    await act(async () => {
      await result.current.handleSave()
    })

    expect(notify).not.toHaveBeenCalledWith('Already saved', expect.anything())
    expect(savedProps(save)).toEqual({ children: 'Call {{var:L03fATT870}}' })
  })

  it('makes the conversion one step that Undo takes back', async () => {
    const { result } = open()
    act(() =>
      result.current.handleJsonSave(null, nodesWith({ children: '{{phone}}' })),
    )
    await act(async () => {
      await result.current.handleSave()
    })
    expect(ctaProps()).toEqual({ children: '{{var:L03fATT870}}' })

    act(() => {
      Aglyn.canvas.undo()
    })

    expect(ctaProps()).toEqual({ children: '{{phone}}' })
  })

  it('keeps a name no variable has, since the variable may be created later', async () => {
    const { result, save } = open()
    act(() =>
      result.current.handleJsonSave(
        null,
        nodesWith({ children: '{{fax}} or {{host.phone}}' }),
      ),
    )

    await act(async () => {
      await result.current.handleSave()
    })

    expect(savedProps(save)).toEqual({ children: '{{fax}} or {{host.phone}}' })
  })

  it('saves the tokens as typed when the editor has no site to name them against', async () => {
    const { result, save } = open({ bindingLookups: null })
    act(() =>
      result.current.handleJsonSave(null, nodesWith({ children: '{{phone}}' })),
    )

    await act(async () => {
      await result.current.handleSave()
    })

    expect(savedProps(save)).toEqual({ children: '{{phone}}' })
  })
})
