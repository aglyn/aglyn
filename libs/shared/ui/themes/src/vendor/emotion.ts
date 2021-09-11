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

import createCache, { Options } from '@emotion/cache'
import { CacheProvider, EmotionCache } from '@emotion/react'
import createInstance, { EmotionServer } from '@emotion/server/create-instance'


export {
  CacheProvider,
  EmotionCache,
  EmotionServer,
}

export type CreateEmotionCacheOptions = Options

export function createEmotionCache(options?: CreateEmotionCacheOptions) {
  return createCache({
    key: 'css',
    ...options,
  }) as unknown as EmotionCache
}


export function createEmotionServer(...args: Parameters<typeof createInstance>) {
  return createInstance(...args)
}
