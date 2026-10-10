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
import {
  besignerDraftKey,
  readBesignerDraft,
} from '../drafts/besigner-draft-store'
import useBesignerDocument from './use-besigner-document'

jest.mock('../drafts/besigner-server-draft', () => ({
  writeServerDraft: jest.fn(async () => 'written'),
  readServerDraft: jest.fn(async () => null),
  clearServerDraft: jest.fn(async () => undefined),
}))

const ROOT = Aglyn.NODE_ROOT_ID
const tree = (text: string) =>
  ({
    [ROOT]: {
      $id: ROOT,
      type: 'node',
      parentId: ROOT,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['t'],
    },
    t: {
      $id: 't',
      type: 'node',
      parentId: ROOT,
      componentId: 'div',
      props: { children: text },
      sx: {},
      nodes: [],
    },
  }) as never

const ids = (versionId: string) => ({
  scope: 'host-1',
  kind: 'component' as const,
  docId: 'cmp-1',
  versionId,
})

const stamp = (millis: number) => ({ toMillis: () => millis })

const canvasText = () =>
  (Aglyn.canvas.toJSON().nodes as Record<string, any>)['t']?.props?.children

function editCanvas(text: string) {
  const json = Aglyn.canvas.toJSON().nodes as Record<string, any>
  Aglyn.canvas.applyNodes({
    ...json,
    t: { ...json['t'], props: { children: text } },
  } as never)
}

describe('switching versions with unsaved edits', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.clear()
    Aglyn.canvas.reset()
  })
  afterEach(() => {
    jest.useRealTimers()
    Aglyn.canvas.reset()
  })

  function setup() {
    const save = jest.fn().mockResolvedValue(undefined)
    const base = {
      status: 'success',
      save,
      noun: 'component',
      bindingLookups: null,
    }
    const view = (versionId: string, nodes: unknown, at: number) => ({
      ...base,
      nodes,
      updatedAt: stamp(at),
      documentKey: `host-1:cmp-1:${versionId}`,
      draft: ids(versionId),
    })
    const rendered = renderHook(
      (props: Record<string, unknown>) => useBesignerDocument(props as never),
      { initialProps: view('v1', tree('one'), 1) },
    )
    return { ...rendered, view }
  }

  it.each([
    ['the new version arrives with the switch', true],
    ['the old version lingers for a render', false],
  ])('v2 never shows or stores v1 edits, and v1 keeps them (%s)', (_label, immediate) => {
    const { rerender, view } = setup()
    // `useDocData` keeps the previous document's data object until the new
    // snapshot lands, so the switch render carries v1's nodes by identity.
    const v1 = tree('one')
    rerender(view('v1', v1, 1))
    expect(canvasText()).toBe('one')

    act(() => editCanvas('EDITED in v1'))
    rerender(view('v1', v1, 1))
    act(() => jest.advanceTimersByTime(200))

    if (!immediate) rerender(view('v2', v1, 1))
    rerender(view('v2', tree('two'), 2))
    rerender(view('v2', tree('two'), 2))
    act(() => jest.advanceTimersByTime(20_000))
    rerender(view('v2', tree('two'), 2))

    expect(canvasText()).toBe('two')
    const v2Draft = readBesignerDraft(ids('v2'))
    expect(JSON.stringify(v2Draft ?? null)).not.toContain('EDITED in v1')
    expect(window.localStorage.getItem(besignerDraftKey(ids('v1')))).toContain(
      'EDITED in v1',
    )
  })
})
