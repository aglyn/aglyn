export namespace Res {

  export enum Status {
    SUCCESS = 'success',
    ERROR = 'error',
  }

  export type DataType = Record<string, unknown>
  export type ErrorType = {
    code: string
    message: string
    statusCode: number
  }

  export interface Response {
    status: Status
  }
  export interface DataResponse extends Response {
    data: DataType
  }
  export interface ErrorResponse extends Response {
    error: ErrorType
  }
  export type ResponseType = DataResponse | ErrorResponse

  const buildResponse = (
    data?: DataType,
    error?: ErrorType
  ): ResponseType => {
    return error as ErrorType
      ? { status: Status.ERROR, error }
      : { status: Status.SUCCESS, data }
  }

  export namespace Data {

    /////////////////
    // RESPONSES
    /////////////////
    export const success = buildResponse({})
  }

  export namespace Error {
    enum Prefix {
      BAD_REQ = 'bad-request',
      NO_AUTH = 'not-authorized',
    }
    enum MsgCode {
      MISSING_HDR = 'missing-required-header',
      FAIL_ID_TOKEN_CHECK = 'id-token-verification-failed',
      FAIL_CSRF_TOKEN_CHECK = 'csrf-token-verification-failed',
      CREATE_SESSION_COOKIE = 'create-session-cookie',
    }
    enum Message {
      INVALID_REQUEST = 'Invalid Request',
      LOGIN_REQUIRED = 'Login Required',
      NOT_AUTHORIZED = 'Not Authorized',
    }

    const buildCode = (
      pfx: Prefix,
      code: MsgCode
    ): string => `${pfx}/${code}`

    const buildError = (
      statusCode: number,
      pfx: Prefix,
      code: MsgCode,
      message: Message
    ): ErrorResponse => buildResponse(null, {
      code: buildCode(pfx, code),
      message,
      statusCode,
    }) as ErrorResponse


    /////////////////
    // RESPONSES
    /////////////////

    export const missingHeader = buildError(
      400,
      Prefix.BAD_REQ,
      MsgCode.MISSING_HDR,
      Message.INVALID_REQUEST
    )

    export const idTokenCheck = buildError(
      401,
      Prefix.NO_AUTH,
      MsgCode.FAIL_ID_TOKEN_CHECK,
      Message.LOGIN_REQUIRED
    )

    export const csrfTokenCheck = buildError(
      401,
      Prefix.NO_AUTH,
      MsgCode.FAIL_CSRF_TOKEN_CHECK,
      Message.LOGIN_REQUIRED
    )

    export const createSessionCookie = buildError(
      401,
      Prefix.NO_AUTH,
      MsgCode.CREATE_SESSION_COOKIE,
      Message.NOT_AUTHORIZED
    )
  }
}

export namespace Logger {
  export const traceError = (
    res: Res.ErrorResponse,
    error?: any
  ) => console.trace(
    res.error.statusCode,
    res.error.message,
    `(code: ${res.error.code})`,
    error
  )
}