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

import { render } from '@testing-library/react'
import Page from '../app/[host]/[[...slug]]/catch-all-client'

/**
 * The plugin gate loads nothing. This is a smoke test for the module and its
 * first render, and it never settles the gate — so with the real manifest the
 * bundles' dynamic imports are still in flight when the assertion runs, and a
 * test that reads one truthy value pays for all of them anyway. See the stub.
 */
jest.mock('../utils/site-plugin-loader', () =>
  require('./site-plugin-loader-empty-manifest'),
)

describe('Index', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Page data={{}} nodes={{}} />)
    expect(baseElement).toBeTruthy()
  })
})
