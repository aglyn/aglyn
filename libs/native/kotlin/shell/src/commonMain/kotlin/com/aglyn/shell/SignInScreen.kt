package com.aglyn.shell

import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.core.isCredentialRefusal
import com.aglyn.pluginhost.NativeApp
import kotlinx.coroutines.launch

/** Email and password sign-in against Firebase Auth, the console's own accounts (`/signin`). */
@Composable
fun SignInScreen(
  services: ShellServices,
  autoSignIn: Boolean = false,
  /** The whole-screen modes a plugin offers this tablet instead of a register (the POS app only). */
  deviceModes: List<com.aglyn.pluginhost.NativeScreen> = emptyList(),
  onDeviceMode: (com.aglyn.pluginhost.NativeScreen) -> Unit = {},
) {
  val flow = services.authFlow
  LaunchedEffect(Unit) { services.debugSignIn?.first?.let { if (flow.email.isEmpty()) flow.email = it } }
  var password by remember { mutableStateOf(services.debugSignIn?.second ?: "") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val brand = services.config.brandName
  val pos = services.app == NativeApp.POS

  fun submit() {
    if (busy) return
    val email = flow.email
    if (email.isBlank() || password.isEmpty()) {
      error = "Enter your email and password."
      return
    }
    busy = true
    error = null
    scope.launch {
      try {
        try {
          services.auth.signInWithEmail(email, password)
        } catch (failure: AuthError) {
          // On a credential refusal alone, once more with the account's primary address when the typed one is a confirmed
          // secondary (`/api/auth/resolve-identifier`, AGL-2486).
          val resolved = if (isCredentialRefusal(failure.code)) services.signUp.resolveIdentifier(email) else null
          if (resolved == null) throw failure
          services.auth.signInWithEmail(resolved, password)
        }
      } catch (failure: AuthError) {
        error = failure.message
      } finally {
        busy = false
      }
    }
  }

  LaunchedEffect(Unit) {
    if (autoSignIn && services.debugSignIn != null) {
      flow.email = services.debugSignIn.first
      submit()
    }
  }

  AuthCard(
    services,
    if (pos) "Sign in to $brand POS" else "Sign in",
    if (pos) "Take payments at your store's register." else "Use your $brand account",
    footer = {
      AuthLinkRow("Having trouble logging in?", "Account recovery", "sign-in-account-recovery") { flow.screen = AuthScreen.AccountRecovery }
      AuthLinkRow("New to $brand?", "Create account", "sign-in-create-account") { flow.screen = AuthScreen.SignUp }
    },
  ) {
    AuthTextField("Email", flow.email, { flow.email = it }, "sign-in-email", keyboardType = KeyboardType.Email)
    AuthTextField("Password", password, { password = it }, "sign-in-password", password = true, imeAction = ImeAction.Done)
    error?.let { AuthErrorText(it) }
    AuthPrimaryButton("Sign in", busy, "sign-in-submit") { submit() }
    ProviderSignInButtons(services, ProviderMode.SIGN_IN, busy = busy, onBusy = { busy = it }, onError = { error = it })
    LegalLinksText(services, "By continuing, you agree to $brand’s")
    if (deviceModes.isNotEmpty()) {
      HorizontalDivider()
      Text("Not a register?", style = MaterialTheme.typography.titleMedium)
      Text(
        "Set this tablet up as a screen for your customers. A code from a register pairs it.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      for (mode in deviceModes) {
        OutlinedButton(
          onClick = { onDeviceMode(mode) },
          modifier = Modifier.fillMaxWidth().height(48.dp).testTag("device-mode-${mode.id}"),
        ) { Text(mode.title) }
      }
    }
  }
}
