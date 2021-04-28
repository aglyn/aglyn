/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { deepMerge } from "@aglyn/shared/util/helpers"


export function handlePropDefaults(dataProps, defaultProps) {
  return deepMerge(defaultProps, dataProps)
}

export default handlePropDefaults
