import XCTest

@testable import AglynCore

final class GoogleLinkTests: XCTestCase {
  private let client = "1234-abc.apps.googleusercontent.com"

  func testTheRedirectSchemeIsTheReversedClientID() {
    XCTAssertEqual(GoogleLink.redirectScheme(iosClientID: client), "com.googleusercontent.apps.1234-abc")
  }

  func testThePKCEChallengeIsTheS256OfTheVerifier() {
    // The example in RFC 7636, appendix B.
    XCTAssertEqual(
      GoogleLink.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    let made = GoogleLink.pkce()
    XCTAssertEqual(GoogleLink.challenge(for: made.verifier), made.challenge)
    XCTAssertGreaterThanOrEqual(made.verifier.count, 43)
  }

  func testTheAuthorizationURLAsksForACodeForThisClientWithPKCE() throws {
    let url = GoogleLink.authorizationURL(iosClientID: client, challenge: "ch", state: "st", loginHint: "a@b.c")
    let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
    XCTAssertEqual(url.host, "accounts.google.com")
    XCTAssertEqual(items["client_id"], client)
    XCTAssertEqual(items["redirect_uri"], "com.googleusercontent.apps.1234-abc:/oauth2redirect")
    XCTAssertEqual(items["response_type"], "code")
    XCTAssertEqual(items["code_challenge_method"], "S256")
    XCTAssertEqual(items["state"], "st")
    XCTAssertEqual(items["login_hint"], "a@b.c")
  }

  func testTheCodeComesBackOnlyWithTheStateWeSent() throws {
    XCTAssertEqual(try GoogleLink.authorizationCode(from: URL(string: "x:/oauth2redirect?code=abc&state=st")!, state: "st"), "abc")
    XCTAssertThrowsError(try GoogleLink.authorizationCode(from: URL(string: "x:/oauth2redirect?code=abc&state=other")!, state: "st"))
    XCTAssertThrowsError(try GoogleLink.authorizationCode(from: URL(string: "x:/oauth2redirect?error=access_denied&state=st")!, state: "st")) { error in
      XCTAssertEqual((error as? GoogleLinkError)?.message, "Google sign-in was canceled.")
    }
  }

  func testLinkingTradesTheCodeThenAttachesTheCredentialToTheSignedInAccount() async throws {
    final class Sent: HTTPTransport, @unchecked Sendable {
      var requests: [URLRequest] = []
      func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let body = request.url?.host == "oauth2.googleapis.com" ? #"{"id_token":"g-id"}"# : #"{"idToken":"fresh"}"#
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
      }
    }
    let transport = Sent()
    try await GoogleLink.link(
      iosClientID: client, apiKey: "KEY", emulatorHost: nil, loginHint: nil, transport: transport,
      firebaseIDToken: { "fb-token" },
      authenticate: { url, scheme in
        XCTAssertEqual(scheme, "com.googleusercontent.apps.1234-abc")
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
        return URL(string: "com.googleusercontent.apps.1234-abc:/oauth2redirect?code=the-code&state=\(state)")!
      })
    XCTAssertEqual(transport.requests.count, 2)
    let exchange = String(data: transport.requests[0].httpBody ?? Data(), encoding: .utf8) ?? ""
    XCTAssertTrue(exchange.contains("code=the-code"))
    XCTAssertTrue(exchange.contains("grant_type=authorization_code"))
    XCTAssertFalse(exchange.contains("client_secret"))
    XCTAssertEqual(transport.requests[1].url?.absoluteString, "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=KEY")
    let link = JSONValue.decode(transport.requests[1].httpBody ?? Data())
    XCTAssertEqual(link?["idToken"], "fb-token")
    XCTAssertEqual(link?["postBody"], "id_token=g-id&providerId=google.com")
    XCTAssertEqual(link?["requestUri"], "http://localhost")
  }

  func testAnAlreadyLinkedGoogleAccountSaysSo() async {
    struct Refusing: HTTPTransport {
      func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let isToken = request.url?.host == "oauth2.googleapis.com"
        let body = isToken ? #"{"id_token":"g"}"# : #"{"error":{"message":"FEDERATED_USER_ID_ALREADY_LINKED"}}"#
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: isToken ? 200 : 400, httpVersion: nil, headerFields: nil)!)
      }
    }
    do {
      try await GoogleLink.link(
        iosClientID: client, apiKey: "KEY", emulatorHost: nil, loginHint: nil, transport: Refusing(), firebaseIDToken: { "t" },
        authenticate: { url, _ in
          let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
          return URL(string: "x:/r?code=c&state=\(state)")!
        })
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? GoogleLinkError)?.message, "That Google account is already linked to an Aglyn account.")
    }
  }
}
