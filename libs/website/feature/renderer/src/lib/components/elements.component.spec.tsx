/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { render } from '@testing-library/react'

import ElementsComponent from './elements.component'

describe('ElementsComponent', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<ElementsComponent />)
    expect(baseElement).toBeTruthy()
  })
})
