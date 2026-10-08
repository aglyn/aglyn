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

/**
 * Pixabay search answers for the specs (AGL-3660), in the API's documented
 * response shape (https://pixabay.com/api/docs/#api_search_images): `total`,
 * `totalHits` and `hits`, each hit carrying the fields the client reads and
 * the ones it ignores. No network in a spec: these stand in for the API.
 */

const hit = (
  id: number,
  user: string,
  userId: number,
  tags: string,
  imageWidth: number,
  imageHeight: number,
) => ({
  id,
  pageURL: `https://pixabay.com/photos/${tags.split(',')[0].trim().replace(/\s+/g, '-')}-${id}/`,
  type: 'photo',
  tags,
  previewURL: `https://cdn.pixabay.com/photo/2024/01/01/00/00/photo-${id}_150.jpg`,
  previewWidth: 150,
  previewHeight: Math.round((150 * imageHeight) / imageWidth),
  webformatURL: `https://pixabay.com/get/g${id}web_640.jpg`,
  webformatWidth: 640,
  webformatHeight: Math.round((640 * imageHeight) / imageWidth),
  largeImageURL: `https://pixabay.com/get/g${id}large_1280.jpg`,
  imageWidth,
  imageHeight,
  imageSize: 2_400_000,
  views: 1000,
  downloads: 500,
  collections: 10,
  likes: 40,
  comments: 3,
  user_id: userId,
  user,
  userImageURL: `https://cdn.pixabay.com/user/2024/01/01/00-00-00-000_250x250.jpg`,
})

export const PIXABAY_YOGA_STUDIO_ANSWER = {
  total: 4210,
  totalHits: 500,
  hits: [
    hit(7101001, 'StudioLight', 101, 'yoga, studio, woman, meditation', 6000, 4000),
    hit(7101002, 'Mat_and_Mind', 102, 'yoga class, studio, group', 5472, 3648),
    hit(7101003, 'QuietMornings', 103, 'yoga, pose, stretching', 4000, 6000),
    hit(7101004, 'StudioLight', 101, 'meditation, yoga studio, calm', 3000, 2000),
    hit(7101005, 'Breathwork', 104, 'yoga, mat, window light', 5184, 3456),
    hit(7101006, 'Saltwater', 105, 'yoga, beach, sunrise', 1920, 1080),
  ],
}

export const PIXABAY_CERAMIC_POTTERY_ANSWER = {
  total: 1830,
  totalHits: 500,
  hits: [
    hit(7202001, 'ClayHands', 201, 'pottery, ceramic, wheel, hands', 6000, 4000),
    hit(7202002, 'KilnWorks', 202, 'ceramics, bowls, glaze', 4608, 3072),
    hit(7202003, 'ClayHands', 201, 'potter, studio, clay', 3456, 5184),
    hit(7202004, 'Stoneware', 203, 'pottery, vase, handmade', 2400, 1600),
  ],
}

export const PIXABAY_EMPTY_ANSWER = { total: 0, totalHits: 0, hits: [] }

/** A `Response` as `fetch` answers, with the rate limit headers Pixabay sends. */
export function pixabayResponse(
  body: unknown,
  init: { status?: number; remaining?: number; reset?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': String(init.remaining ?? 99),
      'x-ratelimit-reset': String(init.reset ?? 60),
      ...(init.headers ?? {}),
    },
  })
}

/** A tiny real JPEG (1×1), for a download that must look like an image. */
export const TINY_JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
)
