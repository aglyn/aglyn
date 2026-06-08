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

export enum HttpStatusCode {
  // SUCCESS
  OK = 200,
  _200 = OK,
  CREATED = 201,
  _201 = CREATED,
  ACCEPTED = 202,
  _202 = ACCEPTED,
  NO_CONTENT = 204,
  _204 = NO_CONTENT,

  // REDIRECTS
  MOVED_PERMANENTLY = 301,
  _301 = MOVED_PERMANENTLY,
  FOUND = 302,
  _302 = FOUND,
  SEE_OTHER = 303,
  _303 = SEE_OTHER,
  NOT_MODIFIED = 304,
  _304 = NOT_MODIFIED,
  TEMPORARY_REDIRECT = 307,
  _307 = TEMPORARY_REDIRECT,
  PERMANENT_REDIRECT = 308,
  _308 = PERMANENT_REDIRECT,

  // ERRORS - CLIENT
  BAD_REQUEST = 400,
  _400 = BAD_REQUEST,
  UNAUTHORIZED = 401,
  _401 = UNAUTHORIZED,
  PAYMENT_REQUIRED = 402,
  _402 = PAYMENT_REQUIRED,
  FORBIDDEN = 403,
  _403 = FORBIDDEN,
  NOT_FOUND = 404,
  _404 = NOT_FOUND,
  METHOD_NOT_ALLOWED = 405,
  _405 = METHOD_NOT_ALLOWED,
  NOT_ACCEPTABLE = 406,
  _406 = NOT_ACCEPTABLE,
  PROXY_AUTHENTICATION_REQUIRED = 407,
  _407 = PROXY_AUTHENTICATION_REQUIRED,
  REQUEST_TIMEOUT = 408,
  _408 = REQUEST_TIMEOUT,
  CONFLICT = 409,
  _409 = CONFLICT,
  GONE = 410,
  _410 = GONE,
  LENGTH_REQUIRED = 411,
  _411 = LENGTH_REQUIRED,
  PRECONDITION_FAILED = 412,
  _412 = PRECONDITION_FAILED,
  PAYLOAD_TOO_LARGE = 413,
  _413 = PAYLOAD_TOO_LARGE,
  URI_TOO_LONG = 414,
  _414 = URI_TOO_LONG,
  UNSUPPORTED_MEDIA_TYPE = 415,
  _415 = UNSUPPORTED_MEDIA_TYPE,
  RANGE_NOT_SATISFIABLE = 416,
  _416 = RANGE_NOT_SATISFIABLE,
  EXPECTATION_FAILED = 417,
  _417 = EXPECTATION_FAILED,
  TOO_MANY_REQUESTS = 429,
  _429 = TOO_MANY_REQUESTS,
  REQUEST_HEADER_FIELDS_TOO_LARGE = 431,
  _431 = REQUEST_HEADER_FIELDS_TOO_LARGE,

  // ERRORS - SERVER
  INTERNAL_SERVER_ERROR = 500,
  _500 = INTERNAL_SERVER_ERROR,
  NOT_IMPLEMENTED = 501,
  _501 = NOT_IMPLEMENTED,
  BAD_GATEWAY = 502,
  _502 = BAD_GATEWAY,
  SERVICE_UNAVAILABLE = 503,
  _503 = SERVICE_UNAVAILABLE,
  GATEWAY_TIMEOUT = 504,
  _504 = GATEWAY_TIMEOUT,
  HTTP_VERSION_NOT_SUPPORTED = 505,
  _505 = HTTP_VERSION_NOT_SUPPORTED,
  INSUFFICIENT_STORAGE = 507,
  _507 = INSUFFICIENT_STORAGE,
  LOOP_DETECTED = 508,
  _508 = LOOP_DETECTED,
  NOT_EXTENDED = 510,
  _510 = NOT_EXTENDED,
  NETWORK_AUTHENTICATION_REQUIRED = 511,
  _511 = NETWORK_AUTHENTICATION_REQUIRED,

}

export enum HttpRequestMethod {
  CONNECT = 'CONNECT',
  DELETE = 'DELETE',
  GET = 'GET',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
  PATCH = 'PATCH',
  POST = 'POST',
  PUT = 'PUT',
  TRACE = 'TRACE',
}

export enum HttpResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error'
}

export enum HttpRefCodeSimple {
  SERVER_ERROR = 'Internal server error',
  INVALID_REQUEST = 'Unknown or invalid request',
  NOT_AUTHENTICATED = 'Missing required authentication',
  NOT_AUTHORIZED = 'Missing required permissions',
  TOO_MANY_REQUESTS = 'Too many subsequent requests',
  METHOD_NOT_ALLOWED = 'Request method not allowed',
  RESOURCE_NOT_FOUND = 'Asset or resource not found',
  FAILED_SECURITY = 'Failed security requirements',
  FAILED_CLIENT_MODIFY = 'Failed to modify client',
}

export enum HttpRefCodeSubject {
  SYSTEM_DOWN = 'system-down',
  NOT_AUTHORIZED = 'not-authorized',
  NOT_AUTHENTICATED = 'not-authenticated',
  BAD_REQUEST = 'bad-request',
  INVALID_REQUEST = 'invalid-request',
  TOO_MANY_REQUEST = 'too-many-requests',
}

export enum HttpRefCodeTopic {
  UNKNOWN = 'unknown',
  NOT_FOUND = 'not-found',
  SERVER_ERROR = 'internal-server-error',
  FAILED_REQUIREMENTS = 'failed-requirements',
  MISSING_HEADER = 'missing-required-header',
  FAIL_ID_TOKEN_CHECK = 'id-token-verification-failed',
  FAIL_CSRF_TOKEN_CHECK = 'csrf-token-verification-failed',
  CREATE_SESSION_COOKIE = 'create-session-cookie',
  RATE_LIMIT_EXCEEDED = 'rate-limit-exceeded',
  METHOD_NOT_ALLOWED = 'method-not-allowed',
}

export type HttpRefCode = `${HttpRefCodeSimple} (${HttpRefCodeSubject}/${HttpRefCodeTopic})`

export const createHttpRefCode = (
  simple: HttpRefCodeSimple,
  subject: HttpRefCodeSubject,
  topic: HttpRefCodeTopic,
): HttpRefCode => `${simple} (${subject}/${topic})`
