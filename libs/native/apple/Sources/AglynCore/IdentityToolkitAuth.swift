// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Security

/// A refusal from the Identity Toolkit or Secure Token API: its error code
/// (`INVALID_LOGIN_CREDENTIALS`, `TOO_MANY_ATTEMPTS_TRY_LATER`, …), or nil
/// when nothing answered.
public struct IdentityToolkitError: Error, Equatable, Sendable {
  /// The code a refusal for the App Check token gets (the server says "Firebase App Check token is invalid.").
  public static let appCheckRefused = "APP_CHECK_TOKEN_INVALID"

  public let code: String?
  public let status: Int

  public init(code: String?, status: Int) {
    self.code = code
    self.status = status
  }
}

/// What a REST session keeps between launches: the refresh token and who it belongs to.
public struct StoredAuthSession: Codable, Equatable, Sendable {
  public var uid: String
  public var email: String?
  public var displayName: String?
  public var refreshToken: String

  public init(uid: String, email: String?, displayName: String?, refreshToken: String) {
    self.uid = uid
    self.email = email
    self.displayName = displayName
    self.refreshToken = refreshToken
  }
}

/// Where a REST session's refresh token is kept.
public protocol AuthCredentialStore: Sendable {
  func load() -> StoredAuthSession?
  func save(_ session: StoredAuthSession?)
}

/// A store that forgets on quit (tests, and the fallback when the Keychain refuses).
public final class MemoryCredentialStore: AuthCredentialStore, @unchecked Sendable {
  private let lock = NSLock()
  private var session: StoredAuthSession?

  public init(_ session: StoredAuthSession? = nil) { self.session = session }

  public func load() -> StoredAuthSession? { lock.withLock { session } }
  public func save(_ session: StoredAuthSession?) { lock.withLock { self.session = session } }
}

/// The refresh token in the login Keychain, as a generic password.
///
/// It uses the file-based Keychain on purpose: the data-protection Keychain
/// needs a team-signed `keychain-access-groups` entitlement, which is the
/// very thing an unsigned build lacks (`errSecMissingEntitlement`, -34018).
/// A read never shows a prompt: when the Keychain asks (an ad-hoc rebuild
/// changes the app's signature), the session is treated as absent and the
/// person signs in again. `kSecUseAuthenticationUISkip` alone does not do
/// that in the file-based Keychain: the read blocked on an access prompt and
/// held the launch screen up indefinitely, so every call here runs with
/// Keychain user interaction off (`errSecInteractionNotAllowed` instead of a
/// prompt). `AuthSession.make` also names the item per build, so a rebuild
/// starts from no item rather than another build's.
public struct KeychainCredentialStore: AuthCredentialStore {
  public let service: String
  public let account: String

  public init(service: String, account: String) {
    self.service = service
    self.account = account
  }

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  public func load() -> StoredAuthSession? {
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    // `kSecUseAuthenticationUISkip` keeps the read from showing UI; the
    // LAContext replacement applies to access-controlled items only.
    lookup[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip
    var result: CFTypeRef?
    let status = withoutKeychainPrompts { SecItemCopyMatching(lookup as CFDictionary, &result) }
    guard status == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(StoredAuthSession.self, from: data)
  }

  public func save(_ session: StoredAuthSession?) {
    withoutKeychainPrompts {
      SecItemDelete(query as CFDictionary)
      guard let session, let data = try? JSONEncoder().encode(session) else { return }
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrLabel as String] = "\(AglynBrand.name) sign-in"
      SecItemAdd(item as CFDictionary, nil)
    }
  }

}

/// Runs a Keychain call that fails rather than prompts. Keychain user
/// interaction is a process-wide switch on macOS, so it is restored after.
private let keychainPromptLock = NSLock()

func withoutKeychainPrompts<T>(_ body: () -> T) -> T {
  #if os(macOS)
    keychainPromptLock.lock()
    defer { keychainPromptLock.unlock() }
    var allowed: DarwinBoolean = true
    SecKeychainGetUserInteractionAllowed(&allowed)
    SecKeychainSetUserInteractionAllowed(false)
    defer { SecKeychainSetUserInteractionAllowed(allowed.boolValue) }
  #endif
  return body()
}

/// Firebase Auth over its REST APIs: `accounts:signInWithPassword`, `accounts:signUp`,
/// `accounts:signInWithIdp`, the action-code calls and the Secure Token refresh, against the Auth
/// emulator when one is set.
///
/// The Mac app uses it when it is not team-signed: the Firebase SDK keeps its
/// user in the data-protection Keychain, which an ad-hoc signature cannot
/// write to (`-34018`), so the SDK cannot sign anyone in. The tokens are the
/// same Firebase ID tokens, so the console API, the console session and the
/// security rules treat the app exactly as they treat the SDK's.
public actor IdentityToolkitAuth {
  public struct Session: Equatable, Sendable {
    public let user: AglynUser
    let idToken: String
    let refreshToken: String
    let expiresAt: Date
  }

  private let apiKey: String
  private let identityBase: String
  private let tokenBase: String
  private let transport: HTTPTransport
  private let store: AuthCredentialStore
  private let now: @Sendable () -> Date
  private var session: Session?

  public init(
    apiKey: String,
    emulatorHost: String?,
    transport: HTTPTransport = URLSession.shared,
    store: AuthCredentialStore,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.apiKey = apiKey
    identityBase = emulatorHost.map { "http://\($0)/identitytoolkit.googleapis.com" }
      ?? "https://identitytoolkit.googleapis.com"
    tokenBase = emulatorHost.map { "http://\($0)/securetoken.googleapis.com" }
      ?? "https://securetoken.googleapis.com"
    self.transport = transport
    self.store = store
    self.now = now
  }

  public var user: AglynUser? { session?.user }

  /// Restores the kept session by refreshing its token; nil when there is
  /// none or the server no longer accepts it.
  public func restore() async -> AglynUser? {
    guard let stored = store.load() else { return nil }
    let user = AglynUser(uid: stored.uid, email: stored.email, displayName: stored.displayName)
    do {
      try await refresh(user: user, refreshToken: stored.refreshToken)
      return session?.user
    } catch let error as IdentityToolkitError where (400..<500).contains(error.status) {
      store.save(nil)
      return nil
    } catch {
      // Offline: keep the stored session and sign in from it next time.
      return nil
    }
  }

  @discardableResult
  public func signIn(email: String, password: String) async throws -> AglynUser {
    let body = try await post(
      "\(identityBase)/v1/accounts:signInWithPassword?key=\(apiKey)",
      json: [
        "email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)),
        "password": .string(password),
        "returnSecureToken": .bool(true),
      ])
    guard case .string(let uid)? = body["localId"], case .string(let idToken)? = body["idToken"],
      case .string(let refreshToken)? = body["refreshToken"]
    else { throw IdentityToolkitError(code: nil, status: 200) }
    let user = AglynUser(uid: uid, email: body["email"]?.stringValue, displayName: body["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 })
    return accept(user: user, idToken: idToken, refreshToken: refreshToken, expiresIn: body["expiresIn"])
  }

  /// Signs in with a Firebase custom token: one the server mints for a passkey that signed its challenge, or one a support
  /// session's `/api/admin/impersonate` minted for a customer. `tenantId` is the identity pool the token was minted in (an SSO
  /// account lives in its workspace's tenant), because a custom token exchanged in another pool is a cross-pool exchange. The
  /// person is read off the ID token the exchange answers with.
  @discardableResult
  public func signIn(customToken: String, tenantId: String? = nil) async throws -> AglynUser {
    var json: [String: JSONValue] = ["token": .string(customToken), "returnSecureToken": .bool(true)]
    if let tenantId, !tenantId.isEmpty { json["tenantId"] = .string(tenantId) }
    let body = try await post("\(identityBase)/v1/accounts:signInWithCustomToken?key=\(apiKey)", json: json)
    guard case .string(let idToken)? = body["idToken"], case .string(let refreshToken)? = body["refreshToken"] else {
      throw IdentityToolkitError(code: nil, status: 200)
    }
    let claims = TokenClaims(idToken: idToken).values
    guard let uid = claims["user_id"]?.stringValue ?? claims["sub"]?.stringValue else { throw IdentityToolkitError(code: nil, status: 200) }
    let user = AglynUser(uid: uid, email: claims["email"]?.stringValue, displayName: claims["name"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 })
    return accept(user: user, idToken: idToken, refreshToken: refreshToken, expiresIn: body["expiresIn"])
  }

  /// Creates an email and password account (`accounts:signUp`) and signs in as it, as the console's
  /// `createUserWithEmailAndPassword` does. The project pool's `beforeUserCreated` blocking function and the
  /// abuse checks run on it exactly as they run on the console's.
  @discardableResult
  public func signUp(email: String, password: String) async throws -> AglynUser {
    let body = try await post(
      "\(identityBase)/v1/accounts:signUp?key=\(apiKey)",
      json: [
        "email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)),
        "password": .string(password),
        "returnSecureToken": .bool(true),
      ])
    guard case .string(let uid)? = body["localId"], case .string(let idToken)? = body["idToken"],
      case .string(let refreshToken)? = body["refreshToken"]
    else { throw IdentityToolkitError(code: nil, status: 200) }
    let user = AglynUser(uid: uid, email: body["email"]?.stringValue, displayName: nil)
    return accept(user: user, idToken: idToken, refreshToken: refreshToken, expiresIn: body["expiresIn"])
  }

  /// Signs in with an identity provider's credential (`accounts:signInWithIdp`): Google's ID token or Apple's, as
  /// `postBody` names it. It signs up a person the project has not seen, so the answer says whether it did.
  public func signIn(idpPostBody: String) async throws -> (user: AglynUser, isNewUser: Bool) {
    let body = try await post(
      "\(identityBase)/v1/accounts:signInWithIdp?key=\(apiKey)",
      json: [
        "postBody": .string(idpPostBody), "requestUri": .string("http://localhost"),
        "returnSecureToken": .bool(true), "returnIdpCredential": .bool(true),
      ])
    guard case .string(let uid)? = body["localId"], case .string(let idToken)? = body["idToken"],
      case .string(let refreshToken)? = body["refreshToken"]
    else {
      // `needConfirmation` answers a credential whose address another sign-in method already holds.
      throw IdentityToolkitError(code: body["needConfirmation"] == .bool(true) ? "NEED_CONFIRMATION" : nil, status: 200)
    }
    let name = body["displayName"]?.stringValue ?? body["fullName"]?.stringValue
    let user = AglynUser(uid: uid, email: body["email"]?.stringValue, displayName: name.flatMap { $0.isEmpty ? nil : $0 })
    let accepted = accept(user: user, idToken: idToken, refreshToken: refreshToken, expiresIn: body["expiresIn"])
    return (accepted, body["isNewUser"] == .bool(true))
  }

  /// Re-reads the account with a fresh token, as the console's `user.reload()` does when it asks whether the address
  /// has been confirmed since.
  public func reload() async throws -> AglynUser? {
    guard let current = session else { return nil }
    try await refresh(user: current.user, refreshToken: current.refreshToken)
    return session?.user
  }

  /// The sign-in providers the account holds (`accounts:lookup`'s `providerUserInfo`), as the SDK's `providerData`.
  public func providerIDs() async throws -> [String] {
    guard let current = session else { return [] }
    let body = try await post("\(identityBase)/v1/accounts:lookup?key=\(apiKey)", json: ["idToken": .string(current.idToken)])
    guard case .array(let users)? = body["users"], case .object(let account)? = users.first,
      case .array(let providers)? = account["providerUserInfo"]
    else { return [] }
    return providers.compactMap { $0["providerId"]?.stringValue }
  }

  /// Confirms an address with the one-time code an emailed verification link carries (`applyActionCode`).
  public func applyActionCode(_ code: String) async throws {
    _ = try await post("\(identityBase)/v1/accounts:update?key=\(apiKey)", json: ["oobCode": .string(code)])
  }

  /// The address a password reset code is for (`verifyPasswordResetCode`); throws when the code is spent or expired.
  public func verifyPasswordResetCode(_ code: String) async throws -> String {
    let body = try await post("\(identityBase)/v1/accounts:resetPassword?key=\(apiKey)", json: ["oobCode": .string(code)])
    return body["email"]?.stringValue ?? ""
  }

  /// Sets a new password with a reset code (`confirmPasswordReset`).
  public func confirmPasswordReset(code: String, newPassword: String) async throws {
    _ = try await post(
      "\(identityBase)/v1/accounts:resetPassword?key=\(apiKey)",
      json: ["oobCode": .string(code), "newPassword": .string(newPassword)])
  }

  /// Changes the password: signing in with the current one proves it and
  /// gives the fresh token the change needs, and the answer's new tokens
  /// replace the old, which a password change revokes.
  @discardableResult
  public func changePassword(email: String, current: String, new: String) async throws -> AglynUser {
    let user = try await signIn(email: email, password: current)
    guard let token = session?.idToken else { throw IdentityToolkitError(code: nil, status: 401) }
    let body = try await post(
      "\(identityBase)/v1/accounts:update?key=\(apiKey)",
      json: ["idToken": .string(token), "password": .string(new), "returnSecureToken": .bool(true)])
    guard case .string(let idToken)? = body["idToken"], case .string(let refreshToken)? = body["refreshToken"]
    else { throw IdentityToolkitError(code: nil, status: 200) }
    return accept(user: user, idToken: idToken, refreshToken: refreshToken, expiresIn: body["expiresIn"])
  }

  /// Sets the display name on the account, as the console does when the name changes.
  @discardableResult
  public func updateDisplayName(_ name: String) async throws -> AglynUser {
    guard let current = session else { throw IdentityToolkitError(code: nil, status: 401) }
    let body = try await post(
      "\(identityBase)/v1/accounts:update?key=\(apiKey)",
      json: ["idToken": .string(current.idToken), "displayName": .string(name), "returnSecureToken": .bool(true)])
    let user = AglynUser(
      uid: current.user.uid, email: current.user.email, displayName: name.isEmpty ? nil : name,
      photoURL: current.user.photoURL)
    return accept(
      user: user, idToken: body["idToken"]?.stringValue ?? current.idToken,
      refreshToken: body["refreshToken"]?.stringValue ?? current.refreshToken, expiresIn: body["expiresIn"])
  }

  /// Removes a sign-in provider from the account (`accounts:update` with `deleteProvider`), as the
  /// console's `unlink` does, and keeps the fresh tokens the answer carries.
  public func deleteProvider(_ providerID: String) async throws {
    guard let current = session else { throw IdentityToolkitError(code: nil, status: 401) }
    let body = try await post(
      "\(identityBase)/v1/accounts:update?key=\(apiKey)",
      json: [
        "idToken": .string(current.idToken), "deleteProvider": .array([.string(providerID)]), "returnSecureToken": .bool(true),
      ])
    accept(
      user: current.user, idToken: body["idToken"]?.stringValue ?? current.idToken,
      refreshToken: body["refreshToken"]?.stringValue ?? current.refreshToken, expiresIn: body["expiresIn"])
  }

  /// The current ID token, refreshed a minute before it expires; nil when signed out.
  public func idToken(forceRefresh: Bool) async throws -> String? {
    guard let current = session else { return nil }
    if !forceRefresh && current.expiresAt.timeIntervalSince(now()) > 60 { return current.idToken }
    do {
      try await refresh(user: current.user, refreshToken: current.refreshToken)
    } catch let error as IdentityToolkitError where (400..<500).contains(error.status) {
      // A refresh the server refuses (revoked, disabled, deleted) ends the session.
      signOut()
      return nil
    }
    return session?.idToken
  }

  public func signOut() {
    session = nil
    store.save(nil)
  }

  private func refresh(user: AglynUser, refreshToken: String) async throws {
    var request = URLRequest(url: URL(string: "\(tokenBase)/v1/token?key=\(apiKey)")!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let encoded = ConsoleAPIClient.encodeComponent(refreshToken)
    request.httpBody = Data("grant_type=refresh_token&refresh_token=\(encoded)".utf8)
    let body = try await send(request)
    guard case .string(let idToken)? = body["id_token"], case .string(let refreshed)? = body["refresh_token"]
    else { throw IdentityToolkitError(code: nil, status: 200) }
    accept(user: user, idToken: idToken, refreshToken: refreshed, expiresIn: body["expires_in"])
  }

  /// Keeps the tokens, and reads whether the address is confirmed (`email_verified`) and the account's picture (`picture`)
  /// off the ID token, as the routes do.
  @discardableResult
  private func accept(user: AglynUser, idToken: String, refreshToken: String, expiresIn: JSONValue?) -> AglynUser {
    let seconds = expiresIn?.textValue.flatMap(Double.init) ?? 3600
    let user = user.fromToken(TokenClaims(idToken: idToken))
    session = Session(
      user: user, idToken: idToken, refreshToken: refreshToken,
      expiresAt: now().addingTimeInterval(seconds))
    store.save(
      StoredAuthSession(uid: user.uid, email: user.email, displayName: user.displayName, refreshToken: refreshToken))
    return user
  }

  private func post(_ url: String, json: [String: JSONValue]) async throws -> [String: JSONValue] {
    var request = URLRequest(url: URL(string: url)!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONValue.object(json).encoded()
    return try await send(request)
  }

  private func send(_ request: URLRequest) async throws -> [String: JSONValue] {
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await transport.send(request)
    } catch {
      throw IdentityToolkitError(code: nil, status: 0)
    }
    let body = JSONValue.decode(data)
    guard (200..<300).contains(response.statusCode) else {
      var code: String?
      if case .object(let record)? = body, case .object(let error)? = record["error"],
        case .string(let message)? = error["message"]
      {
        // "TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account…" carries a detail after the code; an
        // App Check refusal is a sentence instead of a code.
        code = isAppCheckRefusalText(message) ? IdentityToolkitError.appCheckRefused : message.components(separatedBy: " ").first
      }
      throw IdentityToolkitError(code: code, status: response.statusCode)
    }
    if case .object(let record)? = body { return record }
    return [:]
  }
}

extension JSONValue {
  /// A string, or a number written as one (`expiresIn` is `"3600"`).
  var textValue: String? {
    switch self {
    case .string(let value): return value
    case .number(let value): return value.rounded() == value ? String(Int(value)) : String(value)
    default: return nil
    }
  }
}
