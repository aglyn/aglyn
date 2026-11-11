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
 * A Select field's choices have words on a published page.
 *
 * Select Option was flagged `selfClosing`, which tells the renderer the
 * element is void (`<img>`) and strips its `children`. Every dropdown on
 * every published site rendered its choices as empty `<option>`s, each with
 * a stray `sx=",,[object Object]"` attribute, and after hydration their
 * values were empty too.
 *
 * Through the published page's renderer (`TreeRoot` and `Leaf`) and the real
 * elements, server render first and then hydration. The control registers
 * the option the way it shipped, so a schema that goes back to `selfClosing`
 * and a renderer that stops honouring `plainTextChildren` both fail here.
 */

import * as Aglyn from '@aglyn/aglyn'
import { TreeRoot } from '@aglyn/aglyn-node-renderer'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { loadMuiBundle } from '../plugin'
import { SELECT_ID, SELECT_OPTION_ID } from './form-controls'

type Entry = { component: unknown; schema: Aglyn.ComponentSchema }
const bundle = new Map<string, Entry>()

beforeAll(async () => {
  for (const entry of (await loadMuiBundle([
    SELECT_ID,
    SELECT_OPTION_ID,
  ])) as Entry[]) {
    bundle.set(entry.schema.$id as string, entry)
  }
})

/** Registers the real elements, or (`asShipped`) the option as it shipped. */
const register = (asShipped = false) => {
  for (const id of [SELECT_ID, SELECT_OPTION_ID]) {
    const entry = bundle.get(id)
    if (!entry) throw new Error(`the mui bundle registers no "${id}"`)
    const schema =
      asShipped && id === SELECT_OPTION_ID
        ? {
            ...entry.schema,
            flags: {
              selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
              textEditable: Aglyn.FEATURE_FLAG.ENABLED,
            },
          }
        : entry.schema
    Aglyn.components.registerComponent(
      entry.component as never,
      schema as never,
    )
  }
}

afterEach(() => {
  for (const id of [SELECT_ID, SELECT_OPTION_ID]) {
    Aglyn.components.unregisterComponent(id)
  }
})

const node = (
  id: string,
  componentId: string,
  props: Record<string, unknown>,
  children: unknown[] = [],
) => ({ $id: id, type: 'node', componentId, props, children, nodes: [] })

/** A stored Topic dropdown: one option sends its own value, two send their text. */
const topicSelect = () =>
  node('topic', SELECT_ID, { name: 'topic', placeholder: 'Pick one' }, [
    node('topic-o0', SELECT_OPTION_ID, { children: 'My account or billing' }),
    node('topic-o1', SELECT_OPTION_ID, {
      children: 'A new website',
      value: 'new-site',
    }),
    node('topic-o2', SELECT_OPTION_ID, { children: 'Something else' }),
  ])

/** The server's markup as the browser's parser leaves it. */
const serverHtml = () => renderToString(<TreeRoot node={topicSelect() as never} />)

const parse = (html: string) => {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

/** The authored choices: the placeholder option has no `data-aglyn`. */
const choices = (root: ParentNode) =>
  Array.from(
    root.querySelectorAll<HTMLOptionElement>('option[data-aglyn]'),
  ).map((option) => ({ text: option.textContent, value: option.value }))

const EXPECTED = [
  { text: 'My account or billing', value: 'My account or billing' },
  { text: 'A new website', value: 'new-site' },
  { text: 'Something else', value: 'Something else' },
]

describe('a published Select field', () => {
  it('server-renders every option with its text and value', () => {
    register()
    expect(choices(parse(serverHtml()))).toEqual(EXPECTED)
  })

  it('puts no sx attribute on an option', () => {
    register()
    const html = serverHtml()
    expect(html).not.toMatch(/\ssx=/)
    for (const option of Array.from(parse(html).querySelectorAll('option'))) {
      expect(option.hasAttribute('sx')).toBe(false)
    }
  })

  it('keeps the text and values through hydration', async () => {
    register()
    const container = parse(serverHtml())
    document.body.appendChild(container)
    const errors: unknown[] = []
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((...args) => errors.push(args))
    try {
      await act(async () => {
        hydrateRoot(container, <TreeRoot node={topicSelect() as never} />, {
          onRecoverableError: (error) => errors.push(error),
        })
      })
      expect(choices(container)).toEqual(EXPECTED)
      expect(errors).toEqual([])
    } finally {
      consoleError.mockRestore()
      container.remove()
    }
  })

  it('was blank as shipped (control: selfClosing strips the text)', () => {
    register(true)
    expect(choices(parse(serverHtml()))).toEqual([
      { text: '', value: '' },
      { text: '', value: 'new-site' },
      { text: '', value: '' },
    ])
  })
})
