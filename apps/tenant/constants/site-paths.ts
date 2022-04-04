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

export const API_DIR = `/api`
export const STATIC_DIR = '/_static'
export const NEXT_DIR = '/_next'
export const NEXT_IMAGE_DIR = `/_next/image`
export const STATIC_IMAGE_DIR = `${STATIC_DIR}/image`
export const STATIC_PWA_DIR = `${STATIC_DIR}/_pwa`
export const STATIC_PWA_ICON_DIR = `${STATIC_PWA_DIR}/icons`

export const STATIC_FAVICON_PATH = `${STATIC_DIR}/favicon.ico`
export const STATIC_ROBOTS_PATH = `${STATIC_DIR}/robots.txt`
export const STATIC_PWA_MANIFEST_PATH = `${STATIC_PWA_DIR}/manifest.json`

export const IMPLICIT_DIRS = [
  STATIC_DIR,
  API_DIR,
  NEXT_DIR,
]

export const STATIC_PATHS = [
  STATIC_DIR,
  STATIC_IMAGE_DIR,
  STATIC_PWA_DIR,
  STATIC_PWA_ICON_DIR,
  STATIC_FAVICON_PATH,
  STATIC_ROBOTS_PATH,
  STATIC_PWA_MANIFEST_PATH,
]

export const NEXT_PATHS = [
  NEXT_IMAGE_DIR,
  NEXT_DIR,
]

export const IMPLICIT_PATHS = [
  API_DIR,
  ...STATIC_PATHS,
  ...NEXT_PATHS,
]

export default {
  IMPLICIT_DIRS,
  API_DIR,
  STATIC_DIR,
  STATIC_IMAGE_DIR,
  STATIC_PWA_DIR,
  STATIC_PWA_ICON_DIR,
  NEXT_DIR,
  NEXT_IMAGE_DIR,
  STATIC_PATHS,
  NEXT_PATHS,
  IMPLICIT_PATHS,
  STATIC_FAVICON_PATH,
  STATIC_ROBOTS_PATH,
  STATIC_PWA_MANIFEST_PATH,
}
