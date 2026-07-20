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

import { validateHostAction } from '@aglyn/aglyn'
import {
  buildPresetInteractionDrafts,
  collectPresetRefIds,
} from './preset-interactions'

// The authored preset data tree and the inserted live subtree walk in
// lockstep (createDuplicateNode preserves child order), so the fixtures
// mirror the Dropdown Panel preset shape (AGL-589).
const presetData = {
  $id: null,
  presetRef: 'wrapper',
  componentId: 'muiStack',
  nodes: [
    { $id: null, presetRef: 'trigger', componentId: 'muiButton' },
    {
      $id: null,
      presetRef: 'panel',
      componentId: 'muiStack',
      nodes: [{ $id: null, componentId: 'muiTypography' }],
    },
  ],
} as any

const liveNode = {
  $id: 'w1',
  componentId: 'muiStack',
  children: [
    { $id: 't1', componentId: 'muiButton', children: [] },
    {
      $id: 'p1',
      componentId: 'muiStack',
      children: [{ $id: 'x1', componentId: 'muiTypography', children: [] }],
    },
  ],
} as any

const preset = {
  $id: 'test:dropdown-panel',
  data: presetData,
  interactions: [
    {
      name: 'Dropdown panel — open on hover',
      event: 'elementHoverEnter',
      triggerRef: 'wrapper',
      steps: [
        {
          type: 'showElement',
          targetRef: 'panel',
          dismissOn: ['escape', 'outsideClick'],
        },
      ],
    },
    {
      name: 'Dropdown panel — close on hover leave',
      event: 'elementHoverLeave',
      triggerRef: 'wrapper',
      steps: [{ type: 'hideElement', targetRef: 'panel', delayMs: 250 }],
    },
  ],
} as any

describe('collectPresetRefIds', () => {
  it('maps presetRef markers to minted ids by positional walk', () => {
    expect(collectPresetRefIds(presetData, liveNode)).toEqual({
      wrapper: 'w1',
      trigger: 't1',
      panel: 'p1',
    })
  })

  it('ignores unmarked nodes and tolerates missing branches', () => {
    const partialLive = { $id: 'w1', children: [] } as any
    expect(collectPresetRefIds(presetData, partialLive)).toEqual({
      wrapper: 'w1',
    })
    expect(collectPresetRefIds(undefined, liveNode)).toEqual({})
    expect(collectPresetRefIds(presetData, undefined)).toEqual({})
  })
})

describe('buildPresetInteractionDrafts', () => {
  it('materializes templates into selector-resolved drafts', () => {
    const drafts = buildPresetInteractionDrafts(preset, liveNode)
    expect(drafts).toEqual([
      {
        name: 'Dropdown panel — open on hover',
        event: 'elementHoverEnter',
        selector: '[data-aglyn="leaf:w1"]',
        steps: [
          {
            type: 'showElement',
            selector: '[data-aglyn="leaf:p1"]',
            dismissOn: ['escape', 'outsideClick'],
          },
        ],
      },
      {
        name: 'Dropdown panel — close on hover leave',
        event: 'elementHoverLeave',
        selector: '[data-aglyn="leaf:w1"]',
        steps: [
          {
            type: 'hideElement',
            selector: '[data-aglyn="leaf:p1"]',
            delayMs: 250,
          },
        ],
      },
    ])
  })

  it('produces drafts that survive host-action validation', () => {
    for (const draft of buildPresetInteractionDrafts(preset, liveNode)) {
      const problem = validateHostAction({
        name: draft.name,
        trigger: {
          event: draft.event,
          selector: draft.selector,
          everyTime: true,
        },
        steps: draft.steps,
        enabled: true,
      } as any)
      expect(problem).toBeNull()
    }
  })

  it('drops templates whose refs no longer resolve instead of writing broken actions', () => {
    const renamed = {
      ...preset,
      interactions: [
        {
          name: 'Stale trigger ref',
          event: 'elementHoverEnter',
          triggerRef: 'gone',
          steps: [{ type: 'showElement', targetRef: 'panel' }],
        },
        {
          name: 'Stale step ref',
          event: 'elementHoverEnter',
          triggerRef: 'wrapper',
          steps: [{ type: 'showElement', targetRef: 'gone' }],
        },
      ],
    }
    expect(buildPresetInteractionDrafts(renamed, liveNode)).toEqual([])
  })

  it('returns nothing for presets without templates or without a live node', () => {
    expect(buildPresetInteractionDrafts({ data: presetData } as any, liveNode)).toEqual([])
    expect(buildPresetInteractionDrafts(preset, undefined)).toEqual([])
  })
})
