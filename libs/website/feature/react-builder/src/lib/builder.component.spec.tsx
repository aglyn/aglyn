/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { render } from '@testing-library/react'

import BuilderComponent from './builder.component'

describe('BuilderComponent', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<BuilderComponent />)
    expect(baseElement).toBeTruthy()
  })
})
