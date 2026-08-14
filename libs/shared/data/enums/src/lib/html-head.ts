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

type MetaElementAttrs = { [key: string]: string | undefined }
type LinkElementAttrs = { [key: string]: string | undefined }
type MakeMetaElementsConfig = (
  themeColorLight: string,
  themeColorDark: string,
) => Array<[name?: string, content?: string, other?: MetaElementAttrs]>
type MakeLinkElementsConfig = Array<
  [rel?: string, href?: string, other?: LinkElementAttrs]
>

export const META_PREF: MakeMetaElementsConfig = (
  themeColorLight = '#FFF',
  themeColorDark = '#000',
) => [
  [
    undefined,
    'en-us',
    { httpEquiv: 'content-language', id: 'http-equiv-lang' },
  ],
  [
    undefined,
    'IE=edge',
    { httpEquiv: 'X-UA-Compatible', id: 'http-equiv-x-ua-compatible' },
  ],
  // ['color-scheme', 'light dark'],
  [
    'theme-color',
    themeColorLight,
    { media: '(prefers-color-scheme: light)', id: 'theme-color-media-light' },
  ],
  [
    'theme-color',
    themeColorDark,
    { media: '(prefers-color-scheme: dark)', id: 'theme-color-media-dark' },
  ],
]

export const LINK_PREF: MakeLinkElementsConfig = [
  ['icon', '/_static/images/favicons/favicon.svg', { id: 'icon-favicon-svg' }],
  [
    'shortcut icon',
    '/_static/images/favicons/favicon.ico',
    { type: 'image/x-icon', id: 'icon-favicon-ico' },
  ],
  [
    'alternate icon',
    '/_static/images/favicons/favicon.png',
    { type: 'image/png', id: 'icon-favicon-png' },
  ],
  [
    'stylesheet',
    'https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@300;400;500;700;900&display=swap',
    { id: 'font-roboto-flex' },
  ],
]

/**
 * Font preconnects ONLY — no ad-tech, no analytics (AGL-1672).
 *
 * This list used to preconnect to `googletagmanager`, `google-analytics`,
 * `adservice.google.com`, `static.doubleclick.net` and
 * `googleads.g.doubleclick.net`. Nothing in the workspace ever loaded a script
 * from any of them, so the preconnects announced ad-tech relationships that
 * did not exist — while sitting in a SHARED lib, where any future Pages-Router
 * surface would have inherited them for free.
 *
 * Keep this list to origins we genuinely fetch from. The two survivors pair
 * with the Google Fonts stylesheet in `LINK_PREF` above; if that stylesheet is
 * ever self-hosted, these two go with it.
 */
export const LINK_PRIORITY: MakeLinkElementsConfig = [
  [
    'preconnect',
    'https://fonts.googleapis.com',
    { id: 'preconnect-fonts-googleapis' },
  ],
  [
    'preconnect',
    'https://fonts.gstatic.com',
    {
      crossOrigin: 'anonymous',
      id: 'preconnect-fonts-gstatic',
    },
  ],
]
