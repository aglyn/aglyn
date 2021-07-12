/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import { render } from '@testing-library/react'

import AppBarComponent from './appbar.component'

describe('AppBarComponent', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<AppBarComponent />)
    expect(baseElement).toBeTruthy()
  })
})
