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

import {type NextApiRequest, type NextApiResponse} from 'next'
import {DdfForms} from '../../../../forms'
import {Req, Res} from '../../../../lib/api/helpers'
import httpRequestMethod from '../../../../lib/api/middleware/http-request-method'
import {rateLimiterFactory} from '../../../../lib/api/middleware/rate-limit'
import {handleMiddleware} from '../../../../lib/api/tools/middleware'
import {saveFormSubmit} from '../../../../lib/firebase/form-submission'


/**
 * Form submission functionality JSON api
 * directory & file name explanation `h = handle`, `f = form`, `[id] = form ID`
 * @param {NextApiRequest} req
 * @param {NextApiResponse} res
 */
async function formHandler(req: NextApiRequest, res: NextApiResponse) {
  const {query: {id}, body: {...values}} = req

  // Ensure Form ID exists
  if (!DdfForms.isValidFormId(id)) {
    return Res.Error.handleJsonError(res, Res.Error.notFound)
  }
  const schema = DdfForms.getFormSchemaFromId(id)
  const errors = await DdfForms.checkRequiredValues(schema, {values})
  if (Object.keys(errors).length) {
    return Res.Error.handleJsonError(
      res,
      Res.Error.missingParams({errors}),
    )
  }

  let saveRes
  let saveError

  await saveFormSubmit({formId: id, fields: values})
    .then(response => { saveRes = response })
    .catch(error => { saveError = error })

  if (saveError) {
    return Res.Error.handleJsonError(res, Res.Error.badRequest('Form submission failed'))
  }

  return res.status(200).json(Res.Data.success({response: saveRes}))
}

export default handleMiddleware(
  rateLimiterFactory({limit: 3}),
  httpRequestMethod([Req.Method.POST]),
)(formHandler)
// export default formHandler
