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

import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin'
import {
  isVideoUploadType,
  VIDEO_UPLOADS_PAUSED_CODE,
  VIDEO_UPLOADS_PAUSED_MESSAGE,
  VIDEO_UPLOADS_RELEASE_FLAG,
} from '../media-upload-limits'

/**
 * Whether this org may store a new video (AGL-2830).
 *
 * The verdict is the `release_video_uploads` release flag with per-org
 * overrides applied, resolved the way the tenant runtime and both API
 * dispatchers resolve flags, so a grant made to one org reaches every ingress
 * route at once.
 *
 * There is deliberately no staff preview. Most release-flagged routes let a
 * staff session through, but a video a staff member uploads into a customer's
 * library is served on that customer's pages exactly like one they uploaded
 * themselves, which is the delivery exposure the flag holds shut. A grant is
 * therefore made to the org, where the override route audits it.
 *
 * Fails shut: the flag is OFF by default, and a Remote Config read that fails
 * resolves to that default.
 */
export async function videoUploadsOpenForOrg(
  orgId: string | null | undefined,
): Promise<boolean> {
  return isServerReleaseFlagOnForOrg(VIDEO_UPLOADS_RELEASE_FLAG, orgId)
}

/**
 * The refusal an ingress route returns for a video while uploads are paused,
 * or `null` for anything it should go on to store: every image and document,
 * and any video once the flag is on for the org.
 *
 * The flag is read only for a video, so an image upload never waits on it.
 * `403` with a `code`, because nothing about the request is malformed — the
 * same file is accepted the moment the flag opens — and the console renders
 * `error` as the notice.
 */
export async function videoUploadPausedRefusal(options: {
  contentType: string
  orgId: string | null | undefined
}): Promise<Response | null> {
  if (!isVideoUploadType(options.contentType)) return null
  if (await videoUploadsOpenForOrg(options.orgId)) return null
  return Response.json(
    { error: VIDEO_UPLOADS_PAUSED_MESSAGE, code: VIDEO_UPLOADS_PAUSED_CODE },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  )
}
