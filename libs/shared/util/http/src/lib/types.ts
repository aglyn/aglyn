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
import type {HttpStatusCode} from '@aglyn/shared-data-enums'
import type {NextApiRequest} from 'next'


export type StaticOrigin = boolean | string | RegExp | (boolean | string | RegExp)[]

export type OriginFn = (
  origin: string[] | string | undefined,
  request: Request | NextApiRequest,
) => StaticOrigin | Promise<StaticOrigin>

export interface CorsOptions {
  origin?: StaticOrigin | OriginFn
  methods?: string | string[]
  allowedHeaders?: string | string[]
  exposedHeaders?: string | string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
  optionsSuccessStatus?: HttpStatusCode
}
