package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.ui.AuthButton
import com.aglyn.ui.AuthButtonKind
import com.aglyn.ui.AuthTokens
import com.aglyn.ui.GoogleButton
import com.aglyn.ui.OrDivider
import kotlinx.coroutines.launch

enum class ProviderMode { SIGN_IN, SIGN_UP }

/**
 * The doors under a sign-in or sign-up form besides the password, after an "or", in the spec's order (Figma "Button/Provider"
 * 28:764): Google where the platform bound a way to sign in to it, and on sign-in a passkey where the build has a relying party
 * and the platform bound a way to sign in with one, and single sign-on (the console's sign-in page offers all three). Every one
 * is 48 dp tall, rounded 12, 8 apart. On sign-up each is gated on the agreement first.
 */
@Composable
internal fun ProviderSignInButtons(
  services: ShellServices,
  mode: ProviderMode,
  enabled: Boolean = true,
  /** The sign-up's consent check, run before a provider sheet opens. */
  gate: () -> Boolean = { true },
  busy: Boolean,
  onBusy: (Boolean) -> Unit,
  onError: (String?) -> Unit,
  marketing: Boolean = false,
) {
  val scope = rememberCoroutineScope()
  val asserter = com.aglyn.screens.LocalPasskeyAsserter.current
  val relyingParty = services.config.passkeyRelyingParty
  val passkey = mode == ProviderMode.SIGN_IN && asserter != null && relyingParty != null
  val google = com.aglyn.screens.LocalGoogleCredentialSource.current
  val singleSignOn = mode == ProviderMode.SIGN_IN && services.consoleHandoff != null
  var working by remember { mutableStateOf<String?>(null) }
  if (!passkey && google == null && !singleSignOn) return
  Column(verticalArrangement = Arrangement.spacedBy(AuthTokens.Metrics.PROVIDER_SPACING.dp)) {
    OrDivider(modifier = Modifier.padding(bottom = 4.dp))
    if (google != null) {
      // Google's approved title, unchanged while its sheet opens.
      GoogleButton(
        "Continue with Google",
        onClick = {
          if (busy || (mode == ProviderMode.SIGN_UP && !gate())) return@GoogleButton
          onBusy(true)
          onError(null)
          scope.launch {
            try {
              services.continueWithGoogle(google, signingUp = mode == ProviderMode.SIGN_UP, marketing = marketing)
            } catch (failure: AuthError) {
              onError(failure.message)
            } catch (failure: com.aglyn.core.GoogleLinkError) {
              // Closing Google's sheet is not a failure (the console ignores `popup-closed-by-user`).
              if (failure.message != "Google sign-in was canceled.") onError(failure.message)
            } finally {
              onBusy(false)
            }
          }
        },
        modifier = Modifier.testTag("sign-in-google"),
        enabled = enabled && !busy,
      )
    }
    if (passkey) {
      AuthButton(
        "Sign in with a passkey",
        onClick = {
          if (busy) return@AuthButton
          onBusy(true)
          working = "passkey"
          onError(null)
          scope.launch {
            try {
              services.auth.signInWithCustomToken(com.aglyn.screens.PasskeySignIn.token(services.api, relyingParty, asserter))
            } catch (failure: AuthError) {
              onError(failure.message)
            } catch (failure: kotlinx.coroutines.CancellationException) {
              throw failure
            } catch (failure: Throwable) {
              onError(com.aglyn.screens.PasskeySignIn.message(failure, services.config.brandName))
            } finally {
              onBusy(false)
              working = null
            }
          }
        },
        modifier = Modifier.testTag("sign-in-passkey"),
        kind = AuthButtonKind.SECONDARY,
        icon = Icons.Outlined.Lock,
        busy = working == "passkey",
        enabled = enabled && !busy,
      )
    }
    if (singleSignOn) {
      AuthButton(
        "Continue with SSO",
        onClick = { services.authFlow.screen = AuthScreen.SingleSignOn },
        modifier = Modifier.testTag("sign-in-sso"),
        kind = AuthButtonKind.SECONDARY,
        icon = Icons.Outlined.Key,
        enabled = enabled && !busy,
      )
    }
  }
}
