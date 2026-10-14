package com.aglyn.shell

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.CreateCredentialCancellationException
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

private class AndroidPasskeyCreator(private val context: Context) : PasskeyCreator {
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
