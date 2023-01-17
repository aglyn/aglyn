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

import type { AglynNodesList } from '@aglyn/core-data-foundation'

export const samplePageData: AglynNodesList = [
  {
    $id: 'sample-element-1',
    componentId: 'sample-element',
    props: {},
    nodes: [
      {
        $id: 'sample-element-11',
        componentId: 'sample-element-1',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-21',
        componentId: 'sample-element-2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-31',
        componentId: 'sample-element-3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
  {
    $id: 'sample-element-2',
    componentId: 'sample-element-4',
    props: {},
    nodes: [
      {
        $id: 'sample-element-13',
        componentId: 'sample-element-1',
        sx: { fontWeight: 'fontWeightBold' },
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-23',
        componentId: 'sample-element-2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-33',
        componentId: 'sample-element-3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
  {
    $id: 'sample-element-3',
    componentId: 'sample-element-4',
    props: {},
    nodes: [
      {
        $id: 'sample-element-14',
        componentId: 'sample-element-1',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-24',
        componentId: 'sample-element-2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'sample-element-34',
        componentId: 'sample-element-3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
]
