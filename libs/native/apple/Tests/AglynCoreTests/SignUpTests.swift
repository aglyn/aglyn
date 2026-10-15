// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A writer that records each merge.
final class RecordingWriter: FirestoreWriter, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var merges: [(path: [String], data: [String: Any])] = []

  func merge(_ path: [String], _ data: [String: Any]) async throws {
    lock.withLock { merges.append((path, data)) }
  }
}

final class SignUpTests: XCTestCase {
  private func service(_ transport: RecordingTransport, writer: RecordingWriter = RecordingWriter()) -> SignUpService {
    SignUpService(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "tok" }, transport: transport, sleep: { _ in }),
      writer: writer, now: { Date(timeIntervalSince1970: 1_800_000_000) }, writesDeadlineNanoseconds: 1_000_000_000)
  }

  // MARK: The link's plan and campaign

  func testReadsThePlanALinkCarriesAsTheConsoleDoes() {
    XCTAssertEqual(
      OnboardingPlanIntent.parse(["plan": "Pro", "interval": "annual"]),
      OnboardingPlanIntent(plan: "pro", interval: "year", intervalStated: true, contactSales: false))
    XCTAssertEqual(
      OnboardingPlanIntent.parse(["plan": "business"]),
      OnboardingPlanIntent(plan: "business", interval: "month", intervalStated: false, contactSales: false))
    XCTAssertEqual(OnboardingPlanIntent.parse(["plan": "enterprise", "ai": "1"])?.contactSales, true)
    XCTAssertEqual(OnboardingPlanIntent.parse(["plan": "enterprise", "ai": "1"])?.ai, false)
    XCTAssertNil(OnboardingPlanIntent.parse(["plan": "free"]))
    XCTAssertNil(OnboardingPlanIntent.parse(["plan": "gold"]))
    XCTAssertNil(OnboardingPlanIntent.parse([:]))
    let pro = OnboardingPlanIntent.parse(["plan": "pro", "interval": "year", "ai": "yes"])!
    XCTAssertEqual(pro.query, "plan=pro&interval=year&ai=1")
    XCTAssertEqual(pro.destination(orgSlug: "acme"), "/acme/billing?plan=pro&interval=year&ai=1")
    XCTAssertEqual(pro.signUpHeadline, "Create your account to start on Pro, billed yearly")
    let enterprise = OnboardingPlanIntent.parse(["plan": "enterprise"])!
    XCTAssertEqual(enterprise.destination(orgSlug: "acme"), "/acme/support?topic=enterprise")
    XCTAssertEqual(enterprise.signUpHeadline, "Create your account — we’ll get you set up on Enterprise")
    // A stated-less plan keeps its interval unstated across the hop.
    XCTAssertEqual(OnboardingPlanIntent.parse(["plan": "scale"])?.query, "plan=scale")
  }

  func testKeepsOnlyTheThreeCampaignKeysAndNeverAnAddress() {
    let campaign = UtmAttribution.parse([
      "utm_source": " google ", "utm_medium": "cpc", "utm_campaign": "sept launch", "utm_term": "x", "email": "a@b.co",
    ])
    XCTAssertEqual(campaign, UtmAttribution(source: "google", medium: "cpc", campaign: "sept launch"))
    XCTAssertEqual(campaign?.query, "utm_source=google&utm_medium=cpc&utm_campaign=sept+launch")
    XCTAssertNil(UtmAttribution.parse(["utm_source": "someone@example.com"]))
    XCTAssertEqual(UtmAttribution.parse(["utm_source": String(repeating: "a", count: 150)])?.source?.count, 100)
  }

  // MARK: The form's rules

  func testTheWorkspaceNameMustBecomeAnAddress() {
    XCTAssertEqual(WorkspaceName.slug("Acme, Inc."), "acme-inc")
    XCTAssertEqual(WorkspaceName.slug("Café Délice"), "cafe-delice")
    XCTAssertEqual(WorkspaceName.slug("admin"), "")
    XCTAssertEqual(WorkspaceName.slug("Workspace"), "")
    XCTAssertEqual(WorkspaceName.slug("ab"), "")
    XCTAssertEqual(WorkspaceName.slug("🎉🎉"), "")
    XCTAssertEqual(WorkspaceName.slug("Shitake Mushrooms"), "")
    XCTAssertEqual(WorkspaceName.slug(String(repeating: "abc-", count: 12)).count <= 30, true)
    XCTAssertNil(SignUpRules.organization("Juniper Street Bakery"))
    XCTAssertEqual(SignUpRules.organization("admin"), WorkspaceName.refusal)
    XCTAssertEqual(SignUpRules.organization(" "), "Provide your organization/company name")
  }

  func testThePasswordRulesAnswerInTheFormsOrder() {
    XCTAssertEqual(SignUpRules.password(""), "Password is required")
    XCTAssertEqual(SignUpRules.password("PASSWORD1!"), "Must contain at least 1 lowercase letter")
    XCTAssertEqual(SignUpRules.password("password1!"), "Must contain at least 1 uppercase letter")
    XCTAssertEqual(SignUpRules.password("Password!"), "Must contain at least 1 number")
    XCTAssertEqual(SignUpRules.password("Password1"), "Must contain a special character [/!@$]")
    XCTAssertEqual(SignUpRules.password("Pass word1!"), "Password can not have spaces")
    XCTAssertEqual(SignUpRules.password("Pa1!"), "Length must between 6–30 characters")
    XCTAssertNil(SignUpRules.password("Passw0rd!"))
    XCTAssertEqual(SignUpRules.confirm("x", password: "y"), "Those passwords didn't match. Try again.")
    XCTAssertEqual(SignUpRules.firstName("A"), "Please enter a longer first name")
    XCTAssertEqual(SignUpRules.email("nope"), "Enter a valid email (name@domain.com)")
    XCTAssertNil(SignUpRules.email("ada@example.test"))
  }

  // MARK: The console routes, in order

  func testRecordsTheAcceptanceAttributionAndOptInThroughTheConsolesRoutes() async throws {
    let transport = RecordingTransport([(200, "{}"), (200, "{}"), (200, "{}")])
    let signUp = service(transport)
    let accepted = await signUp.recordAcceptance(.password)
    await signUp.recordAcquisition(door: SignUpDoor.google.acquisitionDoor)
    let opted = await signUp.recordMarketingOptIn()
    XCTAssertTrue(accepted)
    XCTAssertTrue(opted)
    XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/auth/legal-acceptance", "/api/auth/acquisition", "/api/auth/marketing-consent"])
    XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    // The server stamps the version it publishes: the app names only the door.
    XCTAssertEqual(transport.json(0) as NSDictionary, ["context": "signup-password"])
    XCTAssertEqual(transport.json(1) as NSDictionary, ["door": "signup-google"])
    XCTAssertEqual(
      transport.json(2) as NSDictionary, ["decision": "granted", "source": "console-signup", "textVersion": "2026-09-20"])
  }

  func testAFailedAcceptanceIsReportedNotThrown() async {
    let transport = RecordingTransport([(409, #"{"error":"The legal documents changed","reason":"version-mismatch"}"#)])
    let accepted = await service(transport).recordAcceptance(.google)
    XCTAssertFalse(accepted)
  }

  func testRemembersThePlanCampaignAndNameOnTheAccount() async {
    let writer = RecordingWriter()
    let signUp = service(RecordingTransport([]), writer: writer)
    await signUp.remember(
      uid: "u1", plan: OnboardingPlanIntent.parse(["plan": "pro"]), campaign: UtmAttribution(source: "google"),
      firstName: " Ada ", lastName: "Lovelace")
    XCTAssertEqual(writer.merges.count, 3)
    XCTAssertTrue(writer.merges.allSatisfy { $0.path == ["users", "u1"] })
    let merged = writer.merges.reduce(into: [String: Any]()) { all, merge in all.merge(merge.data) { $1 } }
    XCTAssertEqual((merged["onboardingPlanIntent"] as? [String: Any])?["query"] as? String, "plan=pro")
    XCTAssertEqual((merged["onboardingPlanIntent"] as? [String: Any])?["createdAtMs"] as? Int, 1_800_000_000_000)
    XCTAssertEqual((merged["signupCampaign"] as? [String: Any])?["query"] as? String, "utm_source=google")
    XCTAssertEqual(merged["firstName"] as? String, "Ada")
    XCTAssertEqual(merged["lastName"] as? String, "Lovelace")
  }

  func testHoldsTheTypedWorkspaceNameBoundToThePasswordProvider() async {
    let writer = RecordingWriter()
    await service(RecordingTransport([]), writer: writer).holdWorkspace(
      uid: "u1", PendingSignUpWorkspace(name: "  Acme  ", nameWasTyped: true))
    let held = writer.merges.first?.data["pendingSignUpWorkspace"] as? [String: Any]
    XCTAssertEqual(held?["name"] as? String, "Acme")
    XCTAssertEqual(held?["provider"] as? String, "password")
    XCTAssertEqual(held?["nameWasTyped"] as? Bool, true)
    XCTAssertEqual(held?["createdAtMs"] as? Int, 1_800_000_000_000)
  }

  /// The held name is honoured only inside its window and while the account still holds the provider that wrote it:
  /// after a federated takeover of an unverified password account, the password provider is gone.
  func testAHeldNameIsVoidAfterATakeoverOrOnceStale() {
    let now = 1_800_000_000_000
    let held: [String: Any] = ["name": "Acme", "nameWasTyped": true, "provider": "password", "createdAtMs": now - 1000]
    XCTAssertEqual(
      SignUpService.honour(held, providers: ["password"], nowMs: now), PendingSignUpWorkspace(name: "Acme", nameWasTyped: true))
    XCTAssertNil(SignUpService.honour(held, providers: ["google.com"], nowMs: now))
    var stale = held
    stale["createdAtMs"] = now - 8 * 24 * 60 * 60 * 1000
    XCTAssertNil(SignUpService.honour(stale, providers: ["password"], nowMs: now))
  }

  func testCreatesTheWorkspaceAndSaysWhyNot() async {
    let transport = RecordingTransport([
      (200, #"{"orgId":"o1","slug":"acme"}"#), (409, #"{"error":"That workspace URL is taken"}"#),
    ])
    let signUp = service(transport)
    let created = await signUp.createWorkspace(name: " Acme ")
    XCTAssertEqual(created, SignUpWorkspaceOutcome(slug: "acme", orgID: "o1", error: nil))
    XCTAssertEqual(transport.json(0) as NSDictionary, ["name": "Acme"])
    let taken = await signUp.createWorkspace(name: "Acme")
    XCTAssertEqual(taken, SignUpWorkspaceOutcome(slug: nil, orgID: nil, error: "That workspace URL is taken"))
  }

  func testSendsTheVerificationAndReadsEachAnswer() async {
    let transport = RecordingTransport([
      (200, #"{"ok":true}"#), (200, #"{"ok":true,"alreadyVerified":true}"#), (429, #"{"error":"x"}"#),
      (502, #"{"error":"Sending the email failed"}"#),
    ])
    let signUp = service(transport)
    let first = await signUp.sendVerification(automatic: true)
    let second = await signUp.sendVerification(automatic: false)
    let third = await signUp.sendVerification(automatic: false)
    let fourth = await signUp.sendVerification(automatic: false)
    XCTAssertEqual(first, .sent)
    XCTAssertEqual(transport.json(0) as NSDictionary, ["auto": true])
    XCTAssertEqual(second, .alreadyVerified)
    XCTAssertEqual(third, .failed("Too many requests — wait a moment before requesting another link."))
    XCTAssertEqual(fourth, .failed("Sending the email failed"))
  }

  func testThePasswordResetGoesThroughTheConsolesOwnEmail() async throws {
    let transport = RecordingTransport([(200, #"{"ok":true}"#)])
    try await service(transport).sendPasswordReset(email: " a@example.test ")
    XCTAssertEqual(transport.requests[0].url?.path, "/api/auth/send-password-reset")
    XCTAssertNil(transport.requests[0].value(forHTTPHeaderField: "Authorization"))
    XCTAssertEqual(transport.json(0) as NSDictionary, ["email": "a@example.test"])
  }

  func testReadsTheSignupsLockdown() async {
    let open = await service(RecordingTransport([(200, #"{"locked":false}"#)])).signupsPaused()
    XCTAssertNil(open)
    let locked = await service(RecordingTransport([(200, #"{"locked":true,"message":"Back at noon."}"#)])).signupsPaused()
    XCTAssertEqual(locked, "Back at noon.")
    let unreadable = await service(RecordingTransport([(500, "{}"), (500, "{}"), (500, "{}")])).signupsPaused()
    XCTAssertNil(unreadable)
  }

  func testADoorThatCollectedNoNameDerivesOne() {
    XCTAssertEqual(derivedWorkspaceName(displayName: " Grace Hopper ", email: "g@example.test"), "Grace Hopper")
    XCTAssertEqual(derivedWorkspaceName(displayName: nil, email: "grace@example.test"), "grace")
  }

  func testSignUpFailuresReadInTheConsolesWords() {
    XCTAssertEqual(
      signUpErrorMessage(IdentityToolkitError(code: "EMAIL_EXISTS", status: 400)),
      "Account with email already exists. Sign in instead.")
    XCTAssertEqual(
      signUpErrorMessage(IdentityToolkitError(code: "WEAK_PASSWORD", status: 400)),
      "Password is too weak. Enter a stronger password and try again.")
    XCTAssertTrue(
      signUpErrorMessage(IdentityToolkitError(code: "BLOCKING_FUNCTION_ERROR_RESPONSE", status: 400))
        .hasPrefix("Something went wrong on our end — no account was created"))
    XCTAssertEqual(
      signUpErrorMessage(IdentityToolkitError(code: nil, status: 0)),
      "Unable to connect. Check your internet connection and try again.")
    XCTAssertTrue(isCredentialRefusal(IdentityToolkitError(code: "INVALID_LOGIN_CREDENTIALS", status: 400)))
    XCTAssertFalse(isCredentialRefusal(IdentityToolkitError(code: "TOO_MANY_ATTEMPTS_TRY_LATER", status: 400)))
  }
}

final class ProviderSignInTests: XCTestCase {
  func testTheAppleNonceIsHashedForTheRequestAndKeptRawForFirebase() {
    let (raw, hashed) = AppleSignInNonce.make()
    XCTAssertEqual(raw.count, 32)
    XCTAssertEqual(hashed, AppleSignInNonce.sha256(raw))
    XCTAssertEqual(AppleSignInNonce.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    XCTAssertNotEqual(AppleSignInNonce.make().raw, raw)
  }

  func testAClosedSheetIsNotAFailure() {
    XCTAssertTrue(isCanceledSignIn(NSError(domain: "com.apple.AuthenticationServices.WebAuthenticationSession", code: 1)))
    XCTAssertTrue(isCanceledSignIn(NSError(domain: "com.apple.AuthenticationServices.AuthorizationError", code: 1001)))
    XCTAssertTrue(isCanceledSignIn(GoogleLinkError(message: "Google sign-in was canceled.")))
    XCTAssertFalse(isCanceledSignIn(IdentityToolkitError(code: "INVALID_IDP_RESPONSE", status: 400)))
  }

  /// A Google or Apple credential signs in through `accounts:signInWithIdp`, which says whether it signed somebody up.
  func testTheAppleCredentialCarriesItsRawNonce() async throws {
    let transport = RecordingTransport([
      (200, #"{"localId":"a1","email":"x@privaterelay.appleid.com","idToken":"t","refreshToken":"r","isNewUser":false}"#)
    ])
    let auth = IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore())
    let (_, isNew) = try await auth.signIn(idpPostBody: "id_token=apple&providerId=apple.com&nonce=raw-1")
    XCTAssertFalse(isNew)
    XCTAssertEqual(transport.json(0)["postBody"] as? String, "id_token=apple&providerId=apple.com&nonce=raw-1")
  }
}

final class ConsoleHandoffTests: XCTestCase {
  func testOpensTheConsolePageWithAChallengeOnlyTheAppCanAnswer() throws {
    let pending = ConsoleHandoff.begin(origin: "https://app.aglyn.com", app: .aglyn, start: .singleSignOn)
    let items = URLComponents(url: pending.url, resolvingAgainstBaseURL: false)!.queryItems!
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    XCTAssertEqual(pending.url.path, "/auth/native")
    XCTAssertEqual(value("start"), "sso")
    XCTAssertEqual(value("redirect_uri"), "aglyn://auth/handoff")
    XCTAssertEqual(value("challenge"), GoogleLink.challenge(for: pending.verifier))
    XCTAssertEqual(value("state"), pending.state)
    XCTAssertEqual(pending.callbackScheme, "aglyn")
    XCTAssertEqual(ConsoleHandoff.begin(origin: "https://app.aglyn.com", app: .pos, start: .signIn).callbackScheme, "aglyn-pos")
  }

  func testTheCodeIsReadOnlyFromThisSignInsReturn() throws {
    let pending = ConsoleHandoff.begin(origin: "https://app.aglyn.com", app: .aglyn, start: .signIn)
    let back = URL(string: "aglyn://auth/handoff?code=abc&state=\(pending.state)")!
    XCTAssertEqual(try ConsoleHandoff.code(from: back, pending: pending), "abc")
    XCTAssertThrowsError(try ConsoleHandoff.code(from: URL(string: "aglyn://auth/handoff?code=abc&state=other")!, pending: pending))
  }

  func testRedeemsTheCodeWithTheVerifierForATokenInItsPool() async throws {
    let transport = RecordingTransport([(200, #"{"ok":true,"token":"custom","tenantId":"aglyn-org-1"}"#)])
    let api = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in nil }, transport: transport, sleep: { _ in })
    let pending = ConsoleHandoff.begin(origin: "https://console.test", app: .aglyn, start: .signIn)
    let grant = try await ConsoleHandoff.redeem(api: api, code: "abc", pending: pending)
    XCTAssertEqual(grant, ConsoleHandoff.Grant(token: "custom", tenantID: "aglyn-org-1"))
    XCTAssertEqual(transport.requests[0].url?.path, "/api/auth/native-handoff/redeem")
    XCTAssertNil(transport.requests[0].value(forHTTPHeaderField: "Authorization"))
    XCTAssertEqual(
      transport.json(0) as NSDictionary,
      ["code": "abc", "verifier": pending.verifier, "redirectUri": "aglyn://auth/handoff"])
  }

  /// The acceptance case (AGL-3816): an address on a workspace's SSO domain is routed to SSO, and the hand-off's token signs
  /// the app in as the TENANT account, whose uid is what every Firestore read then runs as.
  func testAnSsoAddressIsRoutedToItsWorkspaceAndSignsInAsTheTenantAccount() async throws {
    let lookup = RecordingTransport([
      (200, #"{"ssoEnabled":true,"tenantId":"aglyn-org-y5v14","providerId":"saml.aglyn"}"#), (200, #"{"ssoEnabled":false}"#),
    ])
    let service = SignUpService(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in nil }, transport: lookup, sleep: { _ in }),
      writer: RecordingWriter())
    let routed = await service.usesSingleSignOn(" Sso-Member@Aglyn.com ")
    let notRouted = await service.usesSingleSignOn("someone@example.test")
    XCTAssertTrue(routed)
    XCTAssertFalse(notRouted)
    XCTAssertEqual(lookup.requests[0].url?.query, "email=sso-member%40aglyn.com")
    let pending = ConsoleHandoff.begin(
      origin: "https://app.aglyn.com", app: .aglyn, start: .singleSignOn, loginHint: "sso-member@aglyn.com")
    XCTAssertTrue(pending.url.absoluteString.contains("login_hint=sso-member@aglyn.com"))

    func encode(_ object: [String: Any]) -> String {
      let data = try! JSONSerialization.data(withJSONObject: object)
      return "h." + data.base64EncodedString().replacingOccurrences(of: "=", with: "")
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_") + ".s"
    }
    let idToken = encode([
      "user_id": "SsoTenantMemberUid0000000001", "email": "sso-member@aglyn.com", "email_verified": true,
      "firebase": ["tenant": "aglyn-org-y5v14"],
    ])
    let exchange = RecordingTransport([(200, #"{"idToken":"\#(idToken)","refreshToken":"r","expiresIn":"3600"}"#)])
    let auth = IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: exchange, store: MemoryCredentialStore())
    let user = try await auth.signIn(customToken: "custom-for-sso-member", tenantId: "aglyn-org-y5v14")
    XCTAssertEqual(user.uid, "SsoTenantMemberUid0000000001")
    XCTAssertTrue(user.emailVerified)
    XCTAssertEqual(exchange.json(0)["tenantId"] as? String, "aglyn-org-y5v14")
  }

  /// A new invitee lands with no workspace; the console's chooser leads with their invitations (AGL-851).
  func testReadsAndAnswersTheAccountsInvitationsThroughTheConsolesRoute() async throws {
    let transport = RecordingTransport([
      (200, #"{"invites":[{"$id":"i1","orgId":"o1","orgName":"Acme","role":"editor"},{"$id":"i2","orgId":"o2","orgName":"Beta","role":"owner","handoff":{"previousOwner":"stay"}},{"$id":"i3","orgId":null}]}"#),
      (200, "{}"),
    ])
    let service = SignUpService(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "tok" }, transport: transport, sleep: { _ in }),
      writer: RecordingWriter())
    let invites = await service.pendingInvites()
    XCTAssertEqual(transport.requests[0].url?.query, "mine=1")
    XCTAssertEqual(invites.map(\.id), ["i1", "i2"])
    XCTAssertEqual(invites[0].sentence, "You've been invited to Acme as editor.")
    XCTAssertEqual(invites[1].sentence, "You've been invited to take over Beta as its owner.")
    try await service.answer(invites[0], accept: true)
    XCTAssertEqual(transport.json(1) as NSDictionary, ["orgId": "o1", "action": "accept", "inviteId": "i1"])
  }
}
