package com.aglyn.shell

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.aglyn.screens.PasskeyAsserter
import com.aglyn.screens.PasskeyCancelled
import com.aglyn.screens.PasskeyCreator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Makes passkeys with the Credential Manager (Google Password Manager, or whichever provider the person chose).
 *
 * The relying party must serve `/.well-known/assetlinks.json` that grants `delegate_permission/common.get_login_creds` to
 * this app's package and signing certificate, or the system refuses the request; the console's routes then see the
 * credential's origin as `android:apk-key-hash:<certificate hash>` and accept it only for the hashes the deployment lists
 * (`PASSKEY_ANDROID_APK_KEY_HASHES`).
 */
@Composable
fun rememberAndroidPasskeyCreator(): PasskeyCreator {
  val context = LocalContext.current
  return remember(context) { AndroidPasskeyCreator(context) }
}

/** Signs in with a passkey through the Credential Manager: a discoverable credential, as the console's sign-in page asks. */
@Composable
fun rememberAndroidPasskeyAsserter(): PasskeyAsserter {
  val context = LocalContext.current
  return remember(context) { AndroidPasskeyCreator(context) }
}

private class AndroidPasskeyCreator(private val context: Context) : PasskeyCreator, PasskeyAsserter {
  override suspend fun get(options: JsonElement): JsonElement {
    // The WebAuthn authentication options are the request's JSON as they are; the response's JSON is the assertion the
    // server verifies. No passkey to offer, or the prompt closed, is the same answer to the person: none was used.
    val result = try {
      CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options.toString()))))
    } catch (error: GetCredentialCancellationException) {
      throw PasskeyCancelled()
    } catch (error: NoCredentialException) {
      throw PasskeyCancelled()
    }
    val credential = result.credential as? PublicKeyCredential ?: throw PasskeyCancelled()
    return Json.parseToJsonElement(credential.authenticationResponseJson)
  }

  override suspend fun create(options: JsonElement): JsonElement {
    // The WebAuthn creation options are the request's JSON as they are; the response's JSON is the registration the
    // server verifies.
    val response = try {
      CredentialManager.create(context).createCredential(context, CreatePublicKeyCredentialRequest(options.toString()))
    } catch (error: CreateCredentialCancellationException) {
      throw PasskeyCancelled()
    }
    return Json.parseToJsonElement((response as CreatePublicKeyCredentialResponse).registrationResponseJson)
  }
}
