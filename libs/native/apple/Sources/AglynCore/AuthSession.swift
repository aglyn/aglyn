// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import FirebaseAuth
import Foundation
import Observation
import Security

/// The signed-in person, as the app needs them.
public struct AglynUser: Equatable, Sendable {
  public let uid: String
  public let email: String?
  public let displayName: String?
  /// Whether the account's email address is confirmed. Every console route refuses an account that has not confirmed it,
  /// so the app shows the verification step first, as the console's `/verify-email` does. False when unknown.
  public let emailVerified: Bool
  /// The picture on the sign-in record (the SDK's `photoURL`, the ID token's `picture`): the fallback for the person's
  /// own photo when their profile has none (`readAccountPhoto`, AGL-4010).
  public let photoURL: String?

  public init(uid: String, email: String?, displayName: String?, emailVerified: Bool = false, photoURL: String? = nil) {
    self.uid = uid
    self.email = email
    self.displayName = displayName
    self.emailVerified = emailVerified
    self.photoURL = photoURL
  }

  /// The same person with what a fresh token says about the address and the picture.
  func fromToken(_ claims: TokenClaims) -> AglynUser {
    AglynUser(
      uid: uid, email: email, displayName: displayName, emailVerified: claims.emailVerified,
      photoURL: claims.values["picture"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? photoURL)
  }
}

extension AglynUser {
  init(sdk user: User) {
    self.init(
      uid: user.uid, email: user.email, displayName: user.displayName, emailVerified: user.isEmailVerified,
      photoURL: user.photoURL?.absoluteString)
  }
}

/// How the app signs in: the Firebase SDK, or the Identity Toolkit REST API
/// for a Mac build without a team signature (see `IdentityToolkitAuth`).
public enum AuthTransport: String, Sendable {
  case sdk
  case rest

  /// `rest` on a Mac whose code signature carries no team identifier (an
  /// ad-hoc or unsigned build), `sdk` everywhere else. A debug override
  /// (`-AglynAuthTransport rest|sdk`) wins.
  public static func resolve(override: String? = UserDefaults.standard.string(forKey: "AglynAuthTransport"))
    -> AuthTransport
  {
    if let override, let forced = AuthTransport(rawValue: override) { return forced }
    #if os(macOS)
      return CodeSignature.currentTeamIdentifier() == nil ? .rest : .sdk
    #else
      return .sdk
    #endif
  }
}

/// The Keychain service a REST session is kept under: per build, since the
/// REST path is the Mac build without a team signature, whose every rebuild
/// is a new ad-hoc signature that another build's item would prompt for.
func restAuthKeychainService(bundleID: String, buildHash: String?) -> String {
  guard let buildHash, !buildHash.isEmpty else { return "\(bundleID).rest-auth" }
  return "\(bundleID).rest-auth.\(buildHash.prefix(16))"
}

private func restBuildHash() -> String? {
  #if os(macOS)
    return CodeSignature.currentUniqueHash()
  #else
    return nil
  #endif
}

#if os(macOS)
  enum CodeSignature {
    /// The team that signed this process, or nil for an ad-hoc or unsigned build.
    static func currentTeamIdentifier() -> String? {
      var code: SecCode?
      guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
      var staticCode: SecStaticCode?
      guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
      var info: CFDictionary?
      guard
        SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
          == errSecSuccess,
        let values = info as? [String: Any]
      else { return nil }
      let team = values[kSecCodeInfoTeamIdentifier as String] as? String
      return team?.isEmpty == false ? team : nil
    }

    /// This build's code directory hash in hex, or nil when it cannot be read.
    static func currentUniqueHash() -> String? {
      var code: SecCode?
      guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
      var staticCode: SecStaticCode?
      guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
      var info: CFDictionary?
      guard
        SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
          == errSecSuccess,
        let values = info as? [String: Any], let unique = values[kSecCodeInfoUnique as String] as? Data
      else { return nil }
      return unique.map { String(format: "%02x", $0) }.joined()
    }
  }
#endif

/// The words a failed sign-in shows, by Firebase Auth error code.
public func signInErrorMessage(_ error: Error) -> String {
  let brand = AglynBrand.name
  if isAppCheckRefusal(error) { return appCheckRefusalMessage }
  if let rest = error as? IdentityToolkitError {
    switch rest.code {
    case "INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_EMAIL":
      return "That email and password do not match an \(brand) account."
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many attempts. Wait a few minutes, then try again."
    case "USER_DISABLED":
      return "This account is turned off. Contact your workspace owner."
    case nil where rest.status == 0:
      return "\(brand) could not be reached. Check the connection and try again."
    default:
      return "Sign-in did not work. Try again."
    }
  }
  let code = AuthErrorCode(rawValue: (error as NSError).code)
  switch code {
  case .invalidCredential, .wrongPassword, .userNotFound, .invalidEmail:
    return "That email and password do not match an \(brand) account."
  case .tooManyRequests:
    return "Too many attempts. Wait a few minutes, then try again."
  case .userDisabled:
    return "This account is turned off. Contact your workspace owner."
  case .networkError:
    return "\(brand) could not be reached. Check the connection and try again."
  case .secondFactorRequired:
    return
      "This account uses two-step verification. Sign in on the web console to finish setting up this device."
  default:
    return "Sign-in did not work. Try again."
  }
}

/// The words a failed password change shows.
public func passwordChangeMessage(_ error: Error) -> String {
  if let rest = error as? IdentityToolkitError, rest.code?.hasPrefix("WEAK_PASSWORD") == true {
    return "That password is too weak. Use a longer one."
  }
  if let code = AuthErrorCode(rawValue: (error as NSError).code), code == .weakPassword {
    return "That password is too weak. Use a longer one."
  }
  let message = signInErrorMessage(error)
  return message.hasPrefix("That email and password") ? "Your current password is not right." : message
}

/// The signed-in person, observed: who is signed in, and the ID token the
/// console API and the WebView session are minted from. With the SDK the
/// user is kept in the Keychain by Firebase; with REST the refresh token is
/// kept by `KeychainCredentialStore`. Either way a relaunch restores them
/// without a prompt.
///
/// More than one account can be signed in at once (Add account, Zach 2026-10-18). The app's own sign-in is the base
/// slot; each account added beside it signs in over REST with its refresh token in a Keychain slot of its own, and while
/// one of them is in use every token and every read is that account's, exactly as in a support session. Switching
/// changes `user`, which the app follows with a fresh workspace store, so nothing of one account reaches another's
/// screens; signing out ends the account in use and keeps the others.
@MainActor
@Observable
public final class AuthSession {
  public private(set) var user: AglynUser?
  /// The signed-in person's Aglyn staff standing (`staff` and `staffRole`
  /// claims), nil for everyone else. For display only; the routes decide.
  public private(set) var staff: StaffStanding?
  /// False until it is known whether someone is signed in.
  public private(set) var ready = false
  public let transport: AuthTransport

  /// The support session a staff member is in as a customer, nil for an ordinary session. While it is on, `user` is the
  /// customer and every token is theirs; the staff member's own session is set aside untouched.
  public private(set) var impersonation: Impersonation?
  /// Whether reads go over REST with this session's token rather than the SDK's own sign-in: in a support session, and
  /// while an added account is in use. Readable by readers that are not on the main actor.
  public let impersonationFlag = ImpersonationFlag()

  /// Every account signed in on this device, the app's own (base) first.
  public private(set) var accounts: [SignedInAccount] = []
  /// The slot of the account in use (`SignedInAccount.baseSlot` for the app's own sign-in).
  public private(set) var activeSlot = SignedInAccount.baseSlot
  /// While true, a sign-in adds an account beside the ones signed in (and switches to it) instead of replacing the
  /// app's own: the Add account screen sets it around the shared sign-in screens.
  public var addingAccount = false

  /// Whether more than one account can be signed in on this build.
  public var canAddAccounts: Bool { makeAccountAuth != nil }

  @ObservationIgnored private let rest: IdentityToolkitAuth?
  @ObservationIgnored private var handle: AuthStateDidChangeListenerHandle?
  @ObservationIgnored private var beforeSignOut: [@MainActor () async -> Void] = []
  /// How a support session signs in: a REST client that keeps its session in memory, never in the Keychain.
  @ObservationIgnored private let makeImpersonationAuth: (@Sendable () -> IdentityToolkitAuth)?
  @ObservationIgnored private var impersonated: IdentityToolkitAuth?
  /// The staff member's own sign-in, set aside while a support session is on.
  @ObservationIgnored private var staffAside: AglynUser?
  /// Whether someone signed in or out (or a support session began) since launch: the stored session read at launch then
  /// does not land over it.
  @ObservationIgnored private var signedInOrOutSinceLaunch = false

  /// The app's own sign-in, whichever account is in use.
  @ObservationIgnored private var baseUser: AglynUser?
  /// The added accounts' REST clients and people, by slot, once restored or signed in this launch.
  @ObservationIgnored private var addedClients: [String: IdentityToolkitAuth] = [:]
  @ObservationIgnored private var addedUsers: [String: AglynUser] = [:]
  /// A client for an added account's slot, its refresh token kept in the Keychain under that slot.
  @ObservationIgnored private let makeAccountAuth: (@Sendable (String) -> IdentityToolkitAuth)?
  @ObservationIgnored private let roster: AccountRosterStorage?
  @ObservationIgnored private var baseAnswered = false
  @ObservationIgnored private var addedRestored = false

  /// `rest` is the REST client to sign in with; nil signs in with the Firebase SDK. `accountAuth` makes the client of an
  /// added account's slot, and `roster` keeps who is signed in where; without them only one account signs in.
  public init(
    rest: IdentityToolkitAuth? = nil, impersonationAuth: (@Sendable () -> IdentityToolkitAuth)? = nil,
    accountAuth: (@Sendable (String) -> IdentityToolkitAuth)? = nil, roster: AccountRosterStorage? = nil
  ) {
    self.rest = rest
    makeImpersonationAuth = impersonationAuth
    makeAccountAuth = accountAuth
    self.roster = roster
    transport = rest == nil ? .sdk : .rest
    accounts = roster?.load() ?? []
    Task { @MainActor in await self.restoreAddedAccount() }
    if let rest {
      Task { @MainActor in
        // A sign-in that began before this task ran owns the stored session: restoring it now would refresh the fresh
        // tokens a second time, and a refused refresh would clear them.
        guard !self.signedInOrOutSinceLaunch else {
          self.baseDidAnswer()
          return
        }
        let restored = await rest.restore()
        if !self.signedInOrOutSinceLaunch { self.setBase(restored) }
        self.baseDidAnswer()
        await self.refreshStanding()
      }
      return
    }
    handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
      MainActor.assumeIsolated {
        let signedIn = user.map { AglynUser(sdk: $0) }
        // While a support session is on, the SDK's user is the staff member's, set aside.
        if self?.impersonation != nil { self?.staffAside = signedIn }
        self?.setBase(signedIn)
        self?.baseDidAnswer()
        Task { await self?.refreshStanding() }
      }
    }
  }

  /// The session for a config: REST when `transport` says so, else the SDK. Every REST call carries
  /// `appCheck`'s token (the SDK takes its own from Firebase App Check). Added accounts always sign in over REST.
  public static func make(
    _ config: AglynConfig, transport: AuthTransport = .resolve(), appCheck: AppCheckTokenProvider = NoAppCheck()
  ) -> AuthSession {
    let http = AppCheckTransport(appCheck: appCheck)
    // A support session signs in over REST in either case, and keeps nothing: the customer's session is never persisted.
    let impersonationAuth: @Sendable () -> IdentityToolkitAuth = {
      IdentityToolkitAuth(
        apiKey: config.firebase.apiKey, emulatorHost: config.authEmulatorHost, transport: http, store: MemoryCredentialStore())
    }
    let service = restAuthKeychainService(
      bundleID: Bundle.main.bundleIdentifier ?? "com.aglyn.app", buildHash: restBuildHash())
    let accountAuth: @Sendable (String) -> IdentityToolkitAuth = { slot in
      IdentityToolkitAuth(
        apiKey: config.firebase.apiKey, emulatorHost: config.authEmulatorHost, transport: http,
        store: KeychainCredentialStore(service: "\(service).accounts", account: "\(config.firebase.projectID).\(slot)"))
    }
    let roster = AccountRosterStorage(projectID: config.firebase.projectID)
    guard transport == .rest else {
      return AuthSession(impersonationAuth: impersonationAuth, accountAuth: accountAuth, roster: roster)
    }
    return AuthSession(
      rest: IdentityToolkitAuth(
        apiKey: config.firebase.apiKey,
        emulatorHost: config.authEmulatorHost,
        transport: http,
        store: KeychainCredentialStore(service: service, account: config.firebase.projectID)),
      impersonationAuth: impersonationAuth, accountAuth: accountAuth, roster: roster)
  }

  // MARK: Which account is in use

  /// The added account in use, nil while the app's own is.
  private var activeAdded: IdentityToolkitAuth? {
    activeSlot == SignedInAccount.baseSlot ? nil : addedClients[activeSlot]
  }

  /// The REST client the person in use is signed in with: an added account's, else the app's own REST session (nil on
  /// the SDK).
  private var currentRest: IdentityToolkitAuth? { activeAdded ?? rest }

  /// The app's own sign-in changed (signed in, out, refreshed).
  private func setBase(_ next: AglynUser?) {
    baseUser = next
    if let next {
      updateRoster(SignedInAccount(slot: SignedInAccount.baseSlot, uid: next.uid, email: next.email, displayName: next.displayName))
    } else {
      removeFromRoster(SignedInAccount.baseSlot)
    }
    applyActive()
  }

  /// The person in use changed: `user` follows the active slot, and reads follow its token.
  private func setCurrent(_ next: AglynUser?) {
    guard activeSlot != SignedInAccount.baseSlot else { return setBase(next) }
    guard let next else { return }
    addedUsers[activeSlot] = next
    updateRoster(SignedInAccount(slot: activeSlot, uid: next.uid, email: next.email, displayName: next.displayName))
    applyActive()
  }

  private func applyActive() {
    guard impersonation == nil else { return }
    let added = activeSlot != SignedInAccount.baseSlot
    impersonationFlag.set(added)
    user = added ? addedUsers[activeSlot] : baseUser
  }

  private func baseDidAnswer() {
    baseAnswered = true
    ready = baseAnswered && addedRestored
  }

  /// At launch: the added account that was in use, restored from its Keychain slot; one whose session the server no
  /// longer accepts is dropped and the app's own comes back.
  private func restoreAddedAccount() async {
    defer {
      addedRestored = true
      ready = baseAnswered && addedRestored
    }
    guard let roster, let makeAccountAuth else { return }
    let slot = roster.activeSlot
    guard slot != SignedInAccount.baseSlot else { return }
    guard accounts.contains(where: { $0.slot == slot }) else {
      roster.activeSlot = SignedInAccount.baseSlot
      return
    }
    let client = makeAccountAuth(slot)
    guard let restored = await client.restore() else {
      removeFromRoster(slot)
      roster.activeSlot = SignedInAccount.baseSlot
      return
    }
    addedClients[slot] = client
    addedUsers[slot] = restored
    activeSlot = slot
    applyActive()
    await refreshStanding()
  }

  private func updateRoster(_ account: SignedInAccount) {
    let next = AccountRosterRules.upsert(account, into: accounts)
    guard next != accounts else { return }
    accounts = next
    roster?.save(next)
  }

  private func removeFromRoster(_ slot: String) {
    let next = AccountRosterRules.remove(slot: slot, from: accounts)
    guard next != accounts else { return }
    accounts = next
    roster?.save(next)
  }

  /// Remembers which workspaces the account in use belongs to, so a tapped push about one finds its account.
  public func recordWorkspaces(_ orgIDs: [String]) {
    guard impersonation == nil, var account = accounts.first(where: { $0.slot == activeSlot }), account.orgIDs != orgIDs
    else { return }
    account.orgIDs = orgIDs
    let next = accounts.map { $0.slot == account.slot ? account : $0 }
    accounts = next
    roster?.save(next)
  }

  /// Remembers the picture the account in use shows (its profile's, else its sign-in record's), so the account switcher
  /// draws each account's face (AGL-4010).
  public func recordPhoto(_ photoURL: String?) {
    guard impersonation == nil, var account = accounts.first(where: { $0.slot == activeSlot }), account.photoURL != photoURL
    else { return }
    account.photoURL = photoURL
    let next = accounts.map { $0.slot == account.slot ? account : $0 }
    accounts = next
    roster?.save(next)
  }

  /// Uses another signed-in account. Its session is read back from its Keychain slot when it was not used this launch;
  /// one the server no longer accepts is dropped. A support session is ended first.
  public func switchAccount(to slot: String) async {
    guard slot != activeSlot || impersonation != nil else { return }
    await endImpersonation()
    if slot == SignedInAccount.baseSlot {
      guard baseUser != nil else { return }
    } else if addedClients[slot] == nil {
      guard let makeAccountAuth, accounts.contains(where: { $0.slot == slot }) else { return }
      let client = makeAccountAuth(slot)
      guard let restored = await client.restore() else {
        removeFromRoster(slot)
        return
      }
      addedClients[slot] = client
      addedUsers[slot] = restored
    }
    activeSlot = slot
    roster?.activeSlot = slot
    signedInOrOutSinceLaunch = true
    applyActive()
    await refreshStanding()
  }

  /// Signs in an account beside the ones signed in, in a Keychain slot of its own, and switches to it. The same person
  /// signing in again is switched to, not added twice.
  private func add(_ signIn: (IdentityToolkitAuth) async throws -> AglynUser) async throws -> AglynUser {
    guard let makeAccountAuth else { throw IdentityToolkitError(code: nil, status: 0) }
    let slot = UUID().uuidString
    let client = makeAccountAuth(slot)
    let signed = try await signIn(client)
    addingAccount = false
    if let existing = accounts.first(where: { $0.uid == signed.uid }) {
      await client.signOut()
      await switchAccount(to: existing.slot)
      return signed
    }
    addedClients[slot] = client
    addedUsers[slot] = signed
    updateRoster(SignedInAccount(slot: slot, uid: signed.uid, email: signed.email, displayName: signed.displayName))
    await switchAccount(to: slot)
    return signed
  }

  // MARK: Signing in

  /// Runs a sign-in or sign-up and, once it succeeds, logs `event` with how (AGL-4067): the method only, never who.
  private func tracked<T>(_ event: TelemetryEvent, _ method: String, _ body: () async throws -> T) async rethrows -> T {
    let value = try await body()
    Telemetry.event(event, ["method": method])
    return value
  }

  public func signIn(email: String, password: String) async throws {
    try await tracked(.signIn, "password") {
      let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
      if addingAccount {
        _ = try await add { try await $0.signIn(email: trimmed, password: password) }
        return
      }
      if let rest {
        signedInOrOutSinceLaunch = true
        setBase(try await rest.signIn(email: trimmed, password: password))
        await refreshStanding()
        return
      }
      // A self-serve account lives in the project pool; an SSO sign-in aims the SDK at a workspace's tenant, which
      // is sticky until something says otherwise (the console's `aimAuthAtPool(auth, null)`, AGL-1993).
      Auth.auth().tenantID = nil
      _ = try await Auth.auth().signIn(withEmail: trimmed, password: password)
    }
  }

  /// Signs in with a Firebase custom token: a passkey sign-in's, or the console hand-off's after single sign-on.
  /// `tenantId` is the identity pool the token was minted in (an SSO account lives in its workspace's tenant).
  public func signIn(customToken: String, tenantId: String? = nil) async throws {
    try await tracked(.signIn, "custom_token") {
      let pool = tenantId.flatMap { $0.isEmpty ? nil : $0 }
      if addingAccount {
        _ = try await add { try await $0.signIn(customToken: customToken, tenantId: pool) }
        return
      }
      if let rest {
        signedInOrOutSinceLaunch = true
        setBase(try await rest.signIn(customToken: customToken, tenantId: pool))
        await refreshStanding()
        return
      }
      Auth.auth().tenantID = pool
      _ = try await Auth.auth().signIn(withCustomToken: customToken)
    }
  }

  /// Creates an email and password account in the project pool and signs in as it, as the console's sign-up does
  /// (`createUserWithEmailAndPassword`). Throws with the Firebase code for `signUpErrorMessage`.
  public func signUp(email: String, password: String) async throws -> AglynUser {
    return try await tracked(.signUp, "password") {
      let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
      if addingAccount { return try await add { try await $0.signUp(email: trimmed, password: password) } }
      if let rest {
        signedInOrOutSinceLaunch = true
        let created = try await rest.signUp(email: trimmed, password: password)
        setBase(created)
        await refreshStanding()
        return created
      }
      Auth.auth().tenantID = nil
      let result = try await Auth.auth().createUser(withEmail: trimmed, password: password)
      let created = AglynUser(sdk: result.user)
      setBase(created)
      return created
    }
  }

  /// Signs in with a Google ID token (the platform sheet's), which signs up a person Firebase has not seen.
  /// Returns whether it did, the console's `isNewAccount(credential)`.
  public func signIn(googleIDToken: String, accessToken: String? = nil) async throws -> Bool {
    return try await tracked(.signIn, "google") {
      let body = "id_token=\(ConsoleAPIClient.encodeComponent(googleIDToken))&providerId=google.com"
      if addingAccount {
        var isNew = false
        _ = try await add { client in
          let (signedIn, created) = try await client.signIn(idpPostBody: body)
          isNew = created
          return signedIn
        }
        return isNew
      }
      if let rest {
        signedInOrOutSinceLaunch = true
        let (signedIn, isNew) = try await rest.signIn(idpPostBody: body)
        setBase(signedIn)
        await refreshStanding()
        return isNew
      }
      Auth.auth().tenantID = nil
      let credential = GoogleAuthProvider.credential(withIDToken: googleIDToken, accessToken: accessToken ?? "")
      let result = try await Auth.auth().signIn(with: credential)
      setBase(AglynUser(sdk: result.user))
      return result.additionalUserInfo?.isNewUser == true
    }
  }

  /// Signs in with Sign in with Apple's identity token and the raw nonce its request was hashed from (provider
  /// `apple.com`). Apple hands the name over on the first authorization only, so a new account keeps it then.
  public func signIn(appleIDToken: String, rawNonce: String, fullName: PersonNameComponents?) async throws -> Bool {
    return try await tracked(.signIn, "apple") {
      let name = fullName.map { PersonNameComponentsFormatter().string(from: $0) }?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let body =
        "id_token=\(ConsoleAPIClient.encodeComponent(appleIDToken))&providerId=apple.com"
        + "&nonce=\(ConsoleAPIClient.encodeComponent(rawNonce))"
      let isNew: Bool
      if addingAccount {
        var created = false
        _ = try await add { client in
          let (signedIn, isNew) = try await client.signIn(idpPostBody: body)
          created = isNew
          return signedIn
        }
        isNew = created
      } else if let rest {
        signedInOrOutSinceLaunch = true
        let (signedIn, created) = try await rest.signIn(idpPostBody: body)
        setBase(signedIn)
        isNew = created
      } else {
        Auth.auth().tenantID = nil
        let credential = OAuthProvider.appleCredential(withIDToken: appleIDToken, rawNonce: rawNonce, fullName: fullName)
        let result = try await Auth.auth().signIn(with: credential)
        setBase(AglynUser(sdk: result.user))
        isNew = result.additionalUserInfo?.isNewUser == true
      }
      if isNew, !name.isEmpty, (user?.displayName ?? "").isEmpty { try? await updateDisplayName(name) }
      await refreshStanding()
      return isNew
    }
  }

  // MARK: The account in use

  /// Re-reads the account (the console's `user.reload()`), so a confirmed address shows as confirmed; the fresh
  /// token then carries `email_verified`, which the routes read.
  public func reload() async {
    if let rest = currentRest {
      if let fresh = try? await rest.reload() { setCurrent(fresh) }
      return
    }
    guard let signedIn = Auth.auth().currentUser else { return }
    try? await signedIn.reload()
    guard let current = Auth.auth().currentUser else { return }
    if current.isEmailVerified { _ = try? await current.getIDTokenResult(forcingRefresh: true) }
    if impersonation == nil { setBase(AglynUser(sdk: current)) }
  }

  /// The sign-in providers the account holds (`password`, `google.com`, …), as the console reads `user.providerData`.
  public func providerIDs() async -> [String] {
    if let rest = currentRest { return (try? await rest.providerIDs()) ?? [] }
    return Auth.auth().currentUser?.providerData.map(\.providerID) ?? []
  }

  /// Confirms an address with an emailed verification link's code; no one need be signed in.
  public func applyEmailVerification(code: String) async throws {
    if let rest = currentRest {
      try await rest.applyActionCode(code)
    } else {
      try await Auth.auth().applyActionCode(code)
    }
    await reload()
  }

  /// The address an emailed reset link's code is for; throws when the code is spent or has expired.
  public func verifyPasswordResetCode(_ code: String) async throws -> String {
    if let rest { return try await rest.verifyPasswordResetCode(code) }
    return try await Auth.auth().verifyPasswordResetCode(code)
  }

  /// Sets a new password with an emailed reset link's code.
  public func confirmPasswordReset(code: String, newPassword: String) async throws {
    if let rest { return try await rest.confirmPasswordReset(code: code, newPassword: newPassword) }
    try await Auth.auth().confirmPasswordReset(withCode: code, newPassword: newPassword)
  }

  /// Changes the password, after proving the current one.
  public func changePassword(current: String, new: String) async throws {
    guard let email = user?.email else { throw IdentityToolkitError(code: "INVALID_LOGIN_CREDENTIALS", status: 401) }
    if let rest = currentRest {
      setCurrent(try await rest.changePassword(email: email, current: current, new: new))
      return
    }
    guard let signedIn = Auth.auth().currentUser else { throw IdentityToolkitError(code: nil, status: 401) }
    try await signedIn.reauthenticate(with: EmailAuthProvider.credential(withEmail: email, password: current))
    try await signedIn.updatePassword(to: new)
  }

  /// Keeps the account's display name in step with the profile (rosters and comments read it).
  public func updateDisplayName(_ name: String) async throws {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if let rest = currentRest {
      setCurrent(try await rest.updateDisplayName(trimmed))
      return
    }
    guard let signedIn = Auth.auth().currentUser else { return }
    let change = signedIn.createProfileChangeRequest()
    change.displayName = trimmed
    try await change.commitChanges()
    setBase(
      AglynUser(
        uid: signedIn.uid, email: signedIn.email, displayName: trimmed.isEmpty ? nil : trimmed,
        emailVerified: signedIn.isEmailVerified, photoURL: signedIn.photoURL?.absoluteString))
  }

  /// Disconnects a sign-in provider (`google.com`), as the console's Account section does with `unlink`.
  public func unlinkProvider(_ providerID: String) async throws {
    if let rest = currentRest {
      try await rest.deleteProvider(providerID)
      await refreshStanding()
      return
    }
    guard let signedIn = Auth.auth().currentUser else { throw IdentityToolkitError(code: nil, status: 401) }
    _ = try await signedIn.unlink(fromProvider: providerID)
    // The token's identities are read for the provider list, so ask for a fresh one.
    _ = try await signedIn.getIDToken(forcingRefresh: true)
    await refreshStanding()
  }

  /// Work that must finish while the person is still signed in (dropping the
  /// device's push row, ending the WebView's console session).
  public func onBeforeSignOut(_ task: @escaping @MainActor () async -> Void) {
    beforeSignOut.append(task)
  }

  // MARK: Support sessions

  /// Signs in as a customer with the custom token `/api/admin/impersonate` minted, in the pool it was minted in. The staff
  /// member's own session is set aside untouched; the customer's lives in memory only. Throws when the token is refused.
  public func beginImpersonation(token: String, tenantId: String?) async throws {
    guard let makeImpersonationAuth else { throw IdentityToolkitError(code: nil, status: 0) }
    if impersonation != nil { await endImpersonation() }
    let aside = user
    let session = makeImpersonationAuth()
    let customer = try await session.signIn(customToken: token, tenantId: tenantId)
    staffAside = aside
    impersonated = session
    impersonationFlag.set(true)
    impersonation = Impersonation(customer: customer, staffEmail: aside?.email)
    staff = nil
    user = customer
    await refreshStanding()
  }

  /// Ends the support session and returns to the staff member's own, which was never signed out.
  public func endImpersonation() async {
    guard let session = impersonated else { return }
    await session.signOut()
    impersonated = nil
    impersonation = nil
    staffAside = nil
    applyActive()
    await refreshStanding()
  }

  // MARK: Signing out

  /// Signs the account in use out, and keeps every other one signed in: the next one (the app's own first) takes over,
  /// and with none left the sign-in shows.
  public func signOut() async {
    // Leaving the app from a support session ends it, and then signs the staff member out as well.
    await endImpersonation()
    for task in beforeSignOut { await task() }
    staff = nil
    signedInOrOutSinceLaunch = true
    if activeSlot != SignedInAccount.baseSlot {
      let slot = activeSlot
      await addedClients[slot]?.signOut()
      addedClients[slot] = nil
      addedUsers[slot] = nil
      removeFromRoster(slot)
      let next = baseUser != nil ? SignedInAccount.baseSlot : accounts.first(where: { !$0.isBase })?.slot
      activeSlot = SignedInAccount.baseSlot
      roster?.activeSlot = SignedInAccount.baseSlot
      if let next, next != SignedInAccount.baseSlot {
        await switchAccount(to: next)
      } else {
        applyActive()
        await refreshStanding()
      }
      return
    }
    // The next account takes over before the app's own signs out, so the shell never passes through signed out.
    if let next = accounts.first(where: { !$0.isBase }) { await switchAccount(to: next.slot) }
    if let rest {
      await rest.signOut()
      setBase(nil)
      return
    }
    try? Auth.auth().signOut()
    setBase(nil)
    // An SSO account's pool outlives `signOut`. Every sign-in door sets its own, but the emailed-code steps (verify an address,
    // reset a password) use whatever is left, so signed out means the project pool (AGL-3844).
    Auth.auth().tenantID = nil
  }

  /// Drops the added account in use whose session the server refused, and returns to the next account.
  private func dropActiveAddedAccount() async {
    guard activeSlot != SignedInAccount.baseSlot else { return }
    let slot = activeSlot
    await addedClients[slot]?.signOut()
    addedClients[slot] = nil
    addedUsers[slot] = nil
    removeFromRoster(slot)
    activeSlot = SignedInAccount.baseSlot
    roster?.activeSlot = SignedInAccount.baseSlot
    if baseUser == nil, let next = accounts.first(where: { !$0.isBase }) {
      await switchAccount(to: next.slot)
    } else {
      applyActive()
    }
  }

  /// Reads the staff standing from the current ID token's claims.
  public func refreshStanding() async {
    guard user != nil, let token = try? await idToken(forceRefresh: false) else {
      staff = nil
      return
    }
    staff = idTokenClaims(token).flatMap(StaffStanding.from(claims:))
  }

  /// The current ID token; nil when signed out.
  public nonisolated func idToken(forceRefresh: Bool) async throws -> String? {
    if let session = await MainActor.run(body: { self.impersonated }) {
      let token = try await session.idToken(forceRefresh: forceRefresh)
      // A refresh the server refuses (the support session was revoked) ends it, and the staff session returns.
      if token == nil { await endImpersonation() }
      return token
    }
    if let added = await MainActor.run(body: { self.activeAdded }) {
      let token = try await added.idToken(forceRefresh: forceRefresh)
      // A refresh the server refuses (the account was signed out elsewhere) drops that account here, without the
      // sign-out work that would need its token.
      if token == nil { await dropActiveAddedAccount() }
      return token
    }
    if let rest {
      let token = try await rest.idToken(forceRefresh: forceRefresh)
      if token == nil { await MainActor.run { self.setBase(nil) } }
      return token
    }
    guard let current = Auth.auth().currentUser else { return nil }
    return try await current.getIDTokenResult(forcingRefresh: forceRefresh).token
  }
}
