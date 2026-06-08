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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import type { ComponentType } from 'react'
import {
  CacheProvider,
  createEmotionCache,
  type CreateEmotionCacheOptions,
  type EmotionCache,
} from '../../vendor/emotion'

export type InjectedEmotionCacheProps = {
  emotionCache?: EmotionCache
}

export type WithEmotionClientCacheOptions = {
  emotionCache?: EmotionCache
  emotionCacheOptions?: CreateEmotionCacheOptions
}

export function createWithEmotionClientCache(
  options: WithEmotionClientCacheOptions,
) {
  const { emotionCache, emotionCacheOptions } = options
  const defaultEmotionCache =
    emotionCache || createEmotionCache(emotionCacheOptions)

  return function withEmotionClientCache<P>(
    WrappedComponent: ComponentType<P>,
  ) {
    const displayName = getDisplayName(WrappedComponent)

    function WithEmotionClientCache(props: InjectedEmotionCacheProps & P) {
      const { emotionCache, ...rest } = props
      const cache = emotionCache || defaultEmotionCache

      return (
        <CacheProvider value={cache}>
          <WrappedComponent {...(rest as P)} />
        </CacheProvider>
      )
    }
    WithEmotionClientCache.name = `WithEmotionClientCache(${displayName})`
    hoistNonReactStatics(WithEmotionClientCache, WrappedComponent)

    return WithEmotionClientCache

    //   return class WithEmotionStylesCacheClient extends Component<P &
    // InjectedEmotionCacheProps> { public static displayName: string = displayName public static
    // WrappedComponent: ComponentType<P> = WrappedComponent public static defaultEmotionCache:
    // EmotionCache = defaultEmotionCache public injectedEmotionCache?: EmotionCache = null
    // constructor(props) { super(props) this.injectedEmotionCache = props.emotionCache || null }
    // public render() { const {emotionCache, ...rest} = this.props const cache = emotionCache ||
    // WithEmotionStylesCacheClient.defaultEmotionCache const WrappedComponent =
    // WithEmotionStylesCacheClient.WrappedComponent  return ( <CacheProvider value={cache}>
    // <WrappedComponent {...(rest as P)} /> </CacheProvider> ) } }
  }
}
export default createWithEmotionClientCache
