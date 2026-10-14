package com.aglyn.shell

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.aglyn.core.GoogleCredentialSource
import com.aglyn.core.GoogleLinkError
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Signs in to Google with the Credential Manager and returns Google's ID token, which the session attaches to the account
 * ("Connect Google"). [webClientId] is the Firebase project's Web OAuth client id (the token's audience); the project also
 * needs an Android OAuth client for this app's package and signing certificate, or Google refuses the request. Null (and
 * the action hidden) while the build has no web client id.
 */
@Composable
fun rememberAndroidGoogleCredentialSource(webClientId: String): GoogleCredentialSource? {
  val context = LocalContext.current
  return remember(context, webClientId) { if (webClientId.isBlank()) null else AndroidGoogleCredentialSource(context, webClientId) }
}

private class AndroidGoogleCredentialSource(private val context: Context, private val webClientId: String) : GoogleCredentialSource {
  override suspend fun idToken(loginHint: String?): String {
    // Every Google account on the device is offered, not only those that signed in to this app before.
    val option = GetGoogleIdOption.Builder().setServerClientId(webClientId).setFilterByAuthorizedAccounts(false).build()
    val result = try {
      CredentialManager.create(context).getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build())
    } catch (error: GetCredentialCancellationException) {
      throw GoogleLinkError("Google sign-in was canceled.", error)
    } catch (error: NoCredentialException) {
      throw GoogleLinkError("No Google account is on this device. Add one in Settings, then try again.", error)
    } catch (error: GetCredentialException) {
      throw GoogleLinkError("Google did not hand back a sign-in. Try again.", error)
    }
    val credential = result.credential
    if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
      return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }
    throw GoogleLinkError("Google did not hand back a sign-in. Try again.")
  }
}
