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

// Imported through the lib root, not `./plugin-manager` directly. There is a
// cycle — plugin-manager → lifecycle → aglyn → `new PluginManager()` — and
// entering it at plugin-manager leaves the class undefined by the time the
// Aglyn singleton constructs ("_pluginManager.default is not a constructor").
// Entering at the root resolves it in the order the runtime does.
import { PluginManager, PluginStatus, type Plugin } from '../../index'

const bundle = (
  $id: string,
  dependencies: Record<string, true> | undefined,
  loaded: string[],
): Plugin => ({
  $id,
  displayName: $id,
  dependencies,
  load: () => loaded.push($id),
  destroy: () => undefined,
})

describe('PluginManager dependency ordering (AGL-759)', () => {
  it('loads a dependent registered BEFORE its dependency', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    // The order the console's loader actually produces: `ensure` activates
    // with Promise.all, and a feature module already cached from the console
    // surface registers well before the large mui bundle it depends on.
    manager.addDependency(bundle('email', { mui: true }, loaded))
    expect(manager.getDependencyStatus('email')).toBe(PluginStatus.WAITING)

    manager.addDependency(bundle('mui', undefined, loaded))

    expect(manager.getDependencyStatus('mui')).toBe(PluginStatus.LOADED)
    expect(manager.getDependencyStatus('email')).toBe(PluginStatus.LOADED)
    expect(loaded).toEqual(['mui', 'email'])
  })

  it('records the FIRST dependent, not only the ones after it', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    manager.addDependency(bundle('bookings', { mui: true }, loaded))
    manager.addDependency(bundle('commerce', { mui: true }, loaded))
    manager.addDependency(bundle('email', { mui: true }, loaded))

    // The regression: `dependencyDependentsById['mui'] ||= {}` evaluated to
    // the plain object being assigned rather than the observable copy MobX
    // stored, so the first write went to a detached object. Only `bookings`
    // — first in manifest order — was lost, which is why this looked like a
    // one-plugin mystery rather than a broken edge.
    expect(Object.keys(manager.getDependencyDependents('mui') ?? {}).sort()).toEqual(
      ['bookings', 'commerce', 'email'],
    )

    manager.addDependency(bundle('mui', undefined, loaded))
    expect(manager.getDependencyStatus('bookings')).toBe(PluginStatus.LOADED)
    expect(manager.getDependencyStatus('commerce')).toBe(PluginStatus.LOADED)
    expect(manager.getDependencyStatus('email')).toBe(PluginStatus.LOADED)
  })

  it('loads a dependent registered after its dependency, as before', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    manager.addDependency(bundle('mui', undefined, loaded))
    manager.addDependency(bundle('email', { mui: true }, loaded))

    expect(manager.getDependencyStatus('email')).toBe(PluginStatus.LOADED)
    expect(loaded).toEqual(['mui', 'email'])
  })

  it('leaves a dependent waiting while its dependency is absent', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    manager.addDependency(bundle('email', { mui: true }, loaded))

    expect(manager.getDependencyStatus('email')).toBe(PluginStatus.WAITING)
    expect(loaded).toEqual([])
  })

  it('cascades through a chain registered in reverse order', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    manager.addDependency(bundle('leaf', { middle: true }, loaded))
    manager.addDependency(bundle('middle', { mui: true }, loaded))
    manager.addDependency(bundle('mui', undefined, loaded))

    expect(loaded).toEqual(['mui', 'middle', 'leaf'])
  })

  it('reports a bundle stuck on a dependency that never registered', () => {
    const loaded: string[] = []
    const manager = new PluginManager()

    // `email` declares `mui`, which is never activated — the manifest/
    // enablement gap that survives the reverse-edge fix. Nothing crashes; the
    // bundle just sits WAITING with its components unregistered, which used to
    // read as an empty drawer. `getStuckDependencies` makes it legible so a
    // caller can say so.
    manager.addDependency(bundle('email', { mui: true }, loaded))

    expect(manager.getStuckDependencies()).toEqual([
      { id: 'email', waitingOn: ['mui'] },
    ])

    // Once the dependency arrives the bundle loads and nothing is stuck.
    manager.addDependency(bundle('mui', undefined, loaded))
    expect(manager.getStuckDependencies()).toEqual([])
  })
})
