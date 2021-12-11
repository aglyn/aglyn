/**
 * @license
 * Copyright 2021 Aglyn LLC
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
    color: 'secondary',
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
