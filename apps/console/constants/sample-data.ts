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

import { AglynComponentElementDataDenormalized } from '@aglyn/core-data-framework'


export const samplePageData: AglynComponentElementDataDenormalized[] = [
  {
    $id: 'root1',
    componentId: 'root',
    props: {},
    elements: [
      {
        $id: 'root12',
        componentId: 'root1',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'root22',
        componentId: 'root2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'root32',
        componentId: 'root3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
  {
    $id: 'root2',
    componentId: 'root4',
    props: {},
    elements: [
      {
        $id: 'root13',
        componentId: 'root1',
        props: {
          sx: {fontWeight: 'fontWeightBold'},
          children: 'hello',
        },
      },
      {
        $id: 'root23',
        componentId: 'root2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'root33',
        componentId: 'root3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
  {
    $id: 'root3',
    componentId: 'root4',
    props: {},
    elements: [
      {
        $id: 'root14',
        componentId: 'root1',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'root24',
        componentId: 'root2',
        props: {
          children: 'hello',
        },
      },
      {
        $id: 'root34',
        componentId: 'root3',
        props: {
          children: 'hello',
        },
      },
    ],
  },
]
