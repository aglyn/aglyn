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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { Component as ReactComponent, ComponentType } from 'react'
import {
  CacheProvider,
  createEmotionCache,
  CreateEmotionCacheOptions,
  EmotionCache,
} from '../../vendor/emotion'

export type InjectableEmotionCacheProps = {
  emotionCache?: EmotionCache
}

export type WithClientThemeCacheOptions = {
  emotionCache?: EmotionCache
  emotionCacheOptions?: CreateEmotionCacheOptions
}

export function withEmotionStylesCacheClient(options: WithClientThemeCacheOptions) {
  const { emotionCache, emotionCacheOptions } = options
  const defaultEmotionCache = emotionCache || createEmotionCache(emotionCacheOptions)

  return function <P>(Component: ComponentType<P>) {
    const displayName = `WithEmotionStylesCacheClient(${getDisplayName(Component)})`

    return class WithEmotionStylesCacheClient extends ReactComponent<
      P & InjectableEmotionCacheProps
    > {
      public static displayName: string = displayName
      public static WrappedComponent: ComponentType<P> = Component
      public static defaultEmotionCache: EmotionCache = defaultEmotionCache
      public injectedEmotionCache?: EmotionCache = null

      constructor(props) {
        super(props)
        this.injectedEmotionCache = props.emotionCache || null
      }

      public render(): React.ReactNode {
        const { emotionCache, ...rest } = this.props
        const cache = emotionCache || WithEmotionStylesCacheClient.defaultEmotionCache

        return (
          <CacheProvider value={cache}>
            <Component {...(rest as P)} />
          </CacheProvider>
        )
      }
    }
  }
}
export default withEmotionStylesCacheClient
