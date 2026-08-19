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


/**
 * Titles and affixes carry the platform brand (AGL-2153), so a self-host
 * install does not advertise Aglyn in every `<title>` and on every published
 * site's default description.
 *
 * Same env name, same inline-cast form, and for the same two reasons as
 * `BRAND` in `./aglyn.ts` — see the note there before changing the shape of
 * this read. In particular, do not hoist `process.env` into a local: the cast
 * is erased and the member expression survives substitution, an alias does
 * not, and the alias version compiles and reads perfectly while inlining
 * nothing.
 */
const PLATFORM_BRAND_NAME =
  (process.env as { NEXT_PUBLIC_PLATFORM_BRAND_NAME?: string })
    .NEXT_PUBLIC_PLATFORM_BRAND_NAME?.trim() || 'Aglyn'

export const APP_WWW = {
  TITLE: `Online secure website builder – ${PLATFORM_BRAND_NAME}`,
  DESCRIPTION: `Build secure no-code online website apps with ${PLATFORM_BRAND_NAME} the visual besigner with drag-and-drop`,
  AFFIX: PLATFORM_BRAND_NAME,
  SEP: '–',
}
export const APP_CONSOLE = {
  TITLE: `Secure Platform Console – ${PLATFORM_BRAND_NAME}`,
  DESCRIPTION: 'Contributions to the “no code” web application market by optimizing the process and necessary steps for a website to get off the ground for organizations',
  AFFIX: `${PLATFORM_BRAND_NAME} Platform Console`,
  SEP: '–',
}
export const APP_TENANT = {
  TITLE: 'My website',
  DESCRIPTION: `Created with ${PLATFORM_BRAND_NAME} website besigner`,
  AFFIX: `Built with ${PLATFORM_BRAND_NAME}`,
  SEP: '|',
}

export const BRAND_NAMES = {
  WWW: '.com',
  BESIGNER: 'Besigner',
  CONSOLE: 'Console',
}
