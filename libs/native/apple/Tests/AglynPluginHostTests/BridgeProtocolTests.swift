// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynWebView

final class BridgeProtocolTests: XCTestCase {
  private let trusted = ["https://app.aglyn.com"]

  private func parse(_ data: String, from url: String? = "https://app.aglyn.com/acme", nonce: String = "n0nce")
    -> BridgeProtocol.Parsed
  {
    BridgeProtocol.parse(data: data, sourceURL: url, trustedOrigins: trusted, nonce: nonce, methods: ["openNative", "close"])
  }

  func testOrigins() {
    XCTAssertEqual(BridgeProtocol.originOf("HTTPS://App.Aglyn.com:443/x"), "https://app.aglyn.com")
    XCTAssertEqual(BridgeProtocol.originOf("http://localhost:4200/x"), "http://localhost:4200")
    XCTAssertNil(BridgeProtocol.originOf("https://evil@app.aglyn.com"))
    XCTAssertNil(BridgeProtocol.originOf("javascript:alert(1)"))
    XCTAssertFalse(BridgeProtocol.isTrusted("https://app.aglyn.com.evil.example", trustedOrigins: trusted))
  }

  func testAcceptsAWellFormedCall() {
    XCTAssertEqual(
      parse(#"{"aglynBridge":1,"nonce":"n0nce","id":"c1","method":"openNative","params":{"path":"/x"}}"#),
      .request(.init(id: "c1", method: "openNative", params: ["path": "/x"])))
  }

  func testRefusesEverythingElse() {
    XCTAssertEqual(parse("{}", from: "https://evil.example"), .rejected(.untrustedOrigin, id: nil))
    XCTAssertEqual(parse("not json"), .rejected(.malformed, id: nil))
    XCTAssertEqual(parse(#"{"aglynBridge":1,"nonce":"x","id":"c1","method":"close"}"#), .rejected(.badNonce, id: nil))
    XCTAssertEqual(parse(#"{"aglynBridge":1,"nonce":"n0nce","id":"c1","method":"deleteAll"}"#), .rejected(.unknownMethod, id: "c1"))
    XCTAssertEqual(
      parse(#"{"aglynBridge":1,"nonce":"n0nce","id":"c1","method":"close","params":[1]}"#), .rejected(.malformed, id: "c1"))
    XCTAssertEqual(parse(String(repeating: " ", count: 17 * 1024)), .rejected(.malformed, id: nil))
  }

  func testTheReplyCannotBreakOutOfItsCall() {
    let script = BridgeProtocol.replyScript(globalName: "AglynApp", id: "c1", result: .success(.string("\u{2028})")))
    XCTAssertTrue(script.contains("\\u2028"))
    XCTAssertFalse(script.contains("\u{2028}"))
  }
}
