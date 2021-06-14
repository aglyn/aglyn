/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */
import { NextApiRequest, NextApiResponse } from 'next'
import { DdfForms } from '../../../../forms'
import { Req, Res } from '../../../../lib/api/helpers'
import httpRequestMethod from '../../../../lib/api/middleware/http-request-method'
import { rateLimiterFactory } from '../../../../lib/api/middleware/rate-limit'
import { handleMiddleware } from '../../../../lib/api/tools/middleware'
import { saveFormSubmit } from '../../../../lib/firebase/form-submission'


/**
 * Form submission functionality JSON api
 * directory & file name explanation `h = handle`, `f = form`, `[id] = form ID`
 * @param {NextApiRequest} req
 * @param {NextApiResponse} res
 */
async function formHandler(req: NextApiRequest, res: NextApiResponse) {
  const { query: { id }, body: { ...values } } = req

  // Ensure Form ID exists
  if (!DdfForms.isValidFormId(id)) {
    return Res.Error.handleJsonError(res, Res.Error.notFound)
  }
  const schema = DdfForms.getFormSchemaFromId(id)
  const errors = await DdfForms.checkRequiredValues(schema, { values })
  if (Object.keys(errors).length) {
    return Res.Error.handleJsonError(
      res,
      Res.Error.missingParams({ errors }),
    )
  }

  let saveRes

  await saveFormSubmit({formId : id, fields : values})
    .then(response => saveRes = response)
    .catch(error => saveRes = error)

  return res.status(200).json(Res.Data.success({ response: saveRes }))
}

export default handleMiddleware(
  rateLimiterFactory({ limit: 3 }),
  httpRequestMethod([Req.Method.POST]),
)(formHandler)
// export default formHandler
