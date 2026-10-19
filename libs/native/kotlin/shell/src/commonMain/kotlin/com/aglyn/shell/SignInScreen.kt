package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import com.aglyn.ui.AuthButton
import com.aglyn.ui.AuthButtonKind
import com.aglyn.ui.AuthButtonSize
import com.aglyn.ui.AuthNotice
import com.aglyn.ui.AuthTextLink
import com.aglyn.ui.AuthTokens
import com.aglyn.ui.AuthType
import com.aglyn.ui.OrDivider
import com.aglyn.ui.StatusTone
import kotlinx.coroutines.launch

/** Email and password sign-in against Firebase Auth, the console's own accounts (`/signin`). */
@Composable
fun SignInScreen(
  services: ShellServices,
  autoSignIn: Boolean = false,
  /** The whole-screen modes a plugin offers this tablet instead of a register (the POS app only). */
  deviceModes: List<com.aglyn.pluginhost.NativeScreen> = emptyList(),
  onDeviceMode: (com.aglyn.pluginhost.NativeScreen) -> Unit = {},
  /** The heading in place of "Sign in" (or the POS app's), e.g. "Add an account"; null keeps the default. */
  title: String? = null,
  /** The line under the heading in place of the default; null keeps it. */
  subtitle: String? = null,
) {
  val flow = services.authFlow
  // A debug build fills its seeded member in, but never while adding a second account (that member is already in).
  val adding = services.accounts?.adding?.collectAsState()?.value != null
  LaunchedEffect(Unit) { if (!adding) services.debugSignIn?.first?.let { if (flow.email.isEmpty()) flow.email = it } }
  var password by remember { mutableStateOf(if (adding) "" else services.debugSignIn?.second ?: "") }
  var busy by remember { mutableStateOf(false) }
  /** The password door is working (the provider doors share [busy], which disables every button). */
  var submitting by remember { mutableStateOf(false) }
  /** The password door's refusal, under the password field. */
  var error by remember { mutableStateOf<String?>(null) }
  /** A provider door's failure, above the provider buttons. */
  var providerError by remember { mutableStateOf<String?>(null) }
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
    submitting = true
    error = null
    providerError = null
    flow.handoffError = null
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
        submitting = false
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
    title ?: if (pos) "Sign in to $brand POS" else "Sign in",
    subtitle ?: if (pos) "Sign in to take payments at your store." else "Use your $brand account",
    accessory = { AuthTextLink("Create account", { flow.screen = AuthScreen.SignUp }, Modifier.testTag("sign-in-create-account")) },
    footer = {
      AuthLinkRow("Having trouble logging in?", "Account recovery", "sign-in-account-recovery") { flow.screen = AuthScreen.AccountRecovery }
    },
  ) {
    AuthTextField("Email", flow.email, { flow.email = it }, "sign-in-email", keyboardType = KeyboardType.Email, placeholder = "you@example.com")
    AuthTextField(
      "Password", password, { password = it }, "sign-in-password", password = true, imeAction = ImeAction.Done,
      error = error ?: flow.handoffError, onSubmit = { submit() },
    )
    AuthPrimaryButton("Sign in", submitting, "sign-in-submit") { submit() }
    providerError?.let { AuthErrorText(it) }
    ProviderSignInButtons(services, ProviderMode.SIGN_IN, busy = busy, onBusy = { busy = it }, onError = { providerError = it })
    LegalLinksText(services, "By continuing, you agree to $brand’s")
    if (deviceModes.isNotEmpty()) {
      Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Not a register?", style = AuthType.headline, color = AuthTokens.Colors.textPrimary.current)
        Text(
          "Set this device up as a screen for your customers. A code from a register pairs it.",
          style = AuthType.body,
          color = AuthTokens.Colors.textSecondary.current,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          for (mode in deviceModes) {
            AuthButton(
              mode.title, { onDeviceMode(mode) }, Modifier.testTag("device-mode-${mode.id}"),
              kind = AuthButtonKind.SECONDARY, size = AuthButtonSize.MEDIUM, fullWidth = false,
            )
          }
        }
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
    OrDivider()
    AuthButton(
      "Create account", { start(com.aglyn.core.ConsoleHandoff.Start.SIGN_UP) }, Modifier.testTag("sign-up-browser"),
      kind = AuthButtonKind.SECONDARY, enabled = !busy,
    )
    AuthButton(
      "Continue with SSO", { start(com.aglyn.core.ConsoleHandoff.Start.SINGLE_SIGN_ON) }, Modifier.testTag("sign-in-sso"),
      kind = AuthButtonKind.SECONDARY, icon = Icons.Outlined.Key, enabled = !busy,
    )
    LegalLinksText(services, "By continuing, you agree to $brand’s")
  }
}

/**
 * Workspace single sign-on (`/sso`): the work email first, then the organization's own sign-in page through the console and the
 * one-time hand-off back to the app. A domain the console knows says so before the person continues.
 */
@Composable
fun SingleSignOnScreen(services: ShellServices) {
  val flow = services.authFlow
  var busy by remember { mutableStateOf(false) }
  var tried by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var recognized by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(flow.email) {
    recognized = null
    val email = flow.email.trim()
    if (com.aglyn.core.SignUpRules.email(email) != null) return@LaunchedEffect
    kotlinx.coroutines.delay(400)
    if (services.signUp.usesSingleSignOn(email)) recognized = email.substringAfter('@')
  }

  fun submit() {
    tried = true
    val email = flow.email.trim()
    if (com.aglyn.core.SignUpRules.email(email) != null || busy) return
    busy = true
    error = null
    scope.launch {
      try {
        services.signInThroughConsole(com.aglyn.core.ConsoleHandoff.Start.SINGLE_SIGN_ON, loginHint = email)
      } catch (failure: AuthError) {
        error = failure.message
      } finally {
        busy = false
      }
    }
  }

  AuthCard(
    services,
    "Single sign-on",
    "Enter your work email and we’ll take you to your organization’s sign-in",
    footer = { AuthLinkRow(null, "Back to sign in", "sso-back") { flow.reset() } },
  ) {
    AuthTextField(
      "Work email", flow.email, { flow.email = it }, "sso-email", keyboardType = KeyboardType.Email, imeAction = ImeAction.Go,
      placeholder = "you@company.com", error = (if (tried) com.aglyn.core.SignUpRules.email(flow.email) else null) ?: error ?: flow.handoffError,
      onSubmit = { submit() },
    )
    recognized?.let {
      AuthNotice(
        "$it signs in with single sign-on. You’ll continue at your organization’s sign-in page.", Icons.Outlined.Key, StatusTone.INFO,
        Modifier.testTag("sso-routing"),
      )
    }
    AuthPrimaryButton("Continue with SSO", busy, "sso-submit") { submit() }
  }
}
