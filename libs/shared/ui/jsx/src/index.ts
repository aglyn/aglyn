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

export * from './lib/components/app-link'
export * from './lib/components/aspect-ratio'
export * from './lib/components/background-image.component'
export * from './lib/components/card-display'
export * from './lib/components/card-list-item'
export * from './lib/components/data-table.component'
export * from './lib/components/children-function-prop'
export * from './lib/components/confirmation-provider.component'
export * from './lib/components/container'
export * from './lib/components/dialog-confirm'
export * from './lib/components/ellipsis-pulse.component'
export * from './lib/components/emotion-cache-provider'
export type { EmotionCacheProps } from './lib/components/emotion-cache-provider'
export * from './lib/components/error-boundary.component'
export * from './lib/components/grid-buttons'
export * from './lib/components/grid-items'
export * from './lib/components/grid-list'
export * from './lib/components/help-tip.component'
export * from './lib/components/loading-layout.component'
export * from './lib/components/loading-modal'
export * from './lib/components/loading-text.component'
export * from './lib/components/menu'
export * from './lib/components/mui-shadow-dom'
export * from './lib/components/navigation-drawer.component'
export * from './lib/components/navigation-view'
export * from './lib/components/next-link'
export * from './lib/components/popper-styled.component'
export * from './lib/components/resizeable-stack'
export * from './lib/components/ruler-guides.component'
export * from './lib/components/sandbox-frame'
export * from './lib/components/scroll-reaction'
export * from './lib/components/shadow-dom'
export * from './lib/components/splash-screen'
export * from './lib/components/sr-only'
export * from './lib/components/zoomable-panning-component'

export * from './lib/contexts/confirmation.context'
export * from './lib/contexts/loading.context'

export * from './lib/hooks/router-events'
export * from './lib/hooks/use-callback-param-ref'
export * from './lib/hooks/use-async-effect'
export * from './lib/hooks/use-client-rect'
export * from './lib/hooks/use-debounce'
export * from './lib/hooks/use-debounced-transition'
export * from './lib/hooks/use-effect-post-mount'
export * from './lib/hooks/use-element-position'
export * from './lib/hooks/use-id'
export * from './lib/hooks/use-observer-intersection'
export * from './lib/hooks/use-interval'
export * from './lib/hooks/use-isomorphic-layout-effect'
export * from './lib/hooks/use-local-storage-item-state'
export * from './lib/hooks/use-merge-refs'
export * from './lib/hooks/use-mouse-enter'
export * from './lib/hooks/use-mouse-over'
export * from './lib/hooks/use-mouse-position'
export * from './lib/hooks/use-observer-mutation'
export * from './lib/hooks/use-node-property'
export * from './lib/hooks/use-on-mouse-enter'
export * from './lib/hooks/use-on-mouse-over'
export * from './lib/hooks/use-observer-resize'
export * from './lib/hooks/use-subscribable'
export * from './lib/hooks/use-tag-name'
export * from './lib/hooks/use-timeout'
export * from './lib/hooks/use-timeout-delay'

export * from './lib/const/prebuilt-components'
export * from './lib/const/svg-icons'

export * from './lib/hocs/create-hoc-with-context-consumer'
export * from './lib/hocs/with-hoc'

export * from './lib/utils/make-link-elements'
export * from './lib/utils/make-meta-elements'
export * from './lib/utils/vendor'

export * from './lib/types'

export * from './lib/hooks/mdi-icon/use-mdi-icon'
export * from './lib/hooks/mdi-icon/use-mdi-icons'
export * from './lib/hooks/mdi-icon/use-mdi-icons-fuzzy'

export * from './lib/components/mdi-icon/mdi-icon'
export * from './lib/components/mdi-icon/mdi-icon-from-id'

export * from '@aglyn/shared-data-mdi'

// import dynamic from 'next/dynamic'
// export const MdiIconFromId = dynamic(
//   () => import('./components/mdi-svg-icon'),
//   {loading: () => (<span />)},
// )
// MdiIconFromId.displayName = 'MdiIconFromId'
// MdiIconFromId.aglyn = true
