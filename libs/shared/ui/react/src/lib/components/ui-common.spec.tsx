/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'
import { render } from '@testing-library/react'

import UiCommon from './ui-common'

describe('UiCommon', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<UiCommon />)
    expect(baseElement).toBeTruthy()
  })
})
