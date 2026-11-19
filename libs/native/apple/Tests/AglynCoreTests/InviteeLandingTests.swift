// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// An invitee who signs up lands in the invited workspace, with no workspace of their own (AGL-4047, the console's
/// `invitee-lands-in-invited-workspace.spec.tsx`, #2706). Kotlin's InviteeLandingTest asserts the same.
@MainActor
final class InviteeLandingTests: XCTestCase {
  /// A reader that answers `users/{uid}` with the name the sign-up held.
  private final class HeldNameReader: FirestoreReader, @unchecked Sendable {
    final class Listener: FirestoreListening { func remove() {} }
    let user: [String: Any]
    init(_ user: [String: Any]) { self.user = user }

    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
      -> FirestoreListening
    {
      onChange(.success([]))
      return Listener()
    }

    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
      -> FirestoreListening
    {
      onChange(.success(FirestoreDocument(id: path.last ?? "", data: user)))
      return Listener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  /// The console, which never answers the invitation check: as a slow or unreachable route.
  private final class SilentInvitesTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var paths: [String] = []

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
      let path = request.url?.path ?? ""
      lock.withLock { paths.append(path) }
      if path == "/api/orgs/invites" { try await Task.sleep(nanoseconds: 10_000_000_000) }
      let body = path == "/api/orgs/create" ? #"{"orgId":"o9","slug":"acme"}"# : "{}"
      return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
  }

  /// Whether provisioning said it was claiming the held name.
  private final class Claimed: @unchecked Sendable { var value = false }

  private static let nowMs = 1_800_000_000_000
  private let held: [String: Any] = [
    "pendingSignUpWorkspace": [
      "name": "Acme", "nameWasTyped": true, "provider": "password", "createdAtMs": InviteeLandingTests.nowMs - 1000,
    ]
  ]
  private let invited = #"{"invites":[{"$id":"i1","orgId":"o1","orgName":"North Studio","role":"editor"}]}"#

  private func service(_ transport: HTTPTransport, writer: RecordingWriter = RecordingWriter()) -> SignUpService {
    SignUpService(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "tok" }, transport: transport, sleep: { _ in }),
      writer: writer, now: { Date(timeIntervalSince1970: 1_800_000_000) }, writesDeadlineNanoseconds: 1_000_000_000)
  }

  private func paths(_ transport: RecordingTransport) -> [String] { transport.requests.map { $0.url?.path ?? "" } }

  // MARK: First run (the console's home provisioning)

  func testAnInviteesFirstRunCreatesNothingAndLeavesTheHeldNameUnclaimed() async {
    let transport = RecordingTransport([(200, invited)])
    let writer = RecordingWriter()
    let claimed = Claimed()
    let settled = await service(transport, writer: writer).settleFirstRun(
      uid: "u1", providers: ["password"], reader: HeldNameReader(held), joiningAnInvite: false, claiming: { claimed.value = true })
    XCTAssertEqual(settled, .invited)
    XCTAssertEqual(paths(transport), ["/api/orgs/invites"], "nothing is created")
    XCTAssertTrue(writer.merges.isEmpty, "the held name is left for a withdrawn invitation")
    XCTAssertFalse(claimed.value, "an invitee never sees 'Setting up your workspace…'")
  }

  func testNothingIsCreatedInTheGapAfterTheAutomaticJoinAccepted() async {
    // The accepted invitation has left the server's list, and its membership has not reached the workspace list yet.
    let transport = RecordingTransport([(200, #"{"invites":[]}"#)])
    let writer = RecordingWriter()
    let settled = await service(transport, writer: writer).settleFirstRun(
      uid: "u1", providers: ["password"], reader: HeldNameReader(held), joiningAnInvite: true)
    XCTAssertEqual(settled, .invited)
    XCTAssertEqual(paths(transport), [])
    XCTAssertTrue(writer.merges.isEmpty)
  }

  func testWithNoInvitationTheNamedWorkspaceIsCreatedAsBefore() async {
    let transport = RecordingTransport([(200, #"{"invites":[]}"#), (200, #"{"orgId":"o9","slug":"acme"}"#)])
    let writer = RecordingWriter()
    let claimed = Claimed()
    let settled = await service(transport, writer: writer).settleFirstRun(
      uid: "u1", providers: ["password"], reader: HeldNameReader(held), joiningAnInvite: false, claiming: { claimed.value = true })
    XCTAssertEqual(settled, .created(slug: "acme", plan: nil))
    XCTAssertEqual(paths(transport), ["/api/orgs/invites", "/api/orgs/create"])
    XCTAssertEqual(transport.json(1) as NSDictionary, ["name": "Acme"])
    XCTAssertTrue(claimed.value)
    XCTAssertNotNil(writer.merges.first { $0.data["pendingSignUpWorkspace"] is NSNull }, "the held name was claimed")
  }

  // MARK: The verified sign-up doors (Google, Apple)

  func testAVerifiedDoorCreatesNothingWhenAnInvitationIsWaiting() async {
    let transport = RecordingTransport([(200, invited)])
    let outcome = await service(transport).provisionVerifiedSignUp(name: "Ada Lovelace")
    XCTAssertNil(outcome)
    XCTAssertEqual(paths(transport), ["/api/orgs/invites"])
  }

  func testAVerifiedDoorWithNoInvitationProvisionsAsBefore() async {
    let transport = RecordingTransport([(200, #"{"invites":[]}"#), (200, #"{"orgId":"o9","slug":"ada"}"#)])
    let outcome = await service(transport).provisionVerifiedSignUp(name: "Ada Lovelace")
    XCTAssertEqual(outcome?.slug, "ada")
    XCTAssertEqual(paths(transport), ["/api/orgs/invites", "/api/orgs/create"])
  }

  func testARefusedOrSilentCheckProvisionsAsBefore() async {
    let refused = RecordingTransport([(500, #"{"error":"x"}"#), (200, #"{"orgId":"o9","slug":"ada"}"#)])
    let afterRefusal = await service(refused).provisionVerifiedSignUp(name: "Ada")
    XCTAssertEqual(afterRefusal?.slug, "ada")

    let silent = SilentInvitesTransport()
    let started = Date()
    let afterSilence = await service(silent).provisionVerifiedSignUp(name: "Ada", deadlineNanoseconds: 50_000_000)
    XCTAssertEqual(afterSilence?.slug, "acme")
    XCTAssertLessThan(Date().timeIntervalSince(started), 5, "the deadline, not the route, decides")
  }

  // MARK: Several invitations: the newest opens

  func testInvitationsReadNewestFirstWithUndatedOnesAfter() {
    let old = PendingInvite(id: "old", orgID: "o1", orgName: nil, role: nil, handoff: false, createdAtMs: 1_000)
    let new = PendingInvite(id: "new", orgID: "o2", orgName: nil, role: nil, handoff: false, createdAtMs: 2_000)
    let undatedA = PendingInvite(id: "a", orgID: "o3", orgName: nil, role: nil, handoff: false)
    let undatedB = PendingInvite(id: "b", orgID: "o4", orgName: nil, role: nil, handoff: false)
    XCTAssertEqual(newestInvitesFirst([undatedA, old, undatedB, new]).map(\.id), ["new", "old", "a", "b"])
    XCTAssertEqual(newestInvitesFirst([undatedA, undatedB]).map(\.id), ["a", "b"], "an answer without dates is unchanged")
    XCTAssertEqual(latestInvite([old, new])?.id, "new")
    XCTAssertNil(latestInvite([]))
  }

  func testReadsWhenEachInvitationWasSent() async {
    let transport = RecordingTransport([
      (200, #"{"invites":[{"$id":"i2","orgId":"o2","createdAtMs":2000},{"$id":"i1","orgId":"o1"}]}"#)
    ])
    let invites = await service(transport).pendingInvites()
    XCTAssertEqual(invites.map(\.createdAtMs), [2000, nil])
  }
}
