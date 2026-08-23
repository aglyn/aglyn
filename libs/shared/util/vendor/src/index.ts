/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export * from './lib/change-case'
export * from './lib/deep-equal'
export * from './lib/fuse'
export * from './lib/hoist-non-react-statics'
export * from './lib/mitt-emitter'
export * from './lib/object-deep-merge'
export * from './lib/object-flatten'
// platform-identification is NOT re-exported (AGL-2486). Nothing in the repo
// imports it — not the apps, not a plugin, not a tool — so its only effect
// was that every file taking anything at all from this index (and there are
// ten in the published page's eager graph alone, mostly for
// `hoistNonReactStatics`) also pulled in the `platform` UA-parsing package.
// Measured at -4.7 KB gz off the eager barrel graph. Still importable as
// `@aglyn/shared-util-vendor/platform-identification`.
export * from './lib/unique-identification'
export * from './lib/use-debounce'
