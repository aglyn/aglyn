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


import type {ApiHandler, ApiRequest, ApiResponse} from '../types'


export {use as handleMiddleware} from 'next-api-middleware'


export type ApiMiddlewareGroup = (ApiMiddleware[] | ApiMiddleware)[]
export type UseApiMiddlewareResponse = (handler: ApiHandler) => ApiHandler
export type NextFn = () => Promise<void>

export interface ApiMiddleware {
  (req: ApiRequest, res: ApiResponse, next: NextFn): Promise<void>
}
