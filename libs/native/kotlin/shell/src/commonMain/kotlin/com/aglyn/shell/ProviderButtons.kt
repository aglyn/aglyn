package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.ui.space
import kotlinx.coroutines.launch

enum class ProviderMode { SIGN_IN, SIGN_UP }

/**
 * The doors under a sign-in or sign-up form besides the password: a passkey on sign-in where the build has a relying party
 * and the platform bound a way to sign in with one (the console's sign-in page offers one too).
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
  if (!passkey) return
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      HorizontalDivider(Modifier.weight(1f))
      Text(
        if (mode == ProviderMode.SIGN_UP) "Or sign up with" else "Or sign in with",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      HorizontalDivider(Modifier.weight(1f))
    }
    if (passkey) {
      OutlinedButton(
        onClick = {
          if (busy || asserter == null || relyingParty == null) return@OutlinedButton
          onBusy(true)
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
            }
          }
        },
        enabled = enabled && !busy,
        modifier = Modifier.fillMaxWidth().height(48.dp).testTag("sign-in-passkey"),
      ) { Text("Passkey") }
    }
  }
}
