/**
 * @license
 * Copyright 2023 Aglyn LLC
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

export * from './vendor/emotion'
// `./vendor/jss` is NOT re-exported (AGL-2682), for the reason AGL-2486
// recorded on the shared-util-vendor barrel and measured the same way. Its two
// exports are `JSS` (the whole `jss` namespace) and `jssRtl`, and NOTHING in
// the repo reads either of them from this index. The one real consumer,
// `libs/shared/ui/jsx/src/lib/components/sandbox-frame.tsx`, imports `jss` and
// `jss-rtl` from the packages directly — and that component is deliberately
// absent from the shared-ui-jsx barrel, so it never reaches a published page.
//
// What the `export *` did instead was put `jss-rtl` — and through it
// `rtl-css-js`, a full CSS property/value mirroring table — in front of every
// file that takes anything at all from this index, which on the tenant is the
// host theme, both theme providers and the emotion cache: everything a
// customer page renders. Measured -7.9 KB raw off the published route's eager
// chunk group. `sandbox-frame` is the pattern to copy: import `jss` and
// `jss-rtl` where they are used.
export * from './vendor/mui'

export * from './lib/theme.types'
export * from './lib/constants'

export * from './lib/console.theme'

export * from './lib/components/host-theme-provider'
export * from './lib/components/theme-css-var-provider'

export * from './lib/hocs/create-with-emotion-client-cache'
export * from './lib/hocs/create-with-theme-provider'

export * from './lib/util/accent-text'
export * from './lib/util/accessible-shade'
export * from './lib/util/create-responsive-theme'
export * from './lib/util/emotion-cache'
export * from './lib/util/generate-component-class-keys'
export * from './lib/util/host-theme'
export * from './lib/util/layered-emotion-cache'
export * from './lib/util/merge-sx-props'
