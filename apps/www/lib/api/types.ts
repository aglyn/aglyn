/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { NextApiRequest, NextApiResponse } from 'next'


export type ApiRequest = NextApiRequest
export type ApiResponse<T = any> = NextApiResponse<T>

export interface ApiHandler<T = any, Request extends ApiRequest = ApiRequest> {
  (req: Request, res: ApiResponse<T>): void | Promise<void>
}
