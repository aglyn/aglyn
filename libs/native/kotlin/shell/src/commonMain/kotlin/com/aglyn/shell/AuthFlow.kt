package com.aglyn.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.AuthError
import com.aglyn.core.AuthState
import com.aglyn.core.AuthUser
import com.aglyn.core.OnboardingPlanIntent
import com.aglyn.core.PendingSignUpWorkspace
import com.aglyn.core.SignUpDoor
import com.aglyn.core.UtmAttribution
import com.aglyn.core.WorkspaceState
import com.aglyn.core.derivedWorkspaceName
import com.aglyn.core.queryParams
import com.aglyn.pluginhost.DeepLinks

/** Which of the console's `(auth)` pages the signed-out app shows. */
sealed interface AuthScreen {
  data object SignIn : AuthScreen
  data object SignUp : AuthScreen
  data object AccountRecovery : AuthScreen
  /** An emailed reset link's code (`/reset-password?oobCode=…&mode=resetPassword`); empty when the link carried none. */
  data class ResetPassword(val code: String) : AuthScreen
  /** An emailed verification link's code (`/verify-email?oobCode=…`), opened by someone who may not be signed in. */
  data class ConfirmEmail(val code: String) : AuthScreen
}

/** What the first verified session found when the account has no workspace yet (the console's workspace chooser). */
sealed interface FirstRunState {
  data object Idle : FirstRunState
  /** The held sign-up name is being claimed and its workspace created. */
  data object Provisioning : FirstRunState
  /** The workspace the sign-up form named could not be created (AGL-1523): said, and offered back. */
  data class Failed(val name: String, val error: String?) : FirstRunState
}

/**
 * Where the signed-out app is, and what a sign-up carries across its steps: the console's `/signin`, `/signup`,
 * `/account-recovery`, `/reset-password` and `/verify-email` as one state. Twin of the Apple app's `AuthFlow`.
 */
class AuthFlow {
  var screen by mutableStateOf<AuthScreen>(AuthScreen.SignIn)
  /** The address typed on one screen, carried to the next (sign in → account recovery). */
  var email by mutableStateOf("")
  /** The plan the sign-up link carried (`?plan=pro&interval=year`). */
  var plan by mutableStateOf<OnboardingPlanIntent?>(null)
  /** The campaign the sign-up link carried. */
  var campaign by mutableStateOf<UtmAttribution?>(null)
  /**
   * A Google sign-in that created an account was stood down for want of consent (AGL-1497): the sign-up page says so, and
   * the next Google sign-up for this account counts as its sign-up although Firebase no longer calls it new.
   */
  var consentBounceUid by mutableStateOf<String?>(null)
  /**
   * True while a sign-up is landing: the account exists, so the app is signed in, but its records and workspace are still
   * being written. The sign-up screen stays up until they settle (the console's sign-up landing hold, AGL-3578).
   */
  var landing by mutableStateOf(false)
  /** A verification code opened while signed in and not yet confirmed, for the verification step to apply. */
  var pendingVerificationCode by mutableStateOf<String?>(null)
  /** A console link to open once the shell is up: where a new workspace with a plan lands. */
  var landingLink by mutableStateOf<String?>(null)
  var firstRun by mutableStateOf<FirstRunState>(FirstRunState.Idle)
  /** A console sign-in in flight (single sign-on, the desktop's sign-in): what the app keeps until the code comes back. */
  var pendingHandoff by mutableStateOf<com.aglyn.core.ConsoleHandoff.Pending?>(null)
  /** Why the last console sign-in failed, for the sign-in screen. */
  var handoffError by mutableStateOf<String?>(null)
  internal var firstRunSettledFor: String? = null

  /**
   * Opens a console auth link (an App Link to the console, or `aglyn://`): true when it was one. Signed in, a verification
   * link is applied by the verification step (or has nothing left to do), and the rest have nothing to show; a sign-up
   * link's plan is handed to [onPlan], as the console's home page lands a signed-in visitor on billing.
   */
  fun open(link: String, signedIn: Boolean = false, onPlan: (OnboardingPlanIntent) -> Unit = {}): Boolean {
    val full = DeepLinks.consolePathOf(link) ?: return false
    val path = full.substringBefore('?').lowercase().trimEnd('/').ifEmpty { "/" }
    val query = if ('?' in full) queryParams(full.substringAfter('?')) else emptyMap()
    if (signedIn) {
      when (path) {
        "/verify-email" -> query["oobCode"]?.takeIf { it.isNotEmpty() }?.let { pendingVerificationCode = it }
        "/signup" -> OnboardingPlanIntent.parse(query)?.let(onPlan)
        "/signin", "/account-recovery", "/sso", "/reset-password" -> Unit
        else -> return false
      }
      return true
    }
    when (path) {
      "/signup" -> {
        plan = OnboardingPlanIntent.parse(query) ?: plan
        campaign = UtmAttribution.parse(query) ?: campaign
        screen = AuthScreen.SignUp
      }
      "/signin" -> screen = AuthScreen.SignIn
      "/account-recovery" -> screen = AuthScreen.AccountRecovery
      "/reset-password" -> {
        val code = query["oobCode"].orEmpty()
        screen = AuthScreen.ResetPassword(if ((query["mode"] ?: "resetPassword") == "resetPassword") code else "")
      }
      "/verify-email" -> {
        val code = query["oobCode"].orEmpty()
        if (code.isEmpty()) return true
        pendingVerificationCode = code
        screen = AuthScreen.ConfirmEmail(code)
      }
      else -> return false
    }
    return true
  }

  companion object {
    private val AUTH_PATHS = setOf("/signup", "/signin", "/account-recovery", "/sso", "/reset-password", "/verify-email")

    /** Whether [link] is one of the console's sign-in, sign-up, reset or verification pages, which [open] answers. */
    fun isAuthLink(link: String?): Boolean =
      DeepLinks.consolePathOf(link)?.substringBefore('?')?.lowercase()?.trimEnd('/') in AUTH_PATHS
  }

  /** Back to sign-in, keeping nothing a later sign-up could pick up. */
  fun reset() {
    screen = AuthScreen.SignIn
    consentBounceUid = null
  }
}

private fun ShellServices.signedInUser(): AuthUser? = (auth.state.value as? AuthState.SignedIn)?.user

/**
 * The email and password door (`/signup`'s form): the account, then the acceptance, attribution, plan, campaign, name and
 * opt-in, in the console's order; then the workspace name is held until the address is confirmed. Throws [AuthError] only
 * when the account could not be created.
 */
suspend fun ShellServices.signUpWithPassword(
  firstName: String,
  lastName: String,
  organization: String,
  email: String,
  password: String,
  marketing: Boolean,
) {
  authFlow.landing = true
  try {
    val user = auth.signUpWithEmail(email, password)
    signUp.recordAcceptance(SignUpDoor.PASSWORD)
    signUp.recordAcquisition(null)
    val display = listOf(firstName.trim(), lastName.trim()).filter { it.isNotEmpty() }.joinToString(" ")
    if (display.isNotEmpty()) runCatching { auth.updateDisplayName(display) }
    signUp.remember(user.uid, authFlow.plan, authFlow.campaign, firstName, lastName)
    if (marketing) signUp.recordMarketingOptIn()
    provisionAndLand(user, organization, nameWasTyped = true)
  } finally {
    authFlow.landing = false
  }
}

/**
 * A provider sign-up (Google) after its credential signed in: recorded, and provisioned only when it created the account, or
 * when sign-in stood this account down for consent (`isNewAccount`, `consumeConsentBounce`).
 */
suspend fun ShellServices.finishProviderSignUp(door: SignUpDoor, isNew: Boolean, marketing: Boolean) {
  val user = signedInUser() ?: return
  authFlow.landing = true
  try {
    signUp.recordAcceptance(door)
    signUp.recordAcquisition(door.acquisitionDoor)
    signUp.remember(user.uid, authFlow.plan, authFlow.campaign)
    if (marketing) signUp.recordMarketingOptIn()
    val bounced = authFlow.consentBounceUid == user.uid
    authFlow.consentBounceUid = null
    if (!bounced && !isNew) return
    provisionAndLand(signedInUser() ?: user, derivedWorkspaceName(user.displayName, user.email), nameWasTyped = false)
  } finally {
    authFlow.landing = false
  }
}

/**
 * Continue with Google from the sign-in or sign-up screen: the platform's Google sheet (every account on the device offered,
 * never one silently reused, AGL-1415), then the credential signs in. On sign-up the account is recorded and provisioned as the
 * console's Google door does; on sign-in a credential that created an account is stood down for the agreement (AGL-1497).
 */
suspend fun ShellServices.continueWithGoogle(source: com.aglyn.core.GoogleCredentialSource, signingUp: Boolean, marketing: Boolean) {
  val googleIdToken = source.idToken(null)
  if (signingUp) authFlow.landing = true
  try {
    val isNew = auth.signInWithGoogle(googleIdToken)
    if (signingUp) {
      finishProviderSignUp(SignUpDoor.GOOGLE, isNew, marketing)
    } else if (isNew) {
      standDownUnconsentedAccount()
    }
  } finally {
    if (signingUp) authFlow.landing = false
  }
}

/**
 * A provider sign-in from the sign-in screen that created an account: the person never saw the terms, so the account is
 * stood back down and they are sent to sign up, where the consent is (`rejectUnconsentedNewAccount`).
 */
suspend fun ShellServices.standDownUnconsentedAccount() {
  val user = signedInUser() ?: return
  signUp.recordAcquisition(null)
  authFlow.consentBounceUid = user.uid
  auth.signOut()
  authFlow.screen = AuthScreen.SignUp
}

/**
 * The one landing routine (`provisionAndLandSignUp`): a verified account's workspace is created now and the app lands in it;
 * an unverified one's name is held until the address is confirmed.
 */
private suspend fun ShellServices.provisionAndLand(user: AuthUser, name: String, nameWasTyped: Boolean) {
  if (!user.emailVerified) {
    signUp.holdWorkspace(user.uid, PendingSignUpWorkspace(name, nameWasTyped))
    return
  }
  val outcome = signUp.createWorkspace(name)
  val slug = outcome.slug
  val plan = authFlow.plan
  if (slug != null && plan != null) authFlow.landingLink = plan.destination(slug)
}

/**
 * The first verified session of an account with no workspace (the console's chooser, AGL-2590): the name the sign-up held
 * is claimed once and its workspace created; the plan it remembered then decides where the app lands.
 */
suspend fun ShellServices.settleFirstRun(workspace: WorkspaceState) {
  val user = signedInUser() ?: return
  if (!user.emailVerified || auth.impersonation.value != null || !workspace.ready || workspace.orgs.isNotEmpty()) return
  if (authFlow.firstRunSettledFor == user.uid) return
  authFlow.firstRunSettledFor = user.uid
  authFlow.firstRun = FirstRunState.Provisioning
  val pending = signUp.claimHeldWorkspace(user.uid, auth.providerIds())
  if (pending == null) {
    authFlow.firstRun = FirstRunState.Idle
    return
  }
  val outcome = signUp.createWorkspace(pending.name)
  val slug = outcome.slug
  if (slug != null) {
    signUp.consumePlanIntent(user.uid)?.let { authFlow.landingLink = it.destination(slug) }
    authFlow.firstRun = FirstRunState.Idle
    return
  }
  authFlow.firstRun = if (pending.nameWasTyped) FirstRunState.Failed(pending.name, outcome.error) else FirstRunState.Idle
}

/** "Create an organization" from the empty workspace list, or "Create it now" for the name sign-up could not use. Null on success. */
suspend fun ShellServices.createWorkspace(name: String): String? {
  val outcome = signUp.createWorkspace(name)
  if (outcome.slug != null) {
    authFlow.firstRun = FirstRunState.Idle
    return null
  }
  return outcome.error ?: "Organization creation failed"
}

/**
 * Signing in through the console (AGL-3816): single sign-on on every platform, and every sign-in and sign-up on the Windows
 * build. The platform opens the console's `/auth/native` page; its one-time code comes back (now, or later to the app's
 * scheme) and is traded, with this sign-in's verifier, for a custom token in the account's own pool.
 */
suspend fun ShellServices.signInThroughConsole(start: com.aglyn.core.ConsoleHandoff.Start, loginHint: String? = null) {
  val transport = consoleHandoff ?: throw AuthError("Signing in through ${config.brandName} is not available here.")
  authFlow.handoffError = null
  val callback = transport.run { redirectUri ->
    val pending = com.aglyn.core.ConsoleHandoff.begin(config.consoleOrigin, redirectUri, start, loginHint)
    authFlow.pendingHandoff = pending
    pending.url
  }
  if (callback != null) finishConsoleHandoff(callback)
}

/** Whether [link] is the console hand-off coming back to this app's scheme. */
fun ShellServices.isConsoleHandoffReturn(link: String?): Boolean =
  com.aglyn.core.ConsoleHandoff.isReturn(link, com.aglyn.core.ConsoleHandoff.appRedirectUri(config.app))

/** Finishes a console sign-in with the return URL its page went to; a return no sign-in is waiting for is refused. */
suspend fun ShellServices.finishConsoleHandoff(callback: String) {
  val pending = authFlow.pendingHandoff
    ?: throw AuthError("That sign-in has expired or was already used. Sign in again.")
  authFlow.pendingHandoff = null
  val code = com.aglyn.core.ConsoleHandoff.code(callback, pending)
  val grant = com.aglyn.core.ConsoleHandoff.redeem(api, code, pending)
  auth.signInWithCustomToken(grant.token, grant.tenantId)
}
