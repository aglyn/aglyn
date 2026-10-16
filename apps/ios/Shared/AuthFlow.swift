// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/// Where the signed-out app is, and what a sign-up carries across its steps: the console's `(auth)` pages
/// (`/signin`, `/signup`, `/account-recovery`, `/reset-password`, `/verify-email`, `/sso`) as one state.
@MainActor
@Observable
final class AuthFlow {
  enum Screen: Equatable {
    case signIn
    case signUp
    case accountRecovery
    /// An emailed reset link's code (`/reset-password?oobCode=…&mode=resetPassword`).
    case resetPassword(code: String)
    /// An emailed verification link's code (`/verify-email?oobCode=…`), opened by someone who may not be signed in.
    case confirmEmail(code: String)
  }

  var screen: Screen = .signIn
  /// The address typed on one screen, carried to the next (sign in → account recovery).
  var email = ""
  /// The plan the sign-up link carried (`?plan=pro&interval=year`).
  var plan: OnboardingPlanIntent?
  /// The campaign the sign-up link carried (`utm_source`, `utm_medium`, `utm_campaign`).
  var campaign: UtmAttribution?
  /// A Google sign-in that created an account was stood down for want of consent (AGL-1497): the sign-up page says so,
  /// and the next Google sign-up for this account counts as its sign-up although Firebase no longer calls it new.
  var consentBounceUID: String?
  /// True while a sign-up is landing: the account exists, so the app is signed in, but its records and workspace are
  /// still being written. The sign-up screen stays up until they settle (the console's sign-up landing hold, AGL-3578).
  var landing = false
  /// A verification code opened while signed in and not yet confirmed, for the verification screen to apply.
  var pendingVerificationCode: String?

  /// Opens a console auth link (a universal link to the console, or `aglyn://`): true when it was one. Signed in, a
  /// verification link is applied by the verification step (or has nothing left to do), and the rest have nothing to
  /// show; a sign-up link's plan is handed to `onPlan`, as the console's home page lands a signed-in visitor on billing.
  func open(_ link: String, signedIn: Bool = false, onPlan: (OnboardingPlanIntent) -> Void = { _ in }) -> Bool {
    guard let full = DeepLinks.consolePath(of: link) else { return false }
    let parts = full.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    let path = String(parts.first ?? "").lowercased()
    let query = parts.count > 1 ? Self.params(String(parts[1])) : [:]
    if signedIn {
      switch path {
      case "/verify-email", "/verify-email/":
        if let code = query["oobCode"], !code.isEmpty { pendingVerificationCode = code }
      case "/signup", "/signup/":
        if let plan = OnboardingPlanIntent.parse(query) { onPlan(plan) }
      case "/signin", "/signin/", "/account-recovery", "/account-recovery/", "/sso", "/sso/", "/reset-password",
        "/reset-password/":
        break
      default:
        return false
      }
      return true
    }
    switch path {
    case "/signup", "/signup/":
      plan = OnboardingPlanIntent.parse(query) ?? plan
      campaign = UtmAttribution.parse(query) ?? campaign
      screen = .signUp
    case "/signin", "/signin/":
      screen = .signIn
    case "/account-recovery", "/account-recovery/":
      screen = .accountRecovery
    case "/sso", "/sso/":
      // Single sign-on runs on the console, from the sign-in screen's button.
      screen = .signIn
    case "/reset-password", "/reset-password/":
      guard let code = query["oobCode"], !code.isEmpty, (query["mode"] ?? "resetPassword") == "resetPassword" else {
        screen = .resetPassword(code: "")
        return true
      }
      screen = .resetPassword(code: code)
    case "/verify-email", "/verify-email/":
      guard let code = query["oobCode"], !code.isEmpty else { return true }
      pendingVerificationCode = code
      screen = .confirmEmail(code: code)
    default:
      return false
    }
    return true
  }

  /// Back to sign-in, keeping nothing a later sign-up could pick up.
  func reset() {
    screen = .signIn
    consentBounceUID = nil
  }

  static func params(_ query: String) -> [String: String] {
    var params: [String: String] = [:]
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
      let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      let decode = { (raw: Substring) -> String in
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
      }
      params[decode(kv[0])] = kv.count > 1 ? decode(kv[1]) : ""
    }
    return params
  }
}

/// What the first verified session found when the account has no workspace yet (the console's workspace chooser).
enum FirstRunState: Equatable {
  /// Nothing to settle, or it has settled.
  case idle
  /// The held sign-up name is being claimed and its workspace created.
  case provisioning
  /// The workspace the sign-up form named could not be created (AGL-1523): said, and offered back.
  case failed(name: String, error: String?)
}

extension AppModel {
  /// The console routes and account writes every sign-up door makes.
  var signUpService: SignUpService? {
    guard let api, let reader else { return nil }
    return SignUpService(api: api, writer: ReaderMergeWriter(reader))
  }

  /// The email and password door (`/signup`'s form): the account, then the acceptance, attribution, plan, campaign,
  /// name and opt-in, in the console's order; then the workspace name is held until the address is confirmed.
  /// Throws only when the account could not be created, with words for the form.
  func signUpWithPassword(
    firstName: String, lastName: String, organization: String, email: String, password: String, marketing: Bool
  ) async throws {
    guard let auth, let service = signUpService else { throw ConsoleAPIError(status: 0, message: "This build is not configured.") }
    authFlow.landing = true
    defer { authFlow.landing = false }
    let user: AglynUser
    do {
      user = try await auth.signUp(email: email, password: password)
    } catch {
      throw ConsoleAPIError(status: 0, message: signUpErrorMessage(error))
    }
    await service.recordAcceptance(.password)
    await service.recordAcquisition(door: nil)
    let display = [firstName, lastName].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
      .joined(separator: " ")
    if !display.isEmpty { try? await auth.updateDisplayName(display) }
    await service.remember(
      uid: user.uid, plan: authFlow.plan, campaign: authFlow.campaign, firstName: firstName, lastName: lastName)
    if marketing { await service.recordMarketingOptIn() }
    await provisionAndLand(user, name: organization, nameWasTyped: true)
  }

  /// A provider sign-up (Google, Apple) after its credential signed in: recorded and provisioned only when it created
  /// the account, or when sign-in stood this account down for consent (`isNewAccount`, `consumeConsentBounce`).
  func finishProviderSignUp(door: SignUpDoor, isNew: Bool, marketing: Bool) async {
    guard let auth, let user = auth.user, let service = signUpService else { return }
    authFlow.landing = true
    defer { authFlow.landing = false }
    await service.recordAcceptance(door)
    await service.recordAcquisition(door: door.acquisitionDoor)
    await service.remember(uid: user.uid, plan: authFlow.plan, campaign: authFlow.campaign)
    if marketing { await service.recordMarketingOptIn() }
    let bounced = authFlow.consentBounceUID == user.uid
    authFlow.consentBounceUID = nil
    guard bounced || isNew else { return }
    await provisionAndLand(
      auth.user ?? user, name: derivedWorkspaceName(displayName: user.displayName, email: user.email), nameWasTyped: false)
  }

  /// Continue with Google from the sign-in or sign-up screen: Google's sheet (its account chooser always shown,
  /// AGL-1415), then the credential signs in. On sign-up the account is recorded and provisioned as the console's
  /// Google door does; on sign-in a credential that created an account is stood down for the agreement (AGL-1497).
  func continueWithGoogle(
    signingUp: Bool, marketing: Bool,
    authenticate: @escaping @Sendable (_ url: URL, _ callbackScheme: String) async throws -> URL
  ) async throws {
    guard let auth, let config, let client = config.google else {
      throw ConsoleAPIError(status: 0, message: "Google sign-in is not set up in this build.")
    }
    let googleIDToken = try await GoogleLink.idToken(
      iosClientID: client.iosClientID, loginHint: nil, transport: firebaseHTTP, authenticate: authenticate)
    if signingUp { authFlow.landing = true }
    defer { if signingUp { authFlow.landing = false } }
    let isNew = try await auth.signIn(googleIDToken: googleIDToken)
    await afterProviderSignIn(door: .google, isNew: isNew, signingUp: signingUp, marketing: marketing)
  }

  /// Signing in through the console (AGL-3816): single sign-on, which runs the workspace's own identity provider on the
  /// console's `/sso` page. The console page opens in the platform's auth session, and its one-time code comes back to
  /// this app's URL scheme and is traded, with this sign-in's verifier, for a custom token in the account's own pool.
  func signInThroughConsole(
    start: ConsoleHandoff.Start, loginHint: String? = nil,
    authenticate: @escaping @Sendable (_ url: URL, _ callbackScheme: String) async throws -> URL
  ) async throws {
    guard let auth, let api, let config else { throw ConsoleAPIError(status: 0, message: "This build is not configured.") }
    let pending = ConsoleHandoff.begin(origin: config.consoleOrigin, app: config.app, start: start, loginHint: loginHint)
    let callback = try await authenticate(pending.url, pending.callbackScheme)
    let code = try ConsoleHandoff.code(from: callback, pending: pending)
    let grant = try await ConsoleHandoff.redeem(api: api, code: code, pending: pending)
    try await auth.signIn(customToken: grant.token, tenantId: grant.tenantID)
  }

  /// Sign in with Apple's credential, from the sign-in or sign-up screen, with the same outcome rules as Google.
  func continueWithApple(
    identityToken: String, rawNonce: String, fullName: PersonNameComponents?, signingUp: Bool, marketing: Bool
  ) async throws {
    guard let auth else { throw ConsoleAPIError(status: 0, message: "This build is not configured.") }
    if signingUp { authFlow.landing = true }
    defer { if signingUp { authFlow.landing = false } }
    let isNew = try await auth.signIn(appleIDToken: identityToken, rawNonce: rawNonce, fullName: fullName)
    await afterProviderSignIn(door: .apple, isNew: isNew, signingUp: signingUp, marketing: marketing)
  }

  private func afterProviderSignIn(door: SignUpDoor, isNew: Bool, signingUp: Bool, marketing: Bool) async {
    if signingUp {
      await finishProviderSignUp(door: door, isNew: isNew, marketing: marketing)
    } else if isNew {
      await standDownUnconsentedAccount()
    }
  }

  /// A provider sign-in from the sign-in screen that created an account: the person never saw the terms, so the account
  /// is stood back down and they are sent to sign up, where the consent is (`rejectUnconsentedNewAccount`).
  func standDownUnconsentedAccount() async {
    guard let auth, let user = auth.user else { return }
    await signUpService?.recordAcquisition(door: nil)
    authFlow.consentBounceUID = user.uid
    await auth.signOut()
    authFlow.screen = .signUp
  }

  /// The one landing routine (`provisionAndLandSignUp`): a verified account's workspace is created now and the app lands
  /// in it; an unverified one's name is held until the address is confirmed.
  private func provisionAndLand(_ user: AglynUser, name: String, nameWasTyped: Bool) async {
    guard let service = signUpService else { return }
    if !user.emailVerified {
      await service.holdWorkspace(uid: user.uid, PendingSignUpWorkspace(name: name, nameWasTyped: nameWasTyped))
      return
    }
    let outcome = await service.createWorkspace(name: name)
    if let slug = outcome.slug, let plan = authFlow.plan {
      push.pendingLink = plan.destination(orgSlug: slug)
    }
  }

  /// The first verified session of an account with no workspace (the console's chooser, AGL-2590): the name the sign-up
  /// held is claimed once and its workspace created; the plan it remembered then decides where the app lands.
  func settleFirstRun() async {
    guard let auth, let user = auth.user, user.emailVerified, auth.impersonation == nil,
      let workspace, workspace.ready, workspace.orgs.isEmpty, firstRunSettledFor != user.uid,
      let service = signUpService, let reader
    else { return }
    firstRunSettledFor = user.uid
    firstRun = .provisioning
    let providers = await auth.providerIDs()
    guard let pending = await service.claimHeldWorkspace(uid: user.uid, providers: providers, reader: reader) else {
      firstRun = .idle
      return
    }
    let outcome = await service.createWorkspace(name: pending.name)
    if let slug = outcome.slug {
      if let plan = await service.consumePlanIntent(uid: user.uid, reader: reader) {
        push.pendingLink = plan.destination(orgSlug: slug)
      }
      firstRun = .idle
      return
    }
    firstRun = pending.nameWasTyped ? .failed(name: pending.name, error: outcome.error) : .idle
  }

  /// "Create an organization" from the empty workspace list, or "Create it now" for the name sign-up could not use.
  func createWorkspace(named name: String) async -> String? {
    guard let service = signUpService else { return "This build is not configured." }
    let outcome = await service.createWorkspace(name: name)
    if outcome.slug != nil {
      firstRun = .idle
      return nil
    }
    return outcome.error ?? "Organization creation failed"
  }
}
