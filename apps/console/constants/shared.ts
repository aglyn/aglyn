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

export const CONTENT_MAX_WIDTH = 'xl'
export const DRAWER_WIDTH = 290
export const TAB_HEIGHT = 40
export const TOP_BAR_HEIGHT = 48
export const TABLE_ROW_HEIGHT = 48
/**
 * Table header height, shared by the DataTable (layouts, components,
 * templates) and the bespoke screens hierarchy table. MUI's size="small"
 * TableHead and MUI X's DataGrid column header default to different heights,
 * so the console showed two table designs until both were pinned here.
 */
export const TABLE_HEAD_HEIGHT = 48

/**
 * Canonical, published legal documents. These are hosted on the production
 * marketing site (aglyn.com), not the console, so they are absolute
 * cross-origin URLs opened in a new tab — a full navigation, not in-SPA
 * routing (hence a plain anchor / MUI Link, not AppLink). Always point at
 * production so users see the canonical published terms from every env.
 */
export const LEGAL_URLS = {
  TERMS: 'https://aglyn.com/legal/terms',
  PRIVACY: 'https://aglyn.com/legal/privacy',
}

// The version and content hashes of those documents live in
// `./legal-documents`, which imports LEGAL_URLS from here (AGL-1497).

/**
 * Where an Enterprise enquiry goes (AGL-1118). Enterprise is the one tier with
 * no list price and no self-serve checkout — its card links here instead of an
 * Upgrade button. Same posture as `LEGAL_URLS`: an absolute marketing-site URL
 * opened in a new tab, a full navigation rather than in-SPA routing.
 */
export const ENTERPRISE_CONTACT_URL = 'https://aglyn.com/contact?plan=enterprise'

export const mainNavigation = [
  // {
  //   children: 'Features',
  // },
  // {
  //   children: 'Partners',
  //   items: [],
  // },
  // {
  //   children: 'Company',
  //   items: [],
  // },
  {
    children: 'Get Access',
    variant: 'contained',
    color: 'primary',
    href: '/contact',
  },
]
export const footerNavigation = [
  {
    children: 'Resources',
    items: [
      {
        children: 'Get access',
        href: '/contact',
      },
      {
        children: 'Features (coming soon)',
        href: '/features',
        disabled: true,
        'aria-disabled': true,
      },
    ],
  },
  {
    children: 'Company',
    items: [
      {
        children: 'Contact',
        href: '/contact',
      },
    ],
  },
  {
    children: 'Legal',
    items: [
      {
        children: 'Privacy',
        href: '/legal/privacy',
      },
    ],
  },
]
export const tailNavigation = [
  {
    children: 'Contact',
    href: '/contact',
  },
  // {
  //   children: 'License',
  //   href: '/',
  // },
  {
    children: 'Privacy',
    href: '/legal/privacy',
  },
  // {
  //   children: 'Support',
  //   href: '/',
  // },
]
