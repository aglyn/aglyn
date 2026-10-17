import XCTest

@testable import AglynCore

/// The stored session read at launch never lands over a sign-in that began first.
@MainActor
final class AuthSessionLaunchTests: XCTestCase {
  private let signedIn =
    #"{"localId":"u1","email":"a@example.test","displayName":"","idToken":"id1","refreshToken":"r1","expiresIn":"3600"}"#
  private let refreshed = #"{"id_token":"id0","refresh_token":"r0b","expires_in":"3600"}"#

  /// On the main actor the launch task cannot run before `signIn` starts, which is the order a slow device (or a CI
  /// runner) produces: without the guard, the launch task refreshes the kept session behind the new sign-in's back.
  func testASignInBeforeTheLaunchRestoreRunsIsNotRefreshedAgain() async throws {
    let store = MemoryCredentialStore(StoredAuthSession(uid: "u0", email: "old@example.test", displayName: nil, refreshToken: "r0"))
    let transport = RecordingTransport([(200, signedIn), (200, refreshed)])
    let session = AuthSession(rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: store))
    try await session.signIn(email: "a@example.test", password: "pw")
    for _ in 0..<100 where !session.ready { try await Task.sleep(nanoseconds: 10_000_000) }
    // Let a launch task that did start a refresh finish it before counting.
    try await Task.sleep(nanoseconds: 50_000_000)
    XCTAssertTrue(session.ready)
    XCTAssertEqual(transport.requests.count, 1)
    XCTAssertEqual(session.user?.uid, "u1")
    XCTAssertEqual(store.load()?.refreshToken, "r1")
  }
}
