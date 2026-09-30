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
 * A template's provenance, in the words of whoever installed it (AGL-3080).
 *
 * The library, a template's own page and the gallery used to spell one
 * installer's name. They read the compiled `templateSource` declarations
 * now, so this holds the badge to them — every declared source, whatever its
 * plugin is called — and holds the two answers a declaration cannot give: the
 * platform's own values, and a stamp no plugin in the build declares.
 */

import {
  AUTHORED_TEMPLATE_SOURCE,
  PLUGIN_TEMPLATE_SOURCES,
  STARTER_TEMPLATE_SOURCE,
} from '@aglyn/aglyn/plugin-manager/plugin-template-sources'
import {
  LIBRARY_TEMPLATE_SOURCE_TYPES,
  TEMPLATE_SOURCE_OPTIONS,
  templateSourceBadge,
} from './template-source-badge'

describe('templateSourceBadge', () => {
  it('names a template saved here, and one written before `source`, as saved here', () => {
    for (const source of [{ type: AUTHORED_TEMPLATE_SOURCE }, {}, undefined]) {
      expect(templateSourceBadge(source)).toEqual({
        label: 'Saved here',
        title: 'Saved from this site',
        color: 'default',
      })
    }
  })

  it('names a starter, and says when its copy was edited', () => {
    expect(templateSourceBadge({ type: STARTER_TEMPLATE_SOURCE }).label).toBe('Starter')
    expect(
      templateSourceBadge({ type: STARTER_TEMPLATE_SOURCE }, { editedAt: 1 }).label,
    ).toBe('Starter · edited')
  })

  it('names every declared installer in its own words', () => {
    // ANTI-VACUITY: a build with nothing declared would pass the loop below.
    expect(PLUGIN_TEMPLATE_SOURCES.length).toBeGreaterThan(0)
    for (const declared of PLUGIN_TEMPLATE_SOURCES) {
      expect(templateSourceBadge({ type: declared.type })).toEqual({
        label: declared.label,
        title: declared.description,
        color: 'primary',
      })
      expect(
        templateSourceBadge(
          { type: declared.type, version: 3 },
          { editedAt: 1, withVersion: true },
        ).label,
      ).toBe(`${declared.label} · v3 · edited`)
    }
  })

  it('reads a stamp no plugin in this build declares as installed, never as authored', () => {
    expect(templateSourceBadge({ type: 'gone-plugin' }, { editedAt: 1 })).toEqual({
      label: 'Installed · edited',
      title: 'Installed by a plugin',
      color: 'primary',
    })
  })
})

describe('what the library and the gallery ask for', () => {
  it('offers every stored value as a Source filter, labeled as its badge', () => {
    const values = TEMPLATE_SOURCE_OPTIONS.map((option) => option.value)
    expect(values).toEqual([
      ...PLUGIN_TEMPLATE_SOURCES.map((declared) => declared.type),
      STARTER_TEMPLATE_SOURCE,
      AUTHORED_TEMPLATE_SOURCE,
    ])
    for (const option of TEMPLATE_SOURCE_OPTIONS) {
      expect(templateSourceBadge({ type: option.value }).label).toBe(option.label)
    }
  })

  it('shelves a site’s own library as saved here or installed, never a starter', () => {
    expect(LIBRARY_TEMPLATE_SOURCE_TYPES).toEqual([
      AUTHORED_TEMPLATE_SOURCE,
      ...PLUGIN_TEMPLATE_SOURCES.map((declared) => declared.type),
    ])
  })
})
