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
 * `computedFn`, and only `computedFn` (AGL-2706).
 *
 * `mobx-utils`'s package entry is `mobx-utils.module.js`, a single 68 KB
 * rollup bundle of the library's forty-odd helpers. The package declares
 * `sideEffects: false`, but a declaration is a permission to drop code, not
 * an ability to: measured from the tenant route's production source maps,
 * **14.0 KB raw** of that bundle was emitted onto every published customer
 * page for the one memoizer four modules import — `canvas-manager`,
 * `components-manager`, the besigner's `focus-manager`, and the loading
 * context.
 *
 * `lib/computedFn` is the same code from the same package, published
 * alongside the bundle, reaching only `lib/deepMap` and `mobx` itself.
 *
 * The deep path lives HERE rather than at the four call sites for the reason
 * `object-deep-fill-in` and `deep-equal` do: a package's internal layout is a
 * thing to depend on in one place, so a version that moves the file is one
 * edit rather than a hunt. Jest resolves the same specifier, which is why
 * `mobx-utils` is on the preset's transform allowlist — `lib/` is ESM inside
 * a package that does not declare `"type": "module"`.
 *
 * NOT re-exported from this library's index, per the note there.
 */
export {
  computedFn,
  type IComputedFnOptions,
} from 'mobx-utils/lib/computedFn'
