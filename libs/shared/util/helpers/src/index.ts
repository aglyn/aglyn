/**
 * @license
 * Copyright 2021 Aglyn LLC
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

export * from './lib/gravatar'

export * from './vendor/change-case'
export * from './vendor/deep-equal'
export * from './vendor/deep-merge'
export * from './vendor/flatten-object'
export * from './vendor/mitt-emitter'
export * from './vendor/platform-identification'
export * from './vendor/search-fuzzy'
export * from './vendor/unique-identification'

// TODO: Replace dependents with direct lib import and remove below re-exports
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
export * from '../../guards/src/lib/guards'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
export * from '../../tools/src/lib/tools'
