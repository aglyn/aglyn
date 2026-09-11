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

// The release flags the primary e2e org holds as per-org overrides, stored at
// `orgs/{orgId}.releaseFlags` (AGL-1635) and written there by `seed-e2e.mjs`.
//
// ## Video uploads (AGL-2830)
//
// `release_video_uploads` ships off, and while it is off every path that
// stores a video refuses one with 403 `video_uploads_paused`: the media library
// drops the file before a byte is sent, and the upload, signed-upload, replace
// and /v1 routes refuse it on the server. `npm run e2e:dam` uploads two films as
// this org, so without the grant its first step never gets a film document and
// the checks that inspect the film have nothing to inspect.
//
// The grant is the override staff make for one customer, and the console and
// every server gate resolve it the same way. Nothing is switched on for the
// platform and no gate is loosened: an org the seed gives no override inherits
// the flag's default and is still refused.
// `apps/console/specs/video-upload-e2e-org-grant.spec.ts` holds both halves.
//
// No imports, so that spec can load this module in plain node.

export const E2E_ORG_RELEASE_FLAGS = {
  release_video_uploads: true,
}
