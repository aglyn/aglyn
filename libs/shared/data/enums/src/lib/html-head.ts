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

import type {
  MakeLinkElementsConfig,
  MakeMetaElementsConfig,
} from '@aglyn/shared-ui-jsx'
import { getConsoleMetaThemeColor } from '@aglyn/shared-ui-theme'

export const META_PREF: MakeMetaElementsConfig = [
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
    getConsoleMetaThemeColor('light'),
    { media: '(prefers-color-scheme: light)', id: 'theme-color-media-light' },
  ],
  [
    'theme-color',
    getConsoleMetaThemeColor('dark'),
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
  ['manifest', '/_static/_pwa/manifest.json', { id: 'manifest-pwa' }],
  [
    'stylesheet',
    'https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@300;400;500;700;900&display=swap',
    { id: 'font-roboto-flex' },
  ],
]

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
  [
    'preconnect',
    'https://www.googletagmanager.com',
    { id: 'preconnect-googletagmanager' },
  ],
  [
    'preconnect',
    'https://www.google-analytics.com',
    { id: 'preconnect-google-analytics' },
  ],
  [
    'preconnect',
    'https://adservice.google.com',
    { id: 'preconnect-adservice-google' },
  ],
  [
    'preconnect',
    'https://static.doubleclick.net',
    { id: 'preconnect-static-doubleclick' },
  ],
  [
    'preconnect',
    'https://googleads.g.doubleclick.net',
    { id: 'preconnect-googleads-g' },
  ],
]
