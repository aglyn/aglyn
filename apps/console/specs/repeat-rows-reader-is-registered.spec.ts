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

import {
  declaredRepeatSource,
  readRepeatRows,
  repeatRowReader,
  RepeatRowsUnavailableError,
  resetRepeatRowReadersForTests,
} from '@aglyn/aglyn/plugin-manager/repeat-rows'

/**
 * A REPEAT'S ROWS HAVE A READER IN THIS APP'S SERVER PROCESSES (AGL-3080).
 *
 * The composition that renders a page — here, the console's previews and
 * its revalidation — asks `readRepeatRows` for the rows an element repeats over and names no
 * collection itself. The plugin that keeps the rows registers the reader from
 * its `serverDeclarations` entry, and `plugins.config.json` declares the same
 * source, so a boot that skipped the registration THROWS instead of rendering
 * every list as one row. This is the spec that finds out if boot stopped
 * registering it, before a customer's page does.
 *
 * ⚑ It runs THIS APP'S OWN boot manifest, reached the way the app reaches it,
 * and never imports the plugin: an app may not depend on a plugin, and a
 * dynamic first-party import here would register a lazy nx graph edge that
 * breaks every static import of that library in other projects (AGL-2282).
 *
 * ⛔ The boot runs ONCE and the answers are captured around it: the manifest
 * memoizes, so a reset between tests would leave later ones asserting against
 * a boot that never runs again.
 */

import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

let readerBeforeBoot: ReturnType<typeof repeatRowReader>
let refusalBeforeBoot: unknown
let readerAfterBoot: ReturnType<typeof repeatRowReader>

beforeAll(async () => {
  resetRepeatRowReadersForTests()
  const source = declaredRepeatSource()
  readerBeforeBoot = source ? repeatRowReader(source.id) : null
  refusalBeforeBoot = await readRepeatRows({ hostId: 'h1', keys: ['Team'] }).catch(
    (error: unknown) => error,
  )
  await registerPluginServerDeclarations()
  readerAfterBoot = source ? repeatRowReader(source.id) : null
})

describe('the plugin that answers a repeat, in this app', () => {
  it('THE CONTROL: with boot not run, a repeat is refused rather than emptied', () => {
    // Everything below would pass against a boot that registered nothing if
    // the registry happened to be filled already.
    expect(readerBeforeBoot).toBeNull()
    expect(refusalBeforeBoot).toBeInstanceOf(RepeatRowsUnavailableError)
  })

  it('registers a reader at boot, from the plugin the config declares', () => {
    expect(declaredRepeatSource()?.pluginId).toBe('data')
    expect(readerAfterBoot?.pluginId).toBe(declaredRepeatSource()?.pluginId)
    expect(typeof readerAfterBoot?.reader).toBe('function')
  })
})
