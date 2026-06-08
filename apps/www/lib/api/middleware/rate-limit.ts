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

import LRUCache from 'lru-cache'
import type {NextApiRequest, NextApiResponse} from 'next'
import {type Middleware} from 'next-api-middleware'
import {Res} from '../helpers'


export interface RateLimiter<K = string, V = any> {
  getTokenCache: () => LRUCache<K, V>
  checkLimit: (res: NextApiResponse, token?: string, limit?: number) => Promise<void>
}

export interface RateLimiterOptions<K, V> extends LRUCache.Options<K, V> {
  limit?: number
  token?: string
}

export function createRateLimiter<K, V>(options?: RateLimiterOptions<K, V>): RateLimiter<K, V> {
  const {limit: _limit, max: _max, maxAge: _maxAge, token: _token, ...opts} = options
  const max = _max ?? 100 /* 100 users per second */
  const maxAge = _maxAge ?? 60000 /* 60 seconds */
  const limit = _limit ?? 10 /* 10 requests per minute */
  const token = _token ?? 'CACHE_TOKEN' /* Key inside LRUCache */
  const tokenCache = new LRUCache<K, V>({max, maxAge, ...opts})
  const getTokenCache = (): LRUCache<K, V> => {
    return tokenCache
  }
  const checkLimit = (
    res: NextApiResponse,
    cacheToken: string = token,
    maxLimit: number = limit,
  ): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const tokenCount = tokenCache.get(cacheToken as unknown as K) ?? [0] as unknown as V
      if (tokenCount[0] === 0) {
        tokenCache.set(cacheToken as unknown as K, tokenCount)
      }
      tokenCount[0] += 1
      const currentUsage = tokenCount[0]
      const isLimited = currentUsage >= maxLimit
      res.setHeader('X-RateLimit-Limit', maxLimit)
      res.setHeader('X-RateLimit-Remaining', isLimited ? 0 : maxLimit - currentUsage)
      return isLimited ? reject() : resolve()
    })
  }

  return {
    getTokenCache,
    checkLimit,
  }
}

export function rateLimiterFactory<K, V>(options?: RateLimiterOptions<K, V>): Middleware {
  const rateLimiter = createRateLimiter<K, V>(options)

  return async (req: NextApiRequest, res: NextApiResponse, next) => {
    let fail
    try {
      await rateLimiter.checkLimit(res)
    }
    catch (error) {
      fail = true
      const json = Res.Error.rateLimitCheck
      res.status(json.error.statusCode).json(json)
    }
    finally {
      if (!fail) {
        await next()
      }
    }
  }
}
