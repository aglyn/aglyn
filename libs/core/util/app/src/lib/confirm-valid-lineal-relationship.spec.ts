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

import { ComponentsLinealOrder } from '@aglyn/core-data-foundation'
import confirmValidLinealRelationship, {
  ComponentsLinealDirectiveFlag,
} from './confirm-valid-lineal-relationship'

describe('confirm-valid-lineal-relationship', () => {
  it('is valid if no restrictions exist', () => {
    const item = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: undefined,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(true)
  })
  it('is invalid if component="cba" and parent requires "abc"', () => {
    const item = {
      componentId: 'cba',
      bundleId: 'xyz',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO,
        ['abc'],
      ] as ComponentsLinealOrder,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(false)
  })
  it('is valid if component="abc" and parent requires "abc"', () => {
    const item = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO,
        ['abc'],
      ] as ComponentsLinealOrder,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(true)
  })
  it('is invalid if component="abc"/bundle="zyx" and parent requires "abc"/"xyz"', () => {
    const item = {
      componentId: 'abc',
      bundleId: 'zyx',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO,
        { bundles: ['xyz'], components: ['abc'] },
      ] as ComponentsLinealOrder,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(false)
  })
  it('is valid if component="abc"/bundle="xyz" and parent requires "abc"/"xyz"', () => {
    const item = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO,
        { bundles: ['xyz'], components: ['abc'] },
      ] as ComponentsLinealOrder,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(true)
  })
  it('is invalid if component="cba"/bundle="xyz" and parent requires "abc"/"xyz"', () => {
    const item = {
      componentId: 'cba',
      bundleId: 'xyz',
      restrictParent: undefined,
      restrictChildren: undefined,
    }
    const parent = {
      componentId: 'abc',
      bundleId: 'xyz',
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO,
        { bundles: ['xyz'], components: ['abc'] },
      ] as ComponentsLinealOrder,
    }
    expect(confirmValidLinealRelationship({ item, parent })[0]).toEqual(false)
  })
})
