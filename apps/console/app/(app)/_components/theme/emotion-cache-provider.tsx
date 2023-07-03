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
'use client'

import createCache, {
  type EmotionCache,
  type Options as OptionsOfCreateCache,
} from '@emotion/cache'
import { CacheProvider as DefaultCacheProvider } from '@emotion/react'
import { useServerInsertedHTML } from 'next/navigation'
import { useState } from 'react'

export type CacheProviderOverride = {
  (props: { value: EmotionCache; children: JSX.Children }): JSX.Element | null
}

export interface EmotionCacheProviderProps {
  /** This is the options passed to createCache() from 'import createCache from "@emotion/cache"' */
  options: Omit<OptionsOfCreateCache, 'insertionPoint'>
  CacheProvider?: CacheProviderOverride
  children: JSX.Children
}

// This implementation is taken from
// https://github.com/garronej/tss-react/blob/main/src/next/appDir.tsx
export default function EmotionCacheProvider(props: EmotionCacheProviderProps) {
  const { options, CacheProvider = DefaultCacheProvider, children } = props

  const [{ cache, flush }] = useState(() => {
    const cache = createCache(options)
    cache.compat = true
    const prevInsert = cache.insert
    let inserted: string[] = []
    cache.insert = (...args) => {
      const serialized = args[1]
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name)
      }
      return prevInsert(...args)
    }

    const flush = () => {
      const prevInserted = inserted
      inserted = []
      return prevInserted
    }
    return { cache, flush }
  })

  useServerInsertedHTML(() => {
    const names = flush()
    if (names.length === 0) {
      return null
    }
    let styles = ''
    // eslint-disable-next-line no-restricted-syntax
    for (const name of names) {
      styles += cache.inserted[name]
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: styles,
        }}
      />
    )
  })

  return <CacheProvider value={cache}>{children}</CacheProvider>
}
