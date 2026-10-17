package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.MarketingConsent
import com.aglyn.core.SignUpRules
import com.aglyn.core.VerificationSend
import com.aglyn.core.WorkspaceName
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynLogo
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The signed-out app: whichever of the console's `(auth)` screens the flow is on. */
@Composable
fun SignedOutScreen(
  services: ShellServices,
  autoSignIn: Boolean = false,
  deviceModes: List<com.aglyn.pluginhost.NativeScreen> = emptyList(),
  onDeviceMode: (com.aglyn.pluginhost.NativeScreen) -> Unit = {},
) {
  when (val screen = services.authFlow.screen) {
    AuthScreen.SignIn -> SignInScreen(services, autoSignIn, deviceModes, onDeviceMode)
    AuthScreen.SignUp -> SignUpScreen(services)
    AuthScreen.AccountRecovery -> AccountRecoveryScreen(services)
    is AuthScreen.ResetPassword -> ResetPasswordScreen(services, screen.code)
    is AuthScreen.ConfirmEmail -> ConfirmEmailScreen(services, screen.code)
  }
}

/** The frame every signed-out screen shares: the logo, a heading and its line, the content, and a footer (`AuthFormComponent`). */
@Composable
internal fun AuthCard(
  services: ShellServices,
  title: String,
  subtitle: String? = null,
  footer: @Composable ColumnScope.() -> Unit = {},
  content: @Composable ColumnScope.() -> Unit,
) {
  val brand = services.config.brandName
  val appName = if (services.app == NativeApp.POS) "$brand POS" else brand
  // One centered column, 400 dp at most: flat on a phone, on a card where the window leaves room around it.
  val compact = currentWidthClass() == WidthClass.COMPACT
  val body: @Composable () -> Unit = {
    Column(
      Modifier.padding(horizontal = space(if (compact) 3f else 4f), vertical = space(4f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      // The colored lockup (white wordmark on dark ground), with the mark's height clear below it.
      AglynLogo(Modifier.padding(bottom = space(1f)).height(36.dp), contentDescription = appName)
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        if (subtitle != null) {
          Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      content()
      footer()
    }
  }
  Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
    Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
      if (compact) {
        Box(Modifier.widthIn(max = 400.dp).fillMaxWidth()) { body() }
      } else {
        Surface(
          Modifier.padding(space(3f)).widthIn(max = 448.dp).fillMaxWidth(),
          shape = MaterialTheme.shapes.extraLarge,
          color = MaterialTheme.colorScheme.surfaceContainerLowest,
          shadowElevation = 2.dp,
        ) { body() }
      }
    }
  }
}

/** A labelled field with the first rule its value breaks under it, once the person has tried to submit. */
@Composable
internal fun AuthTextField(
  label: String,
  value: String,
  onValueChange: (String) -> Unit,
  tag: String,
  modifier: Modifier = Modifier,
  error: String? = null,
  supporting: String? = null,
  password: Boolean = false,
  keyboardType: KeyboardType = KeyboardType.Text,
  imeAction: ImeAction = ImeAction.Next,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    label = { Text(label) },
    singleLine = true,
    isError = error != null,
    supportingText = (error ?: supporting)?.let { text -> { Text(text) } },
    visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
    keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
    modifier = modifier.fillMaxWidth().testTag(tag),
  )
}

/** A full-width primary action that shows progress while busy. */
@Composable
internal fun AuthPrimaryButton(text: String, busy: Boolean, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
  Button(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().height(48.dp).testTag(tag)) {
    if (busy) {
      CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
    } else {
      Text(text)
    }
  }
}

/** A form error under the fields, read out when it appears. */
@Composable
internal fun AuthErrorText(message: String) {
  Text(
    message,
    color = MaterialTheme.colorScheme.error,
    style = MaterialTheme.typography.bodyMedium,
    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("sign-in-error"),
  )
}

/** A line of text with a button-styled link after it ("Already have an account? Sign in"). */
@Composable
internal fun AuthLinkRow(lead: String?, action: String, tag: String, onClick: () -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    if (lead != null) Text(lead, style = MaterialTheme.typography.bodyMedium)
    TextButton(onClick = onClick, modifier = Modifier.testTag(tag)) { Text(action) }
  }
}

/** "<lead> Terms of Service and Privacy Policy.", each a link to the published document. */
@Composable
internal fun LegalLinksText(services: ShellServices, lead: String, modifier: Modifier = Modifier) {
  val origin = services.config.legalOrigin
  val style = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline))
  Text(
    buildAnnotatedString {
      append("$lead ")
      withLink(LinkAnnotation.Url("$origin/legal/terms", style)) { append("Terms of Service") }
      append(" and ")
      withLink(LinkAnnotation.Url("$origin/legal/privacy", style)) { append("Privacy Policy") }
      append(".")
    },
    style = MaterialTheme.typography.bodyMedium,
    modifier = modifier,
  )
}

/** A checkbox row (the console's `AuthCheckboxRow`). */
@Composable
internal fun AuthCheckRow(checked: Boolean, onChange: (Boolean) -> Unit, tag: String, label: @Composable () -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    Checkbox(checked = checked, onCheckedChange = onChange, modifier = Modifier.testTag(tag))
    Box(Modifier.weight(1f)) { label() }
  }
}

/**
 * Creating an account, as the console's `/signup` does: name, workspace name, email and password; the Terms of Service and
 * Privacy Policy agreed to; the optional product-updates opt-in; and the provider doors below, which the same agreement gates.
 */
@Composable
fun SignUpScreen(services: ShellServices) {
  val flow = services.authFlow
  var firstName by remember { mutableStateOf("") }
  var lastName by remember { mutableStateOf("") }
  var organization by remember { mutableStateOf("") }
  var email by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var confirm by remember { mutableStateOf("") }
  var consented by remember { mutableStateOf(false) }
  var consentError by remember { mutableStateOf(false) }
  var marketing by remember { mutableStateOf(false) }
  var tried by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var paused by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val brand = services.config.brandName
  LaunchedEffect(Unit) { paused = services.signUp.signupsPaused() }

  val problems = listOf(
    SignUpRules.firstName(firstName), SignUpRules.lastName(lastName), SignUpRules.organization(organization),
    SignUpRules.email(email), SignUpRules.password(password), SignUpRules.confirm(confirm, password),
  )

  /** The agreement every door checks first. */
  fun gate(): Boolean {
    if (paused != null) return false
    if (!consented) {
      consentError = true
      return false
    }
    return true
  }

  fun submit() {
    tried = true
    if (!gate() || problems.any { it != null } || busy) return
    busy = true
    error = null
    scope.launch {
      try {
        services.signUpWithPassword(firstName, lastName, organization, email, password, marketing)
      } catch (failure: AuthError) {
        error = failure.message
      } finally {
        busy = false
      }
    }
  }

  AuthCard(
    services,
    "Sign up",
    flow.plan?.signUpHeadline ?: "Create a new $brand Account",
    footer = {
      AuthLinkRow("Already have an account?", "Sign in", "sign-up-to-sign-in") { flow.reset() }
    },
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      AuthTextField("First name", firstName, { firstName = it }, "sign-up-first-name", Modifier.weight(1f), if (tried) problems[0] else null)
      AuthTextField("Last name", lastName, { lastName = it }, "sign-up-last-name", Modifier.weight(1f), if (tried) problems[1] else null)
    }
    AuthTextField(
      "Organization name", organization, { organization = it }, "sign-up-organization", error = if (tried) problems[2] else null,
      supporting = WorkspaceName.helper(services.config.workspaceDomain),
    )
    AuthTextField("Email", email, { email = it }, "sign-up-email", error = if (tried) problems[3] else null, keyboardType = KeyboardType.Email)
    AuthTextField("Password", password, { password = it }, "sign-up-password", error = if (tried) problems[4] else null, password = true)
    AuthTextField(
      "Confirm password", confirm, { confirm = it }, "sign-up-confirm", error = if (tried) problems[5] else null, password = true,
      imeAction = ImeAction.Done,
    )
    if (flow.consentBounceUid != null) {
      NoticeBanner(
        "Looks like you’re new here — please accept the Terms of Service and Privacy Policy to finish setting up your account.",
        StatusTone.INFO,
      )
    }
    AuthCheckRow(consented, { consented = it; if (it) consentError = false }, "sign-up-consent") {
      LegalLinksText(services, "I agree to $brand’s")
    }
    if (consentError) AuthErrorText("Please accept the Terms of Service and Privacy Policy to continue.")
    // Below the required acceptance and never part of it: the terms gate the sign-up, this gates nothing.
    AuthCheckRow(marketing, { marketing = it }, "sign-up-marketing") {
      Text(MarketingConsent.text(brand), style = MaterialTheme.typography.bodyMedium)
    }
    AuthPrimaryButton("Next", busy, "sign-up-submit", enabled = paused == null) { submit() }
    paused?.let { NoticeBanner("New signups are temporarily paused — $it", StatusTone.WARNING) }
    error?.let { AuthErrorText(it) }
    ProviderSignInButtons(services, ProviderMode.SIGN_UP, enabled = paused == null, gate = ::gate, busy = busy, onBusy = { busy = it }, onError = { error = it }, marketing = marketing)
  }
}

/** Asking for a password reset link (`/account-recovery`), through the console's own branded email. */
@Composable
fun AccountRecoveryScreen(services: ShellServices) {
  val flow = services.authFlow
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var sentTo by remember { mutableStateOf<String?>(null) }
  var tried by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  fun send(email: String) {
    if (busy) return
    busy = true
    error = null
    scope.launch {
      try {
        services.signUp.sendPasswordReset(email)
        sentTo = email.trim()
      } catch (failure: ConsoleApiError) {
        error = failure.message
      } finally {
        busy = false
      }
    }
  }

  val sent = sentTo
  if (sent != null) {
    AuthCard(
      services, "Check your email",
      "We sent a password reset link to $sent. Open it to choose a new password — the link expires after a short while.",
    ) {
      error?.let { AuthErrorText(it) }
      AuthLinkRow("Didn’t get it?", "Resend", "recovery-resend") { send(sent) }
      AuthLinkRow(null, "Back to sign in", "recovery-back") { flow.reset() }
    }
    return
  }
  AuthCard(
    services, "Account recovery", "Enter your email and we’ll send a link to reset your password",
    footer = { AuthLinkRow("Remembered your password?", "Sign in", "recovery-sign-in") { flow.reset() } },
  ) {
    AuthTextField(
      "Email", flow.email, { flow.email = it }, "recovery-email", error = if (tried) SignUpRules.email(flow.email) else null,
      keyboardType = KeyboardType.Email, imeAction = ImeAction.Done,
    )
    error?.let { AuthErrorText(it) }
    AuthPrimaryButton("Send reset link", busy, "recovery-submit") {
      tried = true
      if (SignUpRules.email(flow.email) == null) send(flow.email)
    }
  }
}

/** Choosing a new password from an emailed reset link (`/reset-password`). */
@Composable
fun ResetPasswordScreen(services: ShellServices, code: String) {
  val flow = services.authFlow
  // null while the code is checked; "" once it was refused.
  var email by remember(code) { mutableStateOf<String?>(null) }
  var invalid by remember(code) { mutableStateOf(false) }
  var done by remember(code) { mutableStateOf(false) }
  var password by remember { mutableStateOf("") }
  var confirm by remember { mutableStateOf("") }
  var tried by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(code) {
    if (code.isEmpty()) {
      invalid = true
      return@LaunchedEffect
    }
    try {
      email = services.auth.verifyPasswordResetCode(code)
    } catch (failure: AuthError) {
      error = failure.message
      invalid = true
    }
  }
  when {
    invalid -> AuthCard(services, "Link expired", "This password reset link is invalid or has already been used.") {
      error?.let { AuthErrorText(it) }
      AuthLinkRow(null, "Request a new reset link", "reset-request") { flow.screen = AuthScreen.AccountRecovery }
    }
    done -> AuthCard(services, "Password updated", "Your password has been reset. Sign in with your new password.") {
      AuthPrimaryButton("Go to sign in", false, "reset-sign-in") { flow.reset() }
    }
    email == null -> AuthCard(services, "Reset password", "Verifying your link") {
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
    else -> AuthCard(
      services, "Choose a new password", if (email.isNullOrEmpty()) "Enter a new password for your account" else "for $email",
      footer = { AuthLinkRow(null, "Back to sign in", "reset-back") { flow.reset() } },
    ) {
      AuthTextField("Password", password, { password = it }, "reset-password", error = if (tried) SignUpRules.password(password) else null, password = true)
      AuthTextField(
        "Confirm password", confirm, { confirm = it }, "reset-confirm", error = if (tried) SignUpRules.confirm(confirm, password) else null,
        password = true, imeAction = ImeAction.Done,
      )
      error?.let { AuthErrorText(it) }
      AuthPrimaryButton("Reset password", busy, "reset-submit") {
        tried = true
        if (SignUpRules.password(password) != null || SignUpRules.confirm(confirm, password) != null || busy) return@AuthPrimaryButton
        busy = true
        error = null
        scope.launch {
          try {
            services.auth.confirmPasswordReset(code, password)
            done = true
          } catch (failure: AuthError) {
            error = failure.message
          } finally {
            busy = false
          }
        }
      }
    }
  }
}

/**
 * Confirming an address from an emailed verification link (`/verify-email?oobCode=…`), whoever is signed in: one press
 * confirms it, so a link scanner opening the link changes nothing.
 */
@Composable
fun ConfirmEmailScreen(services: ShellServices, code: String) {
  val flow = services.authFlow
  var stage by remember(code) { mutableStateOf("confirm") }
  val scope = rememberCoroutineScope()
  val brand = services.config.brandName
  when (stage) {
    "confirm" -> AuthCard(services, "Verify your email", "Confirm this is your email address") {
      Text("Press the button to finish setting up your $brand account. If you didn’t sign up, close this page and nothing happens.")
      AuthPrimaryButton("Confirm my email", false, "confirm-email") {
        stage = "applying"
        scope.launch {
          stage = try {
            services.auth.applyActionCode(code)
            "applied"
          } catch (_: AuthError) {
            "failed"
          }
        }
      }
    }
    "applying" -> AuthCard(services, "One moment", "Verifying your email") {
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
    "applied" -> AuthCard(services, "Email verified", "Your email address is confirmed.") {
      AuthPrimaryButton("Sign in to continue", false, "confirm-continue") {
        flow.pendingVerificationCode = null
        flow.reset()
      }
    }
    else -> AuthCard(services, "Verify your email", "This link has expired or was already used") {
      Text("If you already opened it once, your email is verified — sign in to continue. If not, sign in and we’ll send you a new link.")
      AuthPrimaryButton("Sign in", false, "confirm-sign-in") {
        flow.pendingVerificationCode = null
        flow.reset()
      }
    }
  }
}

/**
 * The verification step a signed-in account with an unconfirmed address meets before anything else (`/verify-email`): the link
 * is sent once on arrival, the account is re-read every few seconds, and "I’ve verified" checks at once. A verification link
 * opened in the app is confirmed here too.
 */
@Composable
fun VerifyEmailScreen(services: ShellServices, email: String?) {
  var sent by remember { mutableStateOf(false) }
  var sending by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val pending = services.authFlow.pendingVerificationCode

  suspend fun send(automatic: Boolean) {
    if (sending) return
    sending = true
    error = null
    when (val outcome = services.signUp.sendVerification(automatic)) {
      VerificationSend.Sent -> sent = true
      VerificationSend.AlreadyVerified -> services.auth.reload()
      is VerificationSend.Failed -> error = outcome.message
    }
    sending = false
  }

  LaunchedEffect(Unit) {
    if (services.authFlow.pendingVerificationCode == null) send(automatic = true)
    while (true) {
      delay(4_000)
      services.auth.reload()
    }
  }
  LaunchedEffect(pending) {
    val code = pending ?: return@LaunchedEffect
    services.authFlow.pendingVerificationCode = null
    if (services.authFlow.screen is AuthScreen.ConfirmEmail) services.authFlow.screen = AuthScreen.SignIn
    try {
      services.auth.applyActionCode(code)
    } catch (_: AuthError) {
      error = "That verification link has expired or was already used. Send yourself a new one below."
    }
  }

  AuthCard(
    services, "Verify your email",
    "We sent a verification link to ${email ?: "your email address"}. Open it to activate your account — this page updates on its own once you do.",
    footer = { AuthLinkRow("Wrong account?", "Sign out", "verify-sign-out") { scope.launch { services.signOut() } } },
  ) {
    AuthPrimaryButton("I’ve verified — continue", false, "verify-continue") { scope.launch { services.auth.reload() } }
    AuthLinkRow(if (sent) "Didn’t get it?" else null, "Resend verification email", "verify-resend") { scope.launch { send(automatic = false) } }
    error?.let { AuthErrorText(it) }
  }
}
