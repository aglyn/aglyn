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
import { render } from '@testing-library/react'
import { BUNDLE_ID } from './constants/bundle-common'
import { CALCULATOR_BUNDLE, registerCalculatorPlugin } from './plugin'

/** Each surface, as it provides the two contexts a node reads (AGL-3067). */
const SURFACES = {
  published: { site: { hostId: 'host-1' }, links: { screens: {} } },
  preview: { site: { hostId: 'host-1', preview: true }, links: { screens: {}, suppressNavigation: true } },
  canvas: { site: {}, links: { screens: {}, suppressNavigation: true, editorInert: true } },
} as const satisfies Record<string, { site: Aglyn.SiteContextValue; links: Aglyn.ScreenLinkContextValue }>

const renderEmpty = (surface: keyof typeof SURFACES, id: string) => {
  const entry = CALCULATOR_BUNDLE.find((candidate) => candidate.schema.$id === id)
  if (!entry) throw new Error(`No registered element "${id}"`)
  const { site, links } = SURFACES[surface]
  const Component = entry.component
  return render(
    <Aglyn.SiteContext.Provider value={site}>
      <Aglyn.ScreenLinkContext.Provider value={links}>
        <Component />
      </Aglyn.ScreenLinkContext.Provider>
    </Aglyn.SiteContext.Provider>,
  )
}

describe('calculator plugin (AGL-3387, AGL-3394)', () => {
  it('keeps every persisted component id, in its namespace', () => {
    // Stored in screen documents: never rename without a document migration.
    expect(CALCULATOR_BUNDLE.map((entry) => entry.schema.$id)).toEqual([
      'aglyn.calculator.scope',
      'aglyn.calculator.input',
      'aglyn.calculator.result',
      'aglyn.calculator.showWhen',
      'aglyn.calculator.document',
      'aglyn.calculator.saveButton',
    ])
  })

  it('declares exactly what it registers in the manifest it publishes with', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require('../../manifest.json') as {
      contributes: { site: { components: string[]; functionBindings: Record<string, string> } }
    }
    expect(manifest.contributes.site.components).toEqual(
      CALCULATOR_BUNDLE.map((entry) => entry.schema.$id),
    )
    expect(manifest.contributes.site.functionBindings).toEqual({
      'aglyn.calculator.scope': 'functionName',
    })
  })

  it('keeps to the rules a signed bundle is held to when it registers (AGL-3390)', () => {
    const registry = Aglyn.components as unknown as Aglyn.RealmRegistry
    const before = Aglyn.snapshotRealmRegistry(registry)
    registerCalculatorPlugin()
    const problems = Aglyn.realmRegistrationProblems(
      before,
      Aglyn.snapshotRealmRegistry(registry),
      { identity: BUNDLE_ID },
    )
    expect(problems).toEqual([])
  })

  it('stamps every schema and preset with this bundle', () => {
    for (const entry of CALCULATOR_BUNDLE) {
      expect(entry.schema.pluginId).toBe(BUNDLE_ID)
      for (const preset of entry.presets ?? []) {
        expect(preset.pluginId).toBe(BUNDLE_ID)
        expect(preset.$id.startsWith(`${BUNDLE_ID}:`)).toBe(true)
      }
    }
  })

  it('lets nothing become a container by accident (AGL-1389)', () => {
    // Each puts the nodes it is given into its output: Show When
    // CONDITIONALLY, while the value it watches is true, the same shape
    // `muiTabPanel` has; the Document always, on the screen or not.
    expect(
      Aglyn.auditChildContract(CALCULATOR_BUNDLE, [
        'aglyn.calculator.document',
        'aglyn.calculator.scope',
        'aglyn.calculator.showWhen',
      ]),
    ).toEqual([])
  })

  it('keeps every container’s children through compose (AGL-1389)', () => {
    expect(
      Aglyn.auditComposeChildSurvival(Aglyn.listAcceptingComponentIds(CALCULATOR_BUNDLE)),
    ).toEqual([])
  })

  it('registers a mui-dependent bundle once, and no console surface', () => {
    registerCalculatorPlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [Aglyn.MUI_BUNDLE_ID]: true })
    expect(Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)).toBeUndefined()
    registerCalculatorPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })

  it('renders no element addressing the author on a published page (AGL-3067)', () => {
    const words = /\battributes?\b|renders? here|\bthis block\b|\bconsole\b|— (?:add|set|pick|choose|paste)\b/i
    for (const entry of CALCULATOR_BUNDLE) {
      const { container, unmount } = renderEmpty('published', entry.schema.$id)
      expect([entry.schema.$id, words.test(container.textContent ?? '')]).toEqual([entry.schema.$id, false])
      unmount()
    }
  })
})
