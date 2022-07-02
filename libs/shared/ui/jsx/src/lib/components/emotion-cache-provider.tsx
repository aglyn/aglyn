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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import {
  CacheProvider,
  createEmotionCache,
  CreateEmotionCacheOptions,
  type EmotionCache,
} from '@aglyn/shared-ui-theme'
import { useMemo } from 'react'

export type EmotionCacheProps = { children?: JSX.Children } & (
  | { emotionCache?: EmotionCache; cacheOptions?: never }
  | { cacheOptions?: CreateEmotionCacheOptions; emotionCache?: never }
)

const EmotionCacheProvider = (props: EmotionCacheProps) => {
  const { emotionCache, cacheOptions, children } = props

  const cache = useMemo(() => {
    if (emotionCache) return emotionCache
    return createEmotionCache({
      key: 'next',
      ...cacheOptions,
    })
  }, [emotionCache, cacheOptions])

  return <CacheProvider value={cache}>{children}</CacheProvider>
}
EmotionCacheProvider.displayName = 'EmotionCacheComponent'
EmotionCacheProvider.aglyn = true

export { EmotionCacheProvider }
export default EmotionCacheProvider
