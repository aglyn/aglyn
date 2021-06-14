/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */


import { ApiHandler, ApiRequest, ApiResponse } from '../types'
import { use } from 'next-api-middleware'


export type ApiMiddlewareGroup = (ApiMiddleware[] | ApiMiddleware)[]
export type UseApiMiddlewareResponse = (handler: ApiHandler) => ApiHandler
export type NextFn = () => Promise<void>

export interface ApiMiddleware {
  (req: ApiRequest, res: ApiResponse, next: NextFn): Promise<void>
}

export interface UseApiMiddlewareGroup {
  (...middleware: ApiMiddlewareGroup): UseApiMiddlewareResponse
}

export function handleMiddleware(...middleware: ApiMiddlewareGroup): UseApiMiddlewareResponse {
  return use(...middleware)
}
