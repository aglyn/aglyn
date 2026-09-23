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

// lockdown-423: exempt — serves the platform's first-touch capture and seals or opens anonymous attribution tokens for its own hosts; it writes nothing and acts for no user, organization or site, so no verdict has a scope to bind to
import {
  firstTouchHandoffResponse,
  firstTouchPreflightResponse,
  firstTouchScriptResponse,
} from '@aglyn/tenant-data-admin/server/first-touch-route'

/**
 * The first-touch capture (AGL-3289), served where this app's own pages can
 * load it without leaving their origin: GET is the script a first-party
 * page includes, POST seals and opens the hand-off a hop between our hosts
 * carries. Everything it does lives in the shared route module, so the
 * console and the tenant answer identically.
 */
export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  return firstTouchScriptResponse(request)
}

export function POST(request: Request): Promise<Response> {
  return firstTouchHandoffResponse(request)
}

export function OPTIONS(request: Request): Promise<Response> {
  return firstTouchPreflightResponse(request)
}
