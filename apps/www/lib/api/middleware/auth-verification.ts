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

import { _isUndef } from '@aglyn/shared/util/helpers'
import { Res, Logger } from '../helpers'
import {
  ApiHandler,
  ApiRequest,
  ApiResponse,
} from '../types'
import { verifyIdToken } from '../../firebase/fb-admin'


export const requireHeader = (
  name: string,
  key: keyof ApiRequest['headers'],
  handler: ApiHandler,
) => {
  return async (req: ApiRequest, res: ApiResponse) => {
    const newReq = req
    let error
    try {
      const header = req.headers[key]
      if (_isUndef(header)) {
        throw new Error(`Missing required header - (key: ${key})!`)
      }
      newReq[name] = header
      return
    } catch (err) {
      error = err
    } finally {
      if (error) {
        await handler(newReq, res)
      } else {
        const json = Res.Error.missingHeader
        Logger.traceError(json, error)
        return res.status(json.error.statusCode).json(json)
      }
    }
  }
}

export const withIdTokenHeader = (handler) => {
  return requireHeader('idToken', 'id-token', handler)
}

export const withCsrfTokenHeader = (handler) => {
  return requireHeader('csrfToken', 'csrf-token', handler)
}

export const requireIdToken = (handler: ApiHandler) => {
  return withIdTokenHeader(async (req, res) => {
    try {
      await verifyIdToken(req.idToken)
      return await handler(req, res)
    } catch (error) {
      const json = Res.Error.idTokenCheck
      Logger.traceError(json)
      return res.status(json.error.statusCode).json(json)
    }
  })
}

export const requireCsrfToken = (handler: ApiHandler) => {
  return withCsrfTokenHeader(async (req, res) => {
    try {
      if (req.csrfToken !== req.cookies.csrfToken) {
        throw new Error('CSRF mismatch. Possible break-in attempt!')
      }
      return await handler(req, res)
    } catch (error) {
      const json = Res.Error.csrfTokenCheck
      Logger.traceError(json, error)
      return res.status(json.error.statusCode).json(json)
    }
  })
}

export const secureRequest = (handler: ApiHandler, withCsrf?: boolean) => {
  return withCsrf ? requireIdToken(requireCsrfToken(handler)) : requireIdToken(handler)
}
