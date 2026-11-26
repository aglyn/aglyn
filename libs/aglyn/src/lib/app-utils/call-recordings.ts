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

// No React and no 'use client': read by the console's upload routes on the
// server and by the CRM's upload form in the browser alike.

/**
 * What an upload is for, when it is not a file for a page.
 *
 * `callRecording`: a recording of a call or a meeting, filed on a CRM
 * activity. Audio normally needs its uploader to confirm they own it or
 * hold a license (music, for a site's player); a call recording is not
 * published anywhere, so it is stored private instead and is not asked that
 * question — see {@link CALL_RECORDING_CONSENT_REQUIRED}.
 */
export type MediaUploadPurpose = 'callRecording'

/**
 * Whether a call recording's uploader is asked to confirm
 * {@link CALL_RECORDING_CONSENT_STATEMENT} before it uploads. OFF: the
 * owner's decision (2026-11-25) is that no consent answer is asked for now.
 * Turned on, the upload form shows the sentence and the server refuses a
 * call recording without the answer, storing it with who gave it and when.
 */
export const CALL_RECORDING_CONSENT_REQUIRED = false

/**
 * The sentence a call recording's uploader would confirm when
 * {@link CALL_RECORDING_CONSENT_REQUIRED} is on.
 */
export const CALL_RECORDING_CONSENT_STATEMENT =
  'Everyone on this call knew it was being recorded'

