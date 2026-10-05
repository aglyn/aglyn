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

import { serveSelfHostedFont } from '@aglyn/tenant-runtime/self-hosted-fonts'

/**
 * A theme font file from the site's own origin (AGL-3485). The page inlines
 * its theme's `@font-face` rules with every `src` here, so nothing on a
 * published page asks Google for anything; see `serveSelfHostedFont` for what
 * this answers and how long it may be kept.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  return serveSelfHostedFont((path ?? []).join('/'))
}
