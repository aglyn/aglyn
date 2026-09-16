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
 * A zone a PLUGIN hosts (AGL-2910): the shell hands its gated renderer down
 * through `ConsoleWidgetSlotContext`, and a plugin surface draws whatever it
 * is given. Two unrelated host plugins — a product editor and a booking
 * service editor — each host the listing zone, and widgets from two
 * unrelated plugins render in both, through the shell's renderer and its
 * enablement scoping. Outside a shell nothing renders.
 */

import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConsoleWidgetSlotContext,
  useConsoleWidgetSlot,
  type ConsoleWidgetSlotRenderer,
} from './console-widget-slot-context'
import {
  CONSOLE_WIDGET_SLOTS,
  listConsoleExtensions,
  listConsoleWidgets,
  registerConsoleExtension,
  unregisterConsoleExtension,
} from '../plugin-manager/feature-plugins'

/** A product editor in one plugin, hosting the listing zone. */
function ProductListingEditor(props: { name: string }): ReactElement {
  const Slot = useConsoleWidgetSlot()
  return createElement(
    'section',
    { 'data-host': 'product' },
    Slot
      ? createElement(Slot, {
          slot: CONSOLE_WIDGET_SLOTS.seoFields,
          subject: { kind: 'product', id: 'p1', name: props.name, description: '' },
        })
      : null,
  )
}

/** A booking service editor in another, hosting the same zone. */
function ServiceListingEditor(props: { name: string }): ReactElement {
  const Slot = useConsoleWidgetSlot()
  return createElement(
    'section',
    { 'data-host': 'service' },
    Slot
      ? createElement(Slot, {
          slot: CONSOLE_WIDGET_SLOTS.seoFields,
          subject: { kind: 'product', id: 's1', name: props.name, description: '' },
        })
      : null,
  )
}

function widget(label: string) {
  return function Widget(props: { subject: { name: string } }): ReactElement {
    return createElement('span', null, `${label}:${props.subject.name}`)
  }
}

describe('a zone hosted by a plugin (AGL-2910)', () => {
  beforeEach(() => {
    registerConsoleExtension({
      pluginId: 'acme-keywords',
      displayName: 'Keyword checker',
      widgets: [{ widgetId: 'keywords', slot: 'seoFields', Component: widget('keywords') }],
    })
    registerConsoleExtension({
      pluginId: 'ai',
      displayName: 'AI',
      widgets: [{ widgetId: 'ai-seo-fields', slot: 'seoFields', Component: widget('ai') }],
    })
  })

  afterEach(() => {
    for (const extension of listConsoleExtensions()) {
      unregisterConsoleExtension(extension.pluginId)
    }
  })

  /** The shell's renderer, reduced to its enablement scoping for the spec. */
  const shellRenderer =
    (enabled: string[]): ConsoleWidgetSlotRenderer =>
    ({ slot, ...props }) =>
      createElement(
        'div',
        { 'data-slot': slot },
        ...listConsoleWidgets(slot, enabled).map((entry) =>
          createElement(entry.widget.Component, { key: entry.widget.widgetId, ...props }),
        ),
      )

  const inShell = (enabled: string[], child: ReactElement) =>
    renderToStaticMarkup(
      createElement(ConsoleWidgetSlotContext.Provider, { value: shellRenderer(enabled) }, child),
    )

  it('renders every enabled plugin’s widget inside each host plugin’s surface', () => {
    const product = inShell(['acme-keywords', 'ai'], createElement(ProductListingEditor, { name: 'Mug' }))
    expect(product).toContain('data-slot="seoFields"')
    expect(product).toContain('keywords:Mug')
    expect(product).toContain('ai:Mug')

    const service = inShell(['acme-keywords', 'ai'], createElement(ServiceListingEditor, { name: 'Tune-up' }))
    expect(service).toContain('keywords:Tune-up')
    expect(service).toContain('ai:Tune-up')
  })

  it('applies the shell’s scoping: a widget whose plugin is not enabled is absent', () => {
    const markup = inShell(['acme-keywords'], createElement(ProductListingEditor, { name: 'Mug' }))
    expect(markup).toContain('keywords:Mug')
    expect(markup).not.toContain('ai:Mug')
  })

  it('renders nothing outside the console shell', () => {
    expect(renderToStaticMarkup(createElement(ProductListingEditor, { name: 'Mug' }))).toBe(
      '<section data-host="product"></section>',
    )
  })
})
