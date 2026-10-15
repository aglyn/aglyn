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
