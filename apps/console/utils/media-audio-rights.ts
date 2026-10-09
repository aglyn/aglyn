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

import { isAudioUploadType } from './media-upload-limits'

/**
 * The rights confirmation an audio upload carries (AGL-3716).
 *
 * The media library takes audio so a site can play its owner's own music in
 * the Music player. Music is the file type most often uploaded without the
 * right to publish it, so every ingress route — the direct upload, the signed
 * upload's mint and finalize, replace and `/v1/media` — refuses an audio file
 * unless the person sending it says, in the request, that they own it or hold
 * a license for it. The answer is stored on the asset with who gave it and
 * when, which is what a takedown review reads first.
 *
 * Client-safe: the library's upload dialog shows the same sentence.
 */

/** The sentence the uploader confirms, word for word, and stored with the answer. */
export const AUDIO_RIGHTS_STATEMENT =
  'I own this audio or have a license to use it on my site'

/** The `code` on a refusal for a missing confirmation. */
export const AUDIO_RIGHTS_REQUIRED_CODE = 'audio_rights_required'

/** What a person is told when an audio upload arrives without one. */
export const AUDIO_RIGHTS_REQUIRED_MESSAGE =
  'Confirm that you own this audio or have a license to use it on your site ' +
  'before uploading it.'

/** The request field that carries the answer. */
export const AUDIO_RIGHTS_FIELD = 'rightsConfirmed'

/** The confirmation as the asset document stores it. */
export interface MediaRightsConfirmation {
  /** Who confirmed: a uid, or `api:<key id>` from the REST API. */
  uid: string
  atMs: number
  statement: string
}

/** Why an audio upload is refused, as a route answers it. */
export interface AudioRightsRefusalReason {
  status: 400
  message: string
  code: string
}

/**
 * The fields an upload writes, and the refusal when it is refused: `refusal`
 * is `null` exactly when the upload may go ahead.
 */
export interface AudioRightsVerdict {
  fields: { rightsConfirmation?: MediaRightsConfirmation }
  refusal: AudioRightsRefusalReason | null
}

/**
 * The fields an upload of `contentType` writes, or the refusal it gets.
 *
 * Anything that is not audio passes with no fields. Audio passes only when
 * `confirmed` is exactly `true` — a string `"true"` from a form post is not
 * an answer a person gave to this question.
 */
export function audioRightsVerdict(input: {
  contentType: string
  confirmed: unknown
  uid: string
  nowMs?: number
}): AudioRightsVerdict {
  if (!isAudioUploadType(input.contentType)) return { fields: {}, refusal: null }
  if (input.confirmed !== true || !input.uid) {
    return {
      fields: {},
      refusal: {
        status: 400,
        message: AUDIO_RIGHTS_REQUIRED_MESSAGE,
        code: AUDIO_RIGHTS_REQUIRED_CODE,
      },
    }
  }
  return {
    refusal: null,
    fields: {
      rightsConfirmation: {
        uid: input.uid,
        atMs: input.nowMs ?? Date.now(),
        statement: AUDIO_RIGHTS_STATEMENT,
      },
    },
  }
}

/** The verdict's refusal as a route answers it. */
export function audioRightsRefusal(verdict: AudioRightsRefusalReason): Response {
  return Response.json(
    { error: verdict.message, code: verdict.code },
    { status: verdict.status },
  )
}
