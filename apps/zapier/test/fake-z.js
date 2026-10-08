/**
 * @license
 * Copyright 2026 Aglyn LLC
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

'use strict'

/**
 * A stand-in for the `z` object zapier-platform-core hands an operation
 * (AGL-3643), so the app's specs run in the repo, where the platform package
 * is not installed. It runs the app's own `beforeRequest` and
 * `afterResponse` middleware around each request, as the platform does, and
 * answers from a route table — every call recorded.
 */

const app = require('../index')

class ZapierError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'Error'
    this.code = code
    this.status = status
  }
}
class ExpiredAuthError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ExpiredAuthError'
  }
}
class ThrottledError extends Error {
  constructor(message, delay) {
    super(message)
    this.name = 'ThrottledError'
    this.delay = delay
  }
}

/**
 * @param {Record<string, (call: object) => { status?: number, data?: unknown, headers?: object }>} routes
 *   keyed `METHOD /path` (no query); a route not listed answers 404.
 * @param {object} [bundle]
 */
function fakeZ(routes, bundle = { authData: { apiKey: 'aglyn_sk_test' } }) {
  const calls = []
  let cursor = ''
  const z = {
    errors: { Error: ZapierError, ExpiredAuthError, ThrottledError },
    cursor: {
      get: async () => cursor,
      set: async (value) => {
        cursor = value
      },
    },
    console,
    request: async (options) => {
      let request = { method: 'GET', headers: {}, ...options }
      for (const middleware of app.beforeRequest) request = middleware(request, z, bundle)
      const url = new URL(request.url)
      const key = `${request.method} ${url.pathname}`
      const call = {
        method: request.method,
        url: request.url,
        path: url.pathname,
        params: request.params || {},
        body: request.body,
        headers: request.headers,
      }
      calls.push(call)
      const route = routes[key]
      const answer = route ? route(call) : { status: 404, data: { error: { type: 'not_found', message: 'Not found' } } }
      const headers = answer.headers || {}
      let response = {
        status: answer.status || 200,
        data: answer.data,
        request,
        getHeader: (name) => headers[name] || headers[String(name).toLowerCase()],
      }
      for (const middleware of app.afterResponse) response = middleware(response, z, bundle)
      return response
    },
  }
  return { z, calls, bundle }
}

module.exports = { fakeZ, ZapierError, ExpiredAuthError, ThrottledError }
