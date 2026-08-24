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
import { renderHook } from '@testing-library/react'
import {
  describeComponentPropagation,
  diffRenderedComponentDefinitions,
  useComponentPropagationNotice,
} from './use-component-propagation-notice'

const instance = (id: string, refId: string) => ({
  $id: id,
  componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
  props: { refId },
  nodes: [] as string[],
})

/** A definition rendering one Typography with `text`, placing `places`. */
const definition = (text: string, places?: string) =>
  ({
    rootId: 'root',
    nodes: {
      root: {
        $id: 'root',
        componentId: 'muiStack',
        nodes: places ? ['label', 'inner'] : ['label'],
      },
      label: {
        $id: 'label',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { children: text },
      },
      ...(places ? { inner: instance('inner', places) } : {}),
    },
  }) as any

// AGL-1898 phase 2: the transport (a live definitions listener) already
// re-grafts an open canvas when a component is published. What these cover
// is deciding whether a given snapshot is THIS document's business, and
// saying so in words that are true.
describe('diffRenderedComponentDefinitions (AGL-1898)', () => {
  const screen = { a: instance('a', 'nav') } as any

  it('reports a published change to a component the page places directly', () => {
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home') },
      next: { nav: definition('Start') },
      names: { nav: 'Site nav' },
    })
    expect(changes).toEqual([{ id: 'nav', name: 'Site nav', kind: 'updated' }])
  })

  it('reports a change to a component nested INSIDE the one the page places', () => {
    // The case a shared component is usually in. The screen places the nav;
    // the button lives inside the nav. A direct-only filter is silent here,
    // which is silence for the commonest shape of the feature.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home', 'button'), button: definition('Go') },
      next: { nav: definition('Home', 'button'), button: definition('Buy') },
      names: { button: 'Primary button' },
    })
    expect(changes).toEqual([
      { id: 'button', name: 'Primary button', kind: 'updated' },
    ])
  })

  it('stays silent for a component this page does not render', () => {
    // The definitions map is per HOST: it changes whenever anyone publishes
    // anything on the site.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home'), footer: definition('© 2025') },
      next: { nav: definition('Home'), footer: definition('© 2026') },
    })
    expect(changes).toEqual([])
  })

  it('watches the LAYOUT the screen is bound to, not only the screen', () => {
    // The nav an author edits is almost always in the layout chrome.
    const changes = diffRenderedComponentDefinitions({
      documents: [{ x: { $id: 'x', componentId: 'div', nodes: [] } } as any, screen],
      previous: { nav: definition('Home') },
      next: { nav: definition('Start') },
    })
    expect(changes.map((change) => change.id)).toEqual(['nav'])
  })

  it('stays silent when a re-emitted snapshot carries the same content', () => {
    // Every snapshot rebuilds every definition object, so identity always
    // differs — comparing on it would report the page as changed each time
    // a colleague published anything anywhere on the site.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home') },
      next: { nav: definition('Home') },
    })
    expect(changes).toEqual([])
  })

  it('stays silent when only the NESTED field order differs', () => {
    // Nothing promises a snapshot rebuilds a node map, or one node's props,
    // in the order the last one did — and the comparison reaches all the way
    // down. Reordering only the definition's own top-level fields would
    // prove nothing: those are re-read by name before comparing.
    const ordered = {
      rootId: 'root',
      nodes: {
        root: { $id: 'root', componentId: 'muiStack', nodes: ['label'] },
        label: { $id: 'label', componentId: 'muiTypography', props: { children: 'Hi', variant: 'h1' } },
      },
    } as any
    const reordered = {
      rootId: 'root',
      nodes: {
        label: { componentId: 'muiTypography', props: { variant: 'h1', children: 'Hi' }, $id: 'label' },
        root: { nodes: ['label'], componentId: 'muiStack', $id: 'root' },
      },
    } as any
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: ordered },
      next: { nav: reordered },
    })
    expect(changes).toEqual([])
  })

  it('still sees a real change under a reordered node map', () => {
    // The order-insensitivity above must not become blindness: sorting keys
    // is meant to drop noise, not content.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: {
        nav: {
          rootId: 'root',
          nodes: {
            root: { $id: 'root', componentId: 'muiStack', nodes: ['label'] },
            label: { $id: 'label', componentId: 'muiTypography', props: { children: 'Hi' } },
          },
        } as any,
      },
      next: {
        nav: {
          rootId: 'root',
          nodes: {
            label: { props: { children: 'Bye' }, componentId: 'muiTypography', $id: 'label' },
            root: { nodes: ['label'], componentId: 'muiStack', $id: 'root' },
          },
        } as any,
      },
    })
    expect(changes.map((change) => change.kind)).toEqual(['updated'])
  })

  it('stays silent when only the editor ICON changed', () => {
    // Republishing a component to change its hierarchy glyph must not tell a
    // screen author their page changed — nothing drawn on it did.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: { ...definition('Home'), icon: { iconPath: 'M0 0' } } },
      next: { nav: { ...definition('Home'), icon: { iconPath: 'M1 1' } } },
    })
    expect(changes).toEqual([])
  })

  it('reports a declared-prop change', () => {
    // Props reach the graft, so an added prop does change what is drawn.
    const withProp = { ...definition('Home'), props: [{ name: 'label' }] } as any
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home') },
      next: { nav: withProp },
    })
    expect(changes.map((change) => change.kind)).toEqual(['updated'])
  })

  it('calls a first publish "appeared", not "updated"', () => {
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: {},
      next: { nav: definition('Home') },
    })
    expect(changes).toEqual([{ id: 'nav', name: 'nav', kind: 'appeared' }])
  })

  it('reports an unpublished or deleted component as removed', () => {
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home') },
      next: {},
    })
    expect(changes).toEqual([{ id: 'nav', name: 'nav', kind: 'removed' }])
  })

  it('still reaches a nested component through a definition just removed', () => {
    // The nav is gone from this snapshot, so walking CURRENT definitions
    // alone loses the button inside it at the moment it most needs saying.
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home', 'button'), button: definition('Go') },
      next: {},
    })
    expect(changes.map((change) => change.id).sort()).toEqual(['button', 'nav'])
  })

  it('falls back to the id when a name is not known', () => {
    const changes = diffRenderedComponentDefinitions({
      documents: [screen],
      previous: { nav: definition('Home') },
      next: { nav: definition('Start') },
      names: { nav: '' },
    })
    expect(changes[0].name).toBe('nav')
  })

  it('is safe on missing documents', () => {
    expect(
      diffRenderedComponentDefinitions({
        documents: [undefined, null],
        previous: { nav: definition('Home') },
        next: { nav: definition('Start') },
      }),
    ).toEqual([])
  })
})

describe('describeComponentPropagation (AGL-1898)', () => {
  it('names the component rather than counting them', () => {
    expect(
      describeComponentPropagation([
        { id: 'nav', name: 'Site nav', kind: 'updated' },
      ]),
    ).toBe(
      'Site nav was updated by its component — this page already shows the new version.',
    )
  })

  it('lists several', () => {
    expect(
      describeComponentPropagation([
        { id: 'nav', name: 'Site nav', kind: 'updated' },
        { id: 'cta', name: 'CTA', kind: 'appeared' },
      ]),
    ).toBe(
      'Site nav and CTA were updated by their components — this page already shows the new versions.',
    )
  })

  it('does not call a removal an update', () => {
    // Saying "updated" here sends the author hunting for a change that is
    // not on the page — the instance is drawing a placeholder.
    const line = describeComponentPropagation([
      { id: 'nav', name: 'Site nav', kind: 'removed' },
    ])
    expect(line).not.toMatch(/updated/)
    expect(line).toBe(
      'Site nav is no longer published, so this page shows a placeholder where it was.',
    )
  })

  it('says nothing for nothing', () => {
    expect(describeComponentPropagation([])).toBe('')
  })
})

describe('useComponentPropagationNotice (AGL-1898)', () => {
  const screen = { a: instance('a', 'nav') } as any

  const setup = (initial: Record<string, any> | undefined) => {
    const onPropagated = jest.fn()
    const view = renderHook(
      ({ definitions }: { definitions: Record<string, any> | undefined }) =>
        useComponentPropagationNotice({
          documents: [screen],
          definitions,
          names: { nav: 'Site nav' },
          onPropagated,
        }),
      { initialProps: { definitions: initial } },
    )
    return { onPropagated, view }
  }

  it('says nothing on the first settle', () => {
    // A page must not announce its own components on load.
    const { onPropagated } = setup({ nav: definition('Home') })
    expect(onPropagated).not.toHaveBeenCalled()
  })

  it('fires once when a snapshot changes a rendered component', () => {
    const { onPropagated, view } = setup({ nav: definition('Home') })
    view.rerender({ definitions: { nav: definition('Start') } })
    expect(onPropagated).toHaveBeenCalledTimes(1)
    expect(onPropagated).toHaveBeenCalledWith([
      { id: 'nav', name: 'Site nav', kind: 'updated' },
    ])
  })

  it('does not treat the loading state as an empty map', () => {
    // `undefined` means "not settled yet". Baselining against it would
    // report every component on the page as removed, then re-appeared.
    const { onPropagated, view } = setup(undefined)
    view.rerender({ definitions: { nav: definition('Home') } })
    expect(onPropagated).not.toHaveBeenCalled()
    view.rerender({ definitions: { nav: definition('Start') } })
    expect(onPropagated).toHaveBeenCalledTimes(1)
  })

  it('stays silent across an unrelated re-emit', () => {
    const { onPropagated, view } = setup({ nav: definition('Home') })
    view.rerender({ definitions: { nav: definition('Home') } })
    view.rerender({ definitions: { nav: definition('Home'), other: definition('x') } })
    expect(onPropagated).not.toHaveBeenCalled()
  })

  it('does not re-report a change on the next snapshot', () => {
    // The baseline has to advance even when nothing is reported, or the
    // same publish is announced again on every later snapshot.
    const { onPropagated, view } = setup({ nav: definition('Home') })
    view.rerender({ definitions: { nav: definition('Start') } })
    view.rerender({ definitions: { nav: definition('Start') } })
    expect(onPropagated).toHaveBeenCalledTimes(1)
  })
})
