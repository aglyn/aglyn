// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import FirebaseAuth
import Foundation

/// The plan a visitor picked on the marketing pricing page, carried on the sign-up link
/// (`aglyn://signup?plan=pro&interval=year`, or the console's `/signup?plan=…`): the console's
/// `parseOnboardingPlanIntent` (libs/aglyn/src/lib/app-utils/onboarding-deep-link.ts).
public struct OnboardingPlanIntent: Equatable, Sendable {
  public var plan: String
  /// `month` or `year`.
  public var interval: String
  /// Whether the link said an interval, rather than `interval` being the default.
  public var intervalStated: Bool
  /// Enterprise is quoted, not bought: it goes to contact sales.
  public var contactSales: Bool
  /// The AI add-on, asked for alongside the plan (`ai=1`).
  public var ai: Bool

  /// The plans a checkout can sell (`SELF_SERVE_PLANS`).
  public static let selfServePlans = ["starter", "pro", "business", "scale", "advanced", "agency"]

  /// `PLAN_LABELS` (libs/aglyn/src/lib/app-utils/plan-entitlements.ts).
  public static let planLabels: [String: String] = [
    "free": "Free", "starter": "Starter", "pro": "Pro", "business": "Business", "scale": "Scale",
    "advanced": "Advanced", "agency": "Agency", "enterprise": "Enterprise",
  ]

  public init(plan: String, interval: String, intervalStated: Bool, contactSales: Bool, ai: Bool = false) {
    self.plan = plan
    self.interval = interval
    self.intervalStated = intervalStated
    self.contactSales = contactSales
    self.ai = ai
  }

  /// The intent a link's query carries, or nil when it names no plan this console sells.
  public static func parse(_ params: [String: String]) -> OnboardingPlanIntent? {
    func read(_ key: String) -> String { (params[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    let plan = read("plan")
    if plan.isEmpty { return nil }
    if plan == "enterprise" {
      return OnboardingPlanIntent(plan: plan, interval: "month", intervalStated: false, contactSales: true)
    }
    guard selfServePlans.contains(plan) else { return nil }
    let interval = read("interval")
    let ai = read("ai")
    return OnboardingPlanIntent(
      plan: plan, interval: interval == "year" || interval == "annual" ? "year" : "month",
      intervalStated: interval == "year" || interval == "annual" || interval == "month", contactSales: false,
      ai: ai == "1" || ai == "true" || ai == "yes")
  }

  /// The canonical query (`onboardingPlanQuery`): `plan=pro&interval=year&ai=1`.
  public var query: String {
    "plan=\(ConsoleAPIClient.encodeComponent(plan))" + (intervalStated ? "&interval=\(interval)" : "") + (ai ? "&ai=1" : "")
  }

  public var label: String { Self.planLabels[plan] ?? plan.capitalized }

  /// Where a new workspace lands with this intent (`onboardingDestination`).
  public func destination(orgSlug: String) -> String {
    contactSales ? "/\(orgSlug)/support?topic=enterprise" : "/\(orgSlug)/billing?\(query)"
  }

  /// The sign-up form's subheading for this intent.
  public var signUpHeadline: String {
    contactSales
      ? "Create your account — we’ll get you set up on \(label)"
      : "Create your account to start on \(label), billed \(interval == "year" ? "yearly" : "monthly")"
  }
}

/// Which campaign produced a sign-up: the three allowlisted `utm_` keys and nothing else
/// (`parseUtmAttribution`, libs/aglyn/src/lib/app-utils/utm-attribution.ts).
public struct UtmAttribution: Equatable, Sendable {
  public static let keys = ["utm_source", "utm_medium", "utm_campaign"]
  public var source: String?
  public var medium: String?
  public var campaign: String?

  public init(source: String? = nil, medium: String? = nil, campaign: String? = nil) {
    self.source = source
    self.medium = medium
    self.campaign = campaign
  }

  /// Nil when the link carries none. A value that looks like an email address is dropped, and each is capped at 100.
  public static func parse(_ params: [String: String]) -> UtmAttribution? {
    func scrub(_ raw: String?) -> String? {
      let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if value.isEmpty || value.range(of: #"[^\s@]+@[^\s@]+\.[^\s@]+"#, options: .regularExpression) != nil { return nil }
      return String(value.prefix(100))
    }
    let found = UtmAttribution(source: scrub(params["utm_source"]), medium: scrub(params["utm_medium"]), campaign: scrub(params["utm_campaign"]))
    return found.source == nil && found.medium == nil && found.campaign == nil ? nil : found
  }

  /// The canonical wire form (`utmAttributionQuery`).
  public var query: String {
    [("utm_source", source), ("utm_medium", medium), ("utm_campaign", campaign)]
      .compactMap { key, value in value.map { "\(key)=\(Self.formEncode($0))" } }
      .joined(separator: "&")
  }

  /// `URLSearchParams` encoding: spaces as `+`.
  static func formEncode(_ value: String) -> String {
    ConsoleAPIClient.encodeComponent(value).replacingOccurrences(of: "%20", with: "+")
  }
}

/// The sign-up form's rules, as the console's form schema states them (libs/shared/data/forms/src/lib/fields.ts and the
/// sign-up page's `signupOrgNameField`). Each answers the first rule a value breaks, in the form's words, or nil.
public enum SignUpRules {
  public static func firstName(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "Please enter a first name" }
    return trimmed.count < 2 ? "Please enter a longer first name" : nil
  }

  public static func lastName(_ value: String) -> String? {
    value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Provide your last name" : nil
  }

  public static func organization(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "Provide your organization/company name" }
    return WorkspaceName.slug(trimmed).isEmpty ? WorkspaceName.refusal : nil
  }

  public static func email(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "Email address is required" }
    return trimmed.range(of: #"[^\s@]+@[^\s@.]+(\.[^\s@.]+)+"#, options: .regularExpression) == nil
      ? "Enter a valid email (name@domain.com)" : nil
  }

  public static func password(_ value: String) -> String? {
    if value.isEmpty { return "Password is required" }
    if value.range(of: "[a-z]", options: .regularExpression) == nil { return "Must contain at least 1 lowercase letter" }
    if value.range(of: "[A-Z]", options: .regularExpression) == nil { return "Must contain at least 1 uppercase letter" }
    if value.range(of: "[0-9]", options: .regularExpression) == nil { return "Must contain at least 1 number" }
    if value.range(of: "[^A-Za-z0-9_]", options: .regularExpression) == nil { return "Must contain a special character [/!@$]" }
    if value.range(of: #"\s"#, options: .regularExpression) != nil { return "Password can not have spaces" }
    return value.count < 6 ? "Length must between 6–30 characters" : nil
  }

  public static func confirm(_ value: String, password: String) -> String? {
    if value.isEmpty { return "Confirm your password." }
    return value != password ? "Those passwords didn't match. Try again." : nil
  }
}

/// A workspace name has to survive becoming a workspace address (AGL-1115): the console's `generateOrgSlug`
/// (libs/aglyn/src/lib/app-utils/organizations.ts over host-naming.ts). The brand-impersonation screen that
/// `isBlockedSubdomain` also runs stays on the server: `/api/orgs/create` refuses such a name in its own words.
public enum WorkspaceName {
  /// `RESERVED_SUBDOMAINS` and the organization-only `RESERVED_ORG_ONLY`.
  public static let reserved: Set<String> = [
    "www", "app", "api", "admin", "console", "mail", "demo", "staging", "dev", "test", "docs", "blog", "help",
    "support", "status", "cdn", "assets", "static", "ftp", "smtp", "ns1", "ns2", "aglyn", "billing", "account",
    "login", "signup", "auth", "accounts", "signin", "sso", "secure", "verify", "portal", "webmail", "imap", "mx",
    "com", "net", "staff", "org", "orgs", "workspace", "kiosk",
  ]
  /// `BLOCKED_FRAGMENTS`, refused as substrings.
  static let blockedFragments = ["fuck", "shit", "cunt", "nigger", "faggot", "bitch", "porn", "nazi"]

  public static let refusal =
    "Pick a different name — this one can’t be used as a workspace address. Try adding a word, and avoid reserved names like “admin” or “workspace”."

  public static func helper(workspaceDomain: String) -> String {
    "This becomes your workspace address, e.g. acme-inc.\(workspaceDomain)"
  }

  /// The address a name becomes, or "" when nothing usable remains.
  public static func slug(_ name: String) -> String {
    var slug = name.lowercased().decomposedStringWithCompatibilityMapping
      .replacingOccurrences(of: "[\\u0300-\\u036f]", with: "", options: .regularExpression)
      .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "-{2,}", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
    slug = String(slug.prefix(30)).replacingOccurrences(of: "-+$", with: "", options: .regularExpression)
    guard slug.range(of: "^[a-z0-9][a-z0-9-]{2,29}$", options: .regularExpression) != nil else { return "" }
    let collapsed = slug.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    if reserved.contains(slug) || blockedFragments.contains(where: { collapsed.contains($0) }) { return "" }
    return slug
  }
}

/// The marketing opt-in the sign-up form offers beside the terms (`PLATFORM_MARKETING_CONSENT_TEXT`): never
/// pre-ticked, never required, and recorded under the wording's version.
public enum MarketingConsent {
  public static let textVersion = "2026-09-20"
  public static func text(brand: String) -> String { "Send me product updates from \(brand). You can opt out any time." }
}

/// A sign-up's door, the `context` its acceptance is recorded under (`LegalAcceptanceContext`).
public enum SignUpDoor: String, Sendable {
  case password = "signup-password"
  case google = "signup-google"
  case apple = "signup-apple"

  /// The acquisition door the console's `/api/auth/acquisition` accepts for it; Apple has none.
  public var acquisitionDoor: String? {
    switch self {
    case .password: return nil
    case .google: return "signup-google"
    case .apple: return nil
    }
  }
}

/// The name a sign-up asked its workspace to have, held on the account until the address is confirmed
/// (`pendingSignUpWorkspace`, apps/console/utils/signup-workspace.ts).
public struct PendingSignUpWorkspace: Equatable, Sendable {
  public var name: String
  public var nameWasTyped: Bool

  public init(name: String, nameWasTyped: Bool) {
    self.name = name
    self.nameWasTyped = nameWasTyped
  }
}

/// What `/api/orgs/create` answered.
public struct SignUpWorkspaceOutcome: Equatable, Sendable {
  public var slug: String?
  public var orgID: String?
  public var error: String?

  public init(slug: String?, orgID: String?, error: String?) {
    self.slug = slug
    self.orgID = orgID
    self.error = error
  }
}

/// How sending the verification email went.
public enum VerificationSend: Equatable, Sendable {
  case sent
  case alreadyVerified
  case failed(String)
}

/// The console routes and `users/{uid}` writes every sign-up door makes, in the console's order and with its failure
/// handling: everything after the account exists is best-effort, so a failed record never reads as a failed sign-up
/// (apps/console/app/(auth)/signup/page.tsx). There is no privileged app path: the routes are the console's own.
public struct SignUpService: Sendable {
  public let api: ConsoleAPIClient
  public let writer: FirestoreWriter
  let now: @Sendable () -> Date
  /// How long the `users/{uid}` writes are waited on (`SIGN_UP_WRITES_DEADLINE_MS`).
  let writesDeadlineNanoseconds: UInt64

  static let field = "pendingSignUpWorkspace"
  /// How long a held name or plan stays honourable (seven days, as the console's `MAX_AGE_MS`).
  static let maxAge: TimeInterval = 7 * 24 * 60 * 60

  public init(
    api: ConsoleAPIClient, writer: FirestoreWriter, now: @escaping @Sendable () -> Date = { Date() },
    writesDeadlineNanoseconds: UInt64 = 4_000_000_000
  ) {
    self.api = api
    self.writer = writer
    self.now = now
    self.writesDeadlineNanoseconds = writesDeadlineNanoseconds
  }

  private var nowMs: Int { Int(now().timeIntervalSince1970 * 1000) }

  /// The signups lockdown's notice (AGL-1510), or nil when signups are open. An unreadable answer means open: the
  /// server gates decide.
  public func signupsPaused() async -> String? {
    guard
      let answer = try? await api.request("/api/lockdown-status", query: [("feature", "signups")], anonymous: true),
      answer["locked"] == .bool(true)
    else { return nil }
    return answer["message"]?.stringValue ?? "New signups are temporarily paused."
  }

  /// Records the clickwrap acceptance for the signed-in account (`postLegalAcceptance`). The server stamps the
  /// version it publishes and its own clock; the app shows the live documents, so it names no version of its own.
  @discardableResult
  public func recordAcceptance(_ door: SignUpDoor) async -> Bool {
    (try? await api.request("/api/auth/legal-acceptance", method: .post, body: .object(["context": .string(door.rawValue)])))
      != nil
  }

  /// Where the account came from (`rememberAccountAcquisition`); the server decides from the verified token whether
  /// there is anything to record.
  public func recordAcquisition(door: String?) async {
    var body: [String: JSONValue] = [:]
    if let door { body["door"] = .string(door) }
    _ = try? await api.request("/api/auth/acquisition", method: .post, body: .object(body))
  }

  /// The plan, the campaign and the typed name, on the account (`rememberOnboardingPlanIntent`,
  /// `rememberSignUpCampaign`, `persistSignUpProfile`), waited on for no longer than the deadline.
  public func remember(
    uid: String, plan: OnboardingPlanIntent?, campaign: UtmAttribution?, firstName: String? = nil, lastName: String? = nil
  ) async {
    var writes: [@Sendable () async -> Void] = []
    let path = ["users", uid]
    let stamp = nowMs
    if let plan {
      writes.append { [writer] in
        try? await writer.merge(path, ["onboardingPlanIntent": ["query": plan.query, "createdAtMs": stamp]])
      }
    }
    if let campaign, !campaign.query.isEmpty {
      writes.append { [writer] in
        try? await writer.merge(path, ["signupCampaign": ["query": campaign.query, "createdAtMs": stamp]])
      }
    }
    let first = (firstName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let last = (lastName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !first.isEmpty || !last.isEmpty {
      writes.append { [writer] in try? await writer.merge(path, ["firstName": first, "lastName": last]) }
    }
    await settle(writes)
  }

  /// Holds the typed workspace name with the account until the address is confirmed (`rememberPendingSignUpWorkspace`),
  /// bound to the password provider that wrote it.
  public func holdWorkspace(uid: String, _ pending: PendingSignUpWorkspace) async {
    let name = pending.name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    let stored: [String: Any] = [
      "name": name, "nameWasTyped": pending.nameWasTyped, "provider": "password", "createdAtMs": nowMs,
    ]
    let path = ["users", uid]
    await settle([{ [writer] in try? await writer.merge(path, [Self.field: stored]) }])
  }

  /// Takes the held name, once (`claimPendingSignUpWorkspace`). The record is cleared whatever is decided about it; it
  /// is honoured only inside its window and while the account still holds the provider that wrote it.
  public func claimHeldWorkspace(uid: String, providers: [String], reader: FirestoreReader) async -> PendingSignUpWorkspace? {
    guard let doc = try? await reader.readOnce(["users", uid]),
      let held = doc.data[Self.field] as? [String: Any]
    else { return nil }
    do {
      try await writer.merge(["users", uid], [Self.field: NSNull()])
    } catch {
      return nil
    }
    return Self.honour(held, providers: providers, nowMs: nowMs)
  }

  static func honour(_ held: [String: Any], providers: [String], nowMs: Int) -> PendingSignUpWorkspace? {
    guard let name = held["name"] as? String, !name.isEmpty else { return nil }
    let created = (held["createdAtMs"] as? NSNumber)?.doubleValue ?? 0
    guard created > 0, Double(nowMs) - created <= maxAge * 1000 else { return nil }
    guard let provider = held["provider"] as? String, !provider.isEmpty, providers.contains(provider) else { return nil }
    return PendingSignUpWorkspace(name: name, nameWasTyped: held["nameWasTyped"] as? Bool == true)
  }

  /// Takes the plan the account remembers from sign-up, once (`consumeOnboardingPlanIntent`).
  public func consumePlanIntent(uid: String, reader: FirestoreReader) async -> OnboardingPlanIntent? {
    guard let doc = try? await reader.readOnce(["users", uid]),
      let stored = doc.data["onboardingPlanIntent"] as? [String: Any],
      let query = stored["query"] as? String, !query.isEmpty
    else { return nil }
    try? await writer.merge(["users", uid], ["onboardingPlanIntent": NSNull()])
    let created = (stored["createdAtMs"] as? NSNumber)?.doubleValue ?? 0
    guard created > 0, Double(nowMs) - created <= Self.maxAge * 1000 else { return nil }
    return OnboardingPlanIntent.parse(DeepLinks.queryParams(query))
  }

  /// Creates the workspace (`createSignUpWorkspace`). A 409 means the address was taken and nothing was created.
  public func createWorkspace(name: String) async -> SignUpWorkspaceOutcome {
    do {
      let answer = try await api.request(
        "/api/orgs/create", method: .post,
        body: .object(["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))]))
      return SignUpWorkspaceOutcome(slug: answer?["slug"]?.stringValue, orgID: answer?["orgId"]?.stringValue, error: nil)
    } catch let error as ConsoleAPIError {
      return SignUpWorkspaceOutcome(slug: nil, orgID: nil, error: error.body?["error"]?.stringValue)
    } catch {
      return SignUpWorkspaceOutcome(slug: nil, orgID: nil, error: nil)
    }
  }

  /// Records the product-updates opt-in (`postPlatformMarketingConsent`), only ever when it was ticked.
  @discardableResult
  public func recordMarketingOptIn() async -> Bool {
    (try? await api.request(
      "/api/auth/marketing-consent", method: .post,
      body: .object([
        "decision": "granted", "source": "console-signup", "textVersion": .string(MarketingConsent.textVersion),
      ]))) != nil
  }

  /// Sends the verification email (`/verify-email`'s `sendLink`); `automatic` is the page's first, cooled-down send.
  public func sendVerification(automatic: Bool) async -> VerificationSend {
    do {
      let answer = try await api.request(
        "/api/auth/send-verification", method: .post, body: .object(["auto": .bool(automatic)]))
      return answer?["alreadyVerified"] == .bool(true) ? .alreadyVerified : .sent
    } catch let error as ConsoleAPIError where error.status == 429 {
      return .failed("Too many requests — wait a moment before requesting another link.")
    } catch let error as ConsoleAPIError where error.status != 0 {
      return .failed(error.body?["error"]?.stringValue ?? "We couldn’t send the verification email. Try again shortly.")
    } catch {
      return .failed("We couldn’t send the verification email. Try again shortly.")
    }
  }

  /// Sends a password reset link (`/account-recovery`): the console's own branded email, never Firebase's default.
  public func sendPasswordReset(email: String) async throws {
    try await api.request(
      "/api/auth/send-password-reset", method: .post,
      body: .object(["email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines))]), anonymous: true)
  }

  /// Whether `email`'s domain signs in through a workspace's single sign-on (`/api/auth/sso-lookup`, the console's `/sso`
  /// discovery): such an address lives in that workspace's identity pool, so a password sign-in in the project pool is not
  /// its account. An unreadable answer is no.
  public func usesSingleSignOn(_ email: String) async -> Bool {
    let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard trimmed.contains("@"),
      let answer = try? await api.request("/api/auth/sso-lookup", query: [("email", trimmed)], anonymous: true)
    else { return false }
    return answer["ssoEnabled"] == .bool(true) && (answer["tenantId"]?.stringValue ?? "").isEmpty == false
  }

  /// The confirmed alternative address an account signs in with (`/api/auth/resolve-identifier`), or nil.
  public func resolveIdentifier(_ typed: String) async -> String? {
    guard
      let answer = try? await api.request(
        "/api/auth/resolve-identifier", method: .post, body: .object(["identifier": .string(typed)]), anonymous: true),
      let email = answer["email"]?.stringValue,
      email.lowercased() != typed.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    else { return nil }
    return email
  }

  /// Waits for the writes, but never longer than the deadline (`settleSignUpWrites`). Stopping the wait does not stop
  /// a write.
  func settle(_ writes: [@Sendable () async -> Void]) async {
    guard !writes.isEmpty else { return }
    let deadline = writesDeadlineNanoseconds
    await withTaskGroup(of: Bool.self) { group in
      group.addTask {
        await withTaskGroup(of: Void.self) { inner in
          for write in writes { inner.addTask { await write() } }
        }
        return true
      }
      group.addTask {
        try? await Task.sleep(nanoseconds: deadline)
        return false
      }
      _ = await group.next()
      group.cancelAll()
    }
  }
}

/// An invitation addressed to any confirmed address on the signed-in account (`GET /api/orgs/invites?mine=1`).
public struct PendingInvite: Equatable, Identifiable, Sendable {
  public let id: String
  public let orgID: String
  public let orgName: String?
  public let role: String?
  /// Whether the invitation hands the workspace over to its invitee (AGL-3466).
  public let handoff: Bool

  public init(id: String, orgID: String, orgName: String?, role: String?, handoff: Bool) {
    self.id = id
    self.orgID = orgID
    self.orgName = orgName
    self.role = role
    self.handoff = handoff
  }

  /// "You've been invited to Acme as admin." (the console's `inviteSentence`).
  public var sentence: String {
    if handoff { return "You've been invited to take over \(orgName ?? "a workspace") as its owner." }
    return "You've been invited to \(orgName ?? "an organization")" + (role.map { " as \($0)" } ?? "") + "."
  }
}

extension SignUpService {
  /// The account's pending invitations; none when they cannot be read.
  public func pendingInvites() async -> [PendingInvite] {
    guard let answer = try? await api.request("/api/orgs/invites", query: [("mine", "1")]),
      case .array(let rows)? = answer["invites"]
    else { return [] }
    return rows.compactMap { row in
      guard let id = row["$id"]?.stringValue, let org = row["orgId"]?.stringValue, !org.isEmpty else { return nil }
      let handoff: Bool = { if case .object? = row["handoff"] { return true } else { return false } }()
      return PendingInvite(
        id: id, orgID: org, orgName: row["orgName"]?.stringValue, role: row["role"]?.stringValue, handoff: handoff)
    }
  }

  /// Accepts or declines an invitation, as the console's dialog does (`POST /api/orgs/invites`).
  public func answer(_ invite: PendingInvite, accept: Bool) async throws {
    try await api.request(
      "/api/orgs/invites", method: .post,
      body: .object([
        "orgId": .string(invite.orgID), "action": .string(accept ? "accept" : "decline"), "inviteId": .string(invite.id),
      ]))
  }
}

/// The name a door that collected none derives for its workspace (`derivePersonalOrgName`): the display name, else the
/// email's local part.
public func derivedWorkspaceName(displayName: String?, email: String?) -> String {
  let name = (displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if !name.isEmpty { return name }
  return (email ?? "").split(separator: "@").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
}

/// The words a failed sign-up shows, by Firebase Auth error code (`AuthErrorMessage`).
public func signUpErrorMessage(_ error: Error) -> String {
  if isAppCheckRefusal(error) { return appCheckRefusalMessage }
  let code = authErrorCode(error)
  switch code {
  case "EMAIL_EXISTS": return "Account with email already exists. Sign in instead."
  case let value? where value.hasPrefix("WEAK_PASSWORD"): return "Password is too weak. Enter a stronger password and try again."
  case "INVALID_EMAIL": return "Unable to perform action. Email provided is invalid."
  case "TOO_MANY_ATTEMPTS_TRY_LATER": return "Account blocked from too many attempts. Try again later."
  case "USER_DISABLED":
    return "This account is currently disabled. Contact \(AglynBrand.name) support to restore access, or to appeal the decision."
  case "NEED_CONFIRMATION", "FEDERATED_USER_ID_ALREADY_LINKED", "EMAIL_EXISTS_WITH_DIFFERENT_CREDENTIAL":
    return "Authentication credential already in use with different credential."
  case "NETWORK": return "Unable to connect. Check your internet connection and try again."
  case "INTERNAL", "BLOCKING_FUNCTION_ERROR_RESPONSE":
    // Where a refusing `beforeUserCreated` blocking function surfaces.
    return "Something went wrong on our end — no account was created and nothing you entered was saved. Please try again, and if it keeps happening contact \(AglynBrand.name) support."
  default:
    return "An error has occurred. Please try again — if it keeps happening, contact \(AglynBrand.name) support."
  }
}

/// The Identity Toolkit code a failure carries (the REST client's own, or the Firebase SDK's error mapped to it), so
/// one set of words answers both transports.
public func authErrorCode(_ error: Error) -> String? {
  if let rest = error as? IdentityToolkitError { return rest.code ?? (rest.status == 0 ? "NETWORK" : nil) }
  let ns = error as NSError
  guard ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) else { return nil }
  switch code {
  case .emailAlreadyInUse: return "EMAIL_EXISTS"
  case .weakPassword: return "WEAK_PASSWORD"
  case .invalidEmail: return "INVALID_EMAIL"
  case .tooManyRequests: return "TOO_MANY_ATTEMPTS_TRY_LATER"
  case .networkError: return "NETWORK"
  case .userDisabled: return "USER_DISABLED"
  case .accountExistsWithDifferentCredential, .credentialAlreadyInUse: return "NEED_CONFIRMATION"
  case .expiredActionCode: return "EXPIRED_OOB_CODE"
  case .invalidActionCode: return "INVALID_OOB_CODE"
  case .userNotFound: return "EMAIL_NOT_FOUND"
  case .wrongPassword: return "INVALID_PASSWORD"
  case .invalidCredential: return "INVALID_LOGIN_CREDENTIALS"
  case .internalError, .blockingCloudFunctionError: return "INTERNAL"
  default: return "OTHER"
  }
}

/// Whether a sign-in failed on the credentials alone, the one refusal a confirmed secondary address may retry
/// (`signInWithAnyConfirmedAddress`): never a disabled account, a rate limit or a network failure.
public func isCredentialRefusal(_ error: Error) -> Bool {
  ["INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_EMAIL", "INVALID_PASSWORD"].contains(authErrorCode(error) ?? "")
}

/// The reset and verification links' failures, in the console's words.
public func actionCodeMessage(_ error: Error) -> String {
  switch authErrorCode(error) {
  case "EXPIRED_OOB_CODE": return "This link has expired. Request a new password reset link and try again."
  case "INVALID_OOB_CODE": return "This link is invalid or has already been used. Request a new password reset link."
  default: return signUpErrorMessage(error)
  }
}
