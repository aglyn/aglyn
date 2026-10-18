package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.MarketingConsent
import com.aglyn.core.SignUpRules
import com.aglyn.core.VerificationSend
import com.aglyn.core.WorkspaceName
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynLogo
import com.aglyn.ui.AuthButton
import com.aglyn.ui.AuthInput
import com.aglyn.ui.AuthNotice
import com.aglyn.ui.AuthTextLink
import com.aglyn.ui.AuthTokens
import com.aglyn.ui.AuthType
import com.aglyn.ui.FieldMessage
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
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
    AuthScreen.SingleSignOn -> SingleSignOnScreen(services)
    is AuthScreen.ResetPassword -> ResetPasswordScreen(services, screen.code)
    is AuthScreen.ConfirmEmail -> ConfirmEmailScreen(services, screen.code)
  }
}

/** How far the destination card still has to rise, and how visible it is, while the launch intro reveals it. */
data class AuthReveal(val rise: Float = 0f, val alpha: Float = 1f)

val LocalAuthReveal = compositionLocalOf { AuthReveal() }

private val C = AuthTokens.Colors
private val M = AuthTokens.Metrics

/**
 * The one layout every signed-out screen shares (Figma "Sign in & launch", AGL-3934): the logo-kit lockup top-left over the
 * Facets ground (which the shell draws behind every auth screen, so it holds still as screens change), then the raised card with
 * the heading, an optional link at its top right, the screen's content, and the footer centered under the card. On a phone the
 * card spans the screen less 16 dp margins under the lockup; on a tablet or the desktop it is 440 wide and centered.
 */
@Composable
internal fun AuthCard(
  services: ShellServices,
  title: String,
  subtitle: String? = null,
  icon: ImageVector? = null,
  accessory: (@Composable () -> Unit)? = null,
  footer: @Composable ColumnScope.() -> Unit = {},
  content: @Composable ColumnScope.() -> Unit,
) {
  val brand = services.config.brandName
  val appName = if (services.app == NativeApp.POS) "$brand POS" else brand
  val compact = currentWidthClass() == WidthClass.COMPACT
  val reveal = LocalAuthReveal.current
  val leading = if (compact) M.LOCKUP_LEADING_COMPACT else M.LOCKUP_LEADING_REGULAR
  val top = if (compact) M.LOCKUP_TOP_COMPACT else M.LOCKUP_CLEAR_SPACE
  val cardTop = top + M.LOCKUP_HEIGHT + if (compact) M.CARD_GAP_BELOW_LOCKUP else M.LOCKUP_CLEAR_SPACE
  BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
    val height = maxHeight
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
      Box(Modifier.fillMaxWidth().heightIn(min = height)) {
        // The logo-kit lockup (white wordmark on the dark ground), its clear space around it.
        AglynLogo(Modifier.padding(start = leading.dp, top = top.dp).height(M.LOCKUP_HEIGHT.dp), contentDescription = appName)
        Column(
          Modifier
            .align(if (compact) Alignment.TopCenter else Alignment.Center)
            .padding(top = cardTop.dp, bottom = M.LOCKUP_CLEAR_SPACE.dp)
            .padding(horizontal = if (compact) M.CARD_MARGIN_COMPACT.dp else M.CARD_PADDING_REGULAR.dp)
            .widthIn(max = if (compact) Dp.Unspecified else M.CARD_WIDTH_TABLET.dp)
            .fillMaxWidth()
            .graphicsLayer { translationY = reveal.rise.dp.toPx(); alpha = reveal.alpha },
          verticalArrangement = Arrangement.spacedBy(14.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          val shape = RoundedCornerShape(M.CARD_RADIUS.dp)
          Column(
            Modifier
              .fillMaxWidth()
              .shadow(16.dp, shape, ambientColor = C.shadow.current.copy(alpha = 0.10f), spotColor = C.shadow.current.copy(alpha = 0.22f))
              .background(C.raised.current, shape)
              .border(1.dp, C.borderSubtle.current, shape)
              .padding(if (compact) M.CARD_PADDING_COMPACT.dp else M.CARD_PADDING_REGULAR.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) M.CARD_SPACING_COMPACT.dp else M.CARD_SPACING_REGULAR.dp),
          ) {
            if (icon != null) {
              Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(Modifier.size(56.dp).background(C.infoBackground.current, CircleShape), contentAlignment = Alignment.Center) {
                  Icon(icon, contentDescription = null, Modifier.size(26.dp), tint = C.infoForeground.current)
                }
              }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = AuthType.title, color = C.textPrimary.current, modifier = Modifier.semantics { heading() })
                if (subtitle != null) Text(subtitle, style = AuthType.body, color = C.textSecondary.current)
              }
              accessory?.invoke()
            }
            content()
          }
          footer()
        }
      }
    }
  }
}

/** A labelled field with the first rule its value breaks under it, once the person has tried to submit; the line wraps. */
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
  placeholder: String? = null,
  onSubmit: (() -> Unit)? = null,
) {
  AuthInput(
    label, value, onValueChange, modifier, placeholder = placeholder, error = error, supporting = supporting, password = password,
    keyboardType = keyboardType, imeAction = imeAction, onSubmit = onSubmit, fieldModifier = Modifier.testTag(tag),
    // A field's error is the form's error to a screen reader and a test alike.
    messageModifier = if (error != null) Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("sign-in-error") else Modifier,
  )
}

/** The card's primary action: full width, 48 dp, a spinner beside the label while busy. */
@Composable
internal fun AuthPrimaryButton(text: String, busy: Boolean, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
  AuthButton(text, onClick, Modifier.testTag(tag), busy = busy, enabled = enabled)
}

/** A form error under the fields, read out when it appears; it wraps to its full length. */
@Composable
internal fun AuthErrorText(message: String) {
  FieldMessage(message, isError = true, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("sign-in-error"))
}

/** A footer line: a sentence and its link ("Already have an account? Sign in"), centered. */
@Composable
internal fun AuthLinkRow(lead: String?, action: String, tag: String, onClick: () -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
    if (lead != null) Text(lead, style = AuthType.small, color = C.textSecondary.current)
    AuthTextLink(action, onClick, Modifier.testTag(tag))
  }
}

/** "<lead> Terms of Service and Privacy Policy.", each a link to the published document. */
@Composable
internal fun LegalLinksText(services: ShellServices, lead: String, modifier: Modifier = Modifier, style: TextStyle = AuthType.caption) {
  val origin = services.config.legalOrigin
  val links = TextLinkStyles(SpanStyle(color = C.textPrimary.current, textDecoration = TextDecoration.Underline))
  Text(
    buildAnnotatedString {
      append("$lead ")
      withLink(LinkAnnotation.Url("$origin/legal/terms", links)) { append("Terms of Service") }
      append(" and ")
      withLink(LinkAnnotation.Url("$origin/legal/privacy", links)) { append("Privacy Policy") }
      append(".")
    },
    style = style,
    color = C.textSecondary.current,
    modifier = modifier,
  )
}

/** A checkbox row (the console's `AuthCheckboxRow`). */
@Composable
internal fun AuthCheckRow(checked: Boolean, onChange: (Boolean) -> Unit, tag: String, label: @Composable () -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    Checkbox(
      checked = checked, onCheckedChange = onChange, modifier = Modifier.testTag(tag),
      colors = CheckboxDefaults.colors(checkedColor = C.primary.current, uncheckedColor = C.borderStrong.current),
    )
    Box(Modifier.weight(1f)) { CompositionLocalProvider(LocalTextStyle provides AuthType.small) { label() } }
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
    flow.plan?.signUpHeadline ?: "Create a new $brand account",
    footer = {
      AuthLinkRow("Already have an account?", "Sign in", "sign-up-to-sign-in") { flow.reset() }
    },
  ) {
    paused?.let { AuthNotice("New signups are temporarily paused — $it", Icons.Outlined.WarningAmber, StatusTone.WARNING, Modifier.testTag("sign-up-paused")) }
    if (flow.consentBounceUid != null) {
      AuthNotice(
        "Looks like you’re new here — please accept the Terms of Service and Privacy Policy to finish setting up your account.",
        Icons.Outlined.Info, StatusTone.INFO,
      )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      AuthTextField("First name", firstName, { firstName = it }, "sign-up-first-name", Modifier.weight(1f), if (tried) problems[0] else null)
      AuthTextField("Last name", lastName, { lastName = it }, "sign-up-last-name", Modifier.weight(1f), if (tried) problems[1] else null)
    }
    AuthTextField(
      "Organization name", organization, { organization = it }, "sign-up-organization", error = if (tried) problems[2] else null,
      supporting = WorkspaceName.helper(services.config.workspaceDomain),
    )
    AuthTextField(
      "Email", email, { email = it }, "sign-up-email", error = if (tried) problems[3] else null, keyboardType = KeyboardType.Email,
      placeholder = "you@example.com",
    )
    AuthTextField(
      "Password", password, { password = it }, "sign-up-password", error = if (tried) problems[4] else null, password = true,
      supporting = PASSWORD_HELP,
    )
    AuthTextField(
      "Confirm password", confirm, { confirm = it }, "sign-up-confirm", error = if (tried) problems[5] else null, password = true,
      imeAction = ImeAction.Done,
    )
    AuthCheckRow(consented, { consented = it; if (it) consentError = false }, "sign-up-consent") {
      LegalLinksText(services, "I agree to $brand’s", style = AuthType.small)
    }
    if (consentError) AuthErrorText("Please accept the Terms of Service and Privacy Policy to continue.")
    // Below the required acceptance and never part of it: the terms gate the sign-up, this gates nothing.
    AuthCheckRow(marketing, { marketing = it }, "sign-up-marketing") {
      Text(MarketingConsent.text(brand), style = AuthType.small, color = C.textPrimary.current)
    }
    AuthPrimaryButton("Next", busy, "sign-up-submit", enabled = paused == null) { submit() }
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
      icon = Icons.Outlined.Email,
      footer = { AuthLinkRow(null, "Back to sign in", "recovery-back") { flow.reset() } },
    ) {
      error?.let { AuthErrorText(it) }
      AuthLinkRow("Didn’t get it?", "Resend", "recovery-resend") { send(sent) }
    }
    return
  }
  AuthCard(
    services, "Account recovery", "Enter your email and we’ll send a link to reset your password",
    footer = { AuthLinkRow("Remembered your password?", "Sign in", "recovery-sign-in") { flow.reset() } },
  ) {
    AuthTextField(
      "Email", flow.email, { flow.email = it }, "recovery-email", error = (if (tried) SignUpRules.email(flow.email) else null) ?: error,
      keyboardType = KeyboardType.Email, imeAction = ImeAction.Done, placeholder = "you@example.com",
    )
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
    invalid -> AuthCard(
      services, "Link expired", "This password reset link is invalid or has already been used.",
      footer = { AuthLinkRow(null, "Back to sign in", "reset-back") { flow.reset() } },
    ) {
      error?.let { AuthErrorText(it) }
      AuthPrimaryButton("Request a new reset link", false, "reset-request") { flow.screen = AuthScreen.AccountRecovery }
    }
    done -> AuthCard(services, "Password updated", "Your password has been reset. Sign in with your new password.") {
      AuthPrimaryButton("Go to sign in", false, "reset-sign-in") { flow.reset() }
    }
    email == null -> AuthCard(services, "Reset password", "Verifying your link") {
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.primary.current) }
    }
    else -> AuthCard(
      services, "Choose a new password", if (email.isNullOrEmpty()) "Enter a new password for your account" else "for $email",
      footer = { AuthLinkRow(null, "Back to sign in", "reset-back") { flow.reset() } },
    ) {
      AuthTextField(
        "Password", password, { password = it }, "reset-password", error = if (tried) SignUpRules.password(password) else null, password = true,
        supporting = PASSWORD_HELP,
      )
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
      Text("Press the button to finish setting up your $brand account. If you didn’t sign up, close this page and nothing happens.", style = AuthType.body, color = C.textPrimary.current)
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
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.primary.current) }
    }
    "applied" -> AuthCard(services, "Email verified", "Your email address is confirmed.") {
      AuthPrimaryButton("Sign in to continue", false, "confirm-continue") {
        flow.pendingVerificationCode = null
        flow.reset()
      }
    }
    else -> AuthCard(services, "Verify your email", "This link has expired or was already used") {
      Text("If you already opened it once, your email is verified — sign in to continue. If not, sign in and we’ll send you a new link.", style = AuthType.body, color = C.textPrimary.current)
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
    icon = Icons.Outlined.Email,
    footer = { AuthLinkRow("Wrong account?", "Sign out", "verify-sign-out") { scope.launch { services.signOut() } } },
  ) {
    AuthPrimaryButton("I’ve verified — continue", false, "verify-continue") { scope.launch { services.auth.reload() } }
    AuthLinkRow(if (sent) "Didn’t get it?" else null, "Resend verification email", "verify-resend") { scope.launch { send(automatic = false) } }
    error?.let { AuthErrorText(it) }
  }
}

/** The password rule (`SignUpRules.password`) as one line under a new-password field. */
internal const val PASSWORD_HELP = "6–30 characters, with a lowercase and an uppercase letter, a number and a symbol."
