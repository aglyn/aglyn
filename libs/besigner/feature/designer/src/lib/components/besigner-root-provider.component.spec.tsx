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

import { deleteBesignerApp, initializeBesignerApp } from '@aglyn/besigner'
import { render } from '@testing-library/react'

import BesignerRootProviderComponent from './besigner-root-provider.component'

describe('BesignerRootProviderComponent', () => {
  const appName = 'besigner-root-provider-test'

  beforeEach(() => {
    initializeBesignerApp({ appName })
  })
  afterEach(() => {
    deleteBesignerApp(appName)
  })

  it('should render successfully', () => {
    const { baseElement } = render(
      <BesignerRootProviderComponent appName={appName} elementComponents={[]} />,
    )
    expect(baseElement).toBeTruthy()
  })
})
