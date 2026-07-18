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
import { HttpStatusCode } from '@aglyn/shared-data-enums'
import getAllowedHeaders from './get-allowed-headers'
import getOriginHeadersFromRequest from './get-origin-headers-from-request'
import type { CorsOptions } from './types'

// Deny-by-default (AGL-520): callers must opt into an origin or allowlist
// rather than inheriting `*`, so this helper can never silently expose an
// authenticated endpoint cross-origin.
const defaultOptions: CorsOptions = {
  origin: false,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  preflightContinue: false,
  optionsSuccessStatus: HttpStatusCode.NO_CONTENT,
}

/**
 * Handle cors for HTTP requests
 * @example - pages/middleware.ts
 * export function middleware(req: NextRequest) {
 *   // `cors` also takes care of handling OPTIONS requests
 *   return cors(
 *     req,
 *     new Response(JSON.stringify({ message: 'Hello World!' }), {
 *       status: 200,
 *       headers: { 'Content-Type': 'application/json' },
 *     })
 *   )
 * }
 * @param req - HTTP {@link Request} object
 * @param res - HTTP {@link Response} object
 * @param options - optional object of {@link CorsOptions}
 * @returns the modified {@link Response} object to send answer the request
 * @see {@link corsBuildResponseHandler} when reusing same {@link CorsOptions}
 */
export async function corsHandleResponse(
  req: Request,
  res: Response,
  options?: CorsOptions,
) {
  const opts = { ...defaultOptions, ...options }
  const { headers } = res
  const originHeaders = await getOriginHeadersFromRequest(
    req,
    opts.origin ?? false,
  )
  const mergeHeaders = (v: string, k: string) => {
    if (k === 'Vary') headers.append(k, v)
    else headers.set(k, v)
  }

  // If there's no origin we won't touch the response
  if (!originHeaders) return res

  originHeaders.forEach(mergeHeaders)

  if (opts.credentials) {
    // Never pair credentials with a wildcard origin (AGL-520): browsers
    // reject it, and honoring it would be a serious cross-origin leak.
    if (opts.origin === '*') {
      console.error(
        'CORS: refusing Access-Control-Allow-Credentials with origin "*"',
      )
    } else {
      headers.set('Access-Control-Allow-Credentials', 'true')
    }
  }

  const exposed = Array.isArray(opts.exposedHeaders)
    ? opts.exposedHeaders.join(',')
    : opts.exposedHeaders

  if (exposed) {
    headers.set('Access-Control-Expose-Headers', exposed)
  }

  // Handle the preflight request
  if (req.method === 'OPTIONS') {
    if (opts.methods) {
      const methods = Array.isArray(opts.methods)
        ? opts.methods.join(',')
        : opts.methods

      headers.set('Access-Control-Allow-Methods', methods)
    }

    getAllowedHeaders(req, opts.allowedHeaders).forEach(mergeHeaders)

    if (typeof opts.maxAge === 'number') {
      headers.set('Access-Control-Max-Age', String(opts.maxAge))
    }

    if (opts.preflightContinue) return res

    headers.set('Content-Length', '0')
    return new Response(null, { status: opts.optionsSuccessStatus, headers })
  }

  // If we got here, it's a normal request
  return res
}

export default corsHandleResponse
