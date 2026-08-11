/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import {
  type AuthError,
  AuthErrorCodes,
  type OAuthCredential,
  type UserCredential,
} from 'firebase/auth'

/**
 * Codes the console raises itself, for failures Firebase has no code for
 * (AGL-1416).
 *
 * These exist because `AuthErrorAlertComponent` renders NOTHING unless the
 * error carries a `code` — an error built as `{ message }` alone is silently
 * dropped, which is how the SSO page's own messages never reached anyone.
 * Giving each failure a real code is what makes it visible, and registering a
 * caption below is what stops it falling back to the generic "contact the
 * system administrator" line — the single worst thing to tell someone whose
 * actual problem is that they have another Google account in session.
 */
export const AuthAppErrorCodes = {
  /** Google resolved SSO against the wrong signed-in account. */
  SSO_ACCOUNT_MISMATCH: 'auth/sso-account-mismatch',
  /** No SSO configured for the email domain the user typed. */
  SSO_NOT_CONFIGURED: 'auth/sso-not-configured',
  /** The user submitted the SSO gate without a usable email. */
  SSO_INPUT_REQUIRED: 'auth/sso-input-required',
  /** Authenticated with the IdP, but not a member of the organization. */
  SSO_NOT_AUTHORIZED: 'auth/sso-not-authorized',
  /**
   * The IdP window closed without a result. On the SSO path this is NOT the
   * plain cancel it is elsewhere: when Google refuses the SAML request it
   * renders its own error page inside that window, so the user closing it
   * looks identical to a cancel. Suppressing it — as the shared
   * `AuthErrorIgnore` list does for popup-closed — is what left the desktop
   * flow with Google's raw error and nothing from us.
   */
  SSO_INCOMPLETE: 'auth/sso-incomplete',
  /** SSO failed for a reason we could not classify. */
  SSO_FAILED: 'auth/sso-failed',
} as const

export type AuthAppCode =
  (typeof AuthAppErrorCodes)[keyof typeof AuthAppErrorCodes]

export type AuthCode = IndexOf<typeof AuthErrorCodes> | AuthAppCode | 'general'
export type AuthResultError = AuthError //& {credential?: OAuthCredential}
export type AuthResultUser = UserCredential & { credential?: OAuthCredential }
export type AuthCallbackResult = Promise<UserCredential>

export const AuthErrorIgnore = {
  [AuthErrorCodes.USER_CANCELLED]: true,
  [AuthErrorCodes.REDIRECT_CANCELLED_BY_USER]: true,
  [AuthErrorCodes.POPUP_CLOSED_BY_USER]: true,
}

export const AuthErrorNotice = {
  [AuthErrorCodes.USER_SIGNED_OUT]: true,
  [AuthErrorCodes.CREDENTIAL_TOO_OLD_LOGIN_AGAIN]: true,
  // Situations the person can fix themselves in one step. Rendering these as
  // red errors invites a support ticket for something that is not broken.
  [AuthAppErrorCodes.SSO_ACCOUNT_MISMATCH]: true,
  [AuthAppErrorCodes.SSO_NOT_CONFIGURED]: true,
  [AuthAppErrorCodes.SSO_INPUT_REQUIRED]: true,
  [AuthAppErrorCodes.SSO_INCOMPLETE]: true,
}

export const AuthErrorMessage: Partial<Record<AuthCode, string>> = {
  general:
    'An error has occurred. If this issue persists please contact the system administrator.',
  [AuthErrorCodes.ADMIN_ONLY_OPERATION]:
    'You are not authorized to perform this action.',
  [AuthErrorCodes.ALREADY_INITIALIZED]:
    'Failed to initialize authenticator. Already initialized.',
  [AuthErrorCodes.ARGUMENT_ERROR]: 'Failed to provide valid arguments.',
  [AuthErrorCodes.CAPTCHA_CHECK_FAILED]: 'CAPTCHA check failed. Try again.',
  [AuthErrorCodes.CODE_EXPIRED]:
    'Authentication code has expired. Request a new code and try again.',
  [AuthErrorCodes.CREDENTIAL_ALREADY_IN_USE]:
    'Authentication credential already in use.',
  [AuthErrorCodes.CREDENTIAL_MISMATCH]:
    'Unable to perform action. Authentication token mismatch.',
  [AuthErrorCodes.CREDENTIAL_TOO_OLD_LOGIN_AGAIN]:
    'You have been signed out. Sign in again to continue.',
  [AuthErrorCodes.EMAIL_CHANGE_NEEDS_VERIFICATION]:
    'New email is not verified. Check your email to verify.',
  [AuthErrorCodes.EMAIL_EXISTS]:
    'Account with email already exists. Sign in instead.',
  [AuthErrorCodes.EXPIRED_OOB_CODE]:
    'This link has expired. Request a new password reset link and try again.',
  [AuthErrorCodes.EXPIRED_POPUP_REQUEST]: 'Request timeout. Try again.',
  [AuthErrorCodes.INVALID_OOB_CODE]:
    'This link is invalid or has already been used. Request a new password reset link.',
  [AuthErrorCodes.INTERNAL_ERROR]: 'An internal error occurred.',
  [AuthErrorCodes.INVALID_API_KEY]: 'Invalid API key.',
  [AuthErrorCodes.INVALID_AUTH]:
    'Unable to perform action. Invalid authentication token.',
  [AuthErrorCodes.INVALID_AUTH_EVENT]: 'Invalid authentication event.',
  [AuthErrorCodes.INVALID_CERT_HASH]:
    'Multi-factor authentication is required.',
  [AuthErrorCodes.INVALID_CODE]:
    'Invalid verification code. Try again with a different code.',
  [AuthErrorCodes.INVALID_CUSTOM_TOKEN]:
    'Unable to perform action. Invalid authentication token.',
  [AuthErrorCodes.INVALID_EMAIL]:
    'Unable to perform action. Email provided is invalid.',
  [AuthErrorCodes.INVALID_IDP_RESPONSE]:
    'Unable to perform action. Invalid authentication credential.',
  [AuthErrorCodes.INVALID_MESSAGE_PAYLOAD]:
    'Unable to perform action. Invalid message payload.',
  [AuthErrorCodes.INVALID_MFA_SESSION]:
    'Unable to perform action. Invalid multi-factor authentication.',
  [AuthErrorCodes.INVALID_ORIGIN]:
    'This domain is unauthorized to perform this action.',
  [AuthErrorCodes.INVALID_PASSWORD]:
    'No account matches the credentials provided.',
  [AuthErrorCodes.INVALID_PHONE_NUMBER]:
    'No account matches the credentials provided.',
  [AuthErrorCodes.INVALID_RECIPIENT_EMAIL]:
    'Unable to perform action. Invalid recipient email.',
  [AuthErrorCodes.INVALID_SENDER]:
    'Unable to perform action. Invalid sender email.',
  [AuthErrorCodes.INVALID_SESSION_INFO]:
    'Unable to perform action. Invalid verification ID.',
  [AuthErrorCodes.INVALID_TENANT_ID]:
    'Unable to perform action. Invalid tenant ID.',
  [AuthErrorCodes.MFA_INFO_NOT_FOUND]:
    'Unable to perform action. Multi-factor authentication info not found.',
  [AuthErrorCodes.MFA_REQUIRED]: 'Multi-factor authentication is required.',
  [AuthErrorCodes.MISSING_CODE]: 'Verification code is missing.',
  [AuthErrorCodes.MISSING_OR_INVALID_NONCE]:
    'Unable to perform action. Missing or invalid nonce.',
  [AuthErrorCodes.MISSING_PHONE_NUMBER]:
    'Unable to perform action. Missing phone number.',
  [AuthErrorCodes.MODULE_DESTROYED]:
    'Unable to perform action. App has been destroyed.',
  [AuthErrorCodes.NEED_CONFIRMATION]:
    'Authentication credential already in use with different credential.',
  [AuthErrorCodes.NETWORK_REQUEST_FAILED]:
    'Unable to connect. Check your internet connection and try again.',
  [AuthErrorCodes.NULL_USER]: 'No account matches the credentials provided.',
  [AuthErrorCodes.POPUP_BLOCKED]:
    'Popups blocked. Allow popups in your browser and try again.',
  [AuthErrorCodes.PROVIDER_ALREADY_LINKED]:
    'Unable to perform action. Provider is linked to another account.',
  [AuthErrorCodes.QUOTA_EXCEEDED]:
    'Unable to perform action. Usage quota has been exceeded.',
  [AuthErrorCodes.REJECTED_CREDENTIAL]:
    'Unable to perform action. Rejected credential.',
  [AuthErrorCodes.TENANT_ID_MISMATCH]:
    'Unable to perform action. Authentication tenant ID mismatch.',
  [AuthErrorCodes.TIMEOUT]: 'Unable to perform action. Timeout.',
  [AuthErrorCodes.TOKEN_EXPIRED]: 'Your authentication token has expired.',
  [AuthErrorCodes.TOO_MANY_ATTEMPTS_TRY_LATER]:
    'Account blocked from too many attempts. Try again later.',
  [AuthErrorCodes.UNVERIFIED_EMAIL]:
    'Email is not verified. Check your email to verify.',
  [AuthErrorCodes.USER_DELETED]: 'No account matches the credentials provided.',
  [AuthErrorCodes.USER_SIGNED_OUT]:
    'You have been signed out. Sign in again to continue.',
  [AuthErrorCodes.WEAK_PASSWORD]:
    'Password is too weak. Enter a stronger password and try again.',
  // AGL-1416. The captions carry the ACTION, because the headline above them
  // is the diagnosis and a diagnosis with no next step is what sends people
  // to their IT admin for a problem only they can fix.
  [AuthAppErrorCodes.SSO_ACCOUNT_MISMATCH]:
    'Your browser is signed in to another Google account, and single ' +
    'sign-on was resolved against that one. Sign out of the other account, ' +
    'or open this page in a private window, then try again.',
  [AuthAppErrorCodes.SSO_NOT_CONFIGURED]:
    'Check the spelling of your work email, or sign in with your password ' +
    'or Google instead.',
  [AuthAppErrorCodes.SSO_INPUT_REQUIRED]:
    'Enter the full work email address your organization uses.',
  [AuthAppErrorCodes.SSO_NOT_AUTHORIZED]:
    'Ask an administrator of that organization to invite you, then sign in ' +
    'again.',
  [AuthAppErrorCodes.SSO_INCOMPLETE]:
    'If you closed the window, just try again. If it showed an error about ' +
    'the app not being configured for your account, you are signed in to a ' +
    'different Google account — open this page in a private window and ' +
    'enter your work email.',
  [AuthAppErrorCodes.SSO_FAILED]:
    'Single sign-on could not be completed. Try again, and if it keeps ' +
    'happening contact an administrator of your organization.',
}

export const COOKIE_KEY_USER_TOKEN = 'aglyn-user-token'
