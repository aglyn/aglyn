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
    if (email.isBlank()) {
      error = "Enter your email and password."
      return
    }
    busy = true
    error = null
    scope.launch {
      try {
        // Email first, as the console's `/sso` discovers it: an address on a workspace's single sign-on domain lives in that
        // workspace's identity pool, so it signs in through its identity provider, never with a project-pool password.
        if (services.consoleHandoff != null && services.signUp.usesSingleSignOn(email)) {
          services.signInThroughConsole(com.aglyn.core.ConsoleHandoff.Start.SINGLE_SIGN_ON, loginHint = email.trim())
          return@launch
        }
        if (password.isEmpty()) {
          error = "Enter your email and password."
          return@launch
        }
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

  if (services.signInThroughConsoleOnly) {
    ConsoleSignInScreen(services)
    return
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
    (error ?: flow.handoffError)?.let { AuthErrorText(it) }
    AuthPrimaryButton("Sign in", busy, "sign-in-submit") { submit() }
    ProviderSignInButtons(services, ProviderMode.SIGN_IN, busy = busy, onBusy = { busy = it }, onError = { error = it })
    LegalLinksText(services, "By continuing, you agree to $brand’s")
    if (deviceModes.isNotEmpty()) {
      HorizontalDivider()
      Text("Not a register?", style = MaterialTheme.typography.titleMedium)
      Text(
        "Use this device as a screen for your customers. A code from a register pairs it.",
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

/**
 * The Windows build's sign-in against a project that enforces App Check (AGL-3816): every door is the console's, in the
 * system browser, with the one-time hand-off back to this app. Sign-in, sign-up and single sign-on each start on their own
 * console page.
 */
@Composable
private fun ConsoleSignInScreen(services: ShellServices) {
  val flow = services.authFlow
  var busy by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val brand = services.config.brandName
  val pos = services.app == NativeApp.POS

  fun start(page: com.aglyn.core.ConsoleHandoff.Start) {
    if (busy) return
    busy = true
    flow.handoffError = null
    scope.launch {
      try {
        services.signInThroughConsole(page)
      } catch (failure: AuthError) {
        flow.handoffError = failure.message
      } finally {
        busy = false
      }
    }
  }

  AuthCard(
    services,
    if (pos) "Sign in to $brand POS" else "Sign in",
    "Sign in or create your $brand account in your browser, and this app picks it up.",
  ) {
    flow.handoffError?.let { AuthErrorText(it) }
    AuthPrimaryButton("Sign in with your browser", busy, "sign-in-browser") { start(com.aglyn.core.ConsoleHandoff.Start.SIGN_IN) }
    OutlinedButton(
      onClick = { start(com.aglyn.core.ConsoleHandoff.Start.SIGN_UP) },
      enabled = !busy,
      modifier = Modifier.fillMaxWidth().height(48.dp).testTag("sign-up-browser"),
    ) { Text("Create account") }
    OutlinedButton(
      onClick = { start(com.aglyn.core.ConsoleHandoff.Start.SINGLE_SIGN_ON) },
      enabled = !busy,
      modifier = Modifier.fillMaxWidth().height(48.dp).testTag("sign-in-sso"),
    ) { Text("Single sign-on (SSO)") }
    LegalLinksText(services, "By continuing, you agree to $brand’s")
  }
}
