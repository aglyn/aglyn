// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynAiPlugin

/// Rating an Assist answer: the console's `assist-panel.component.tsx` (`sendFeedback`, the thumbs) and `/api/assist/feedback`.
final class AssistAnswerRatingTests: XCTestCase {
  private func event(_ json: String) -> JSONValue { JSONValue.decode(Data(json.utf8)) ?? .null }

  func testTheAnswerKeepsTheExchangeItWasRecordedUnder() {
    let done = AssistTurn(role: "assistant", text: "Open Settings.").done(
      event(
        #"{"type":"done","exchangeId":"ex-1","docs":[{"title":"Invite your team","url":"https://docs.example/team"}],"proposal":{"label":"Open Team","href":"/acme/team"}}"#
      ))
    XCTAssertEqual(done.exchangeID, "ex-1")
    XCTAssertEqual(done.docs, [AssistTurn.Pair(label: "Invite your team", href: "https://docs.example/team")])
    XCTAssertEqual(done.proposal, AssistTurn.Pair(label: "Open Team", href: "/acme/team"))
    XCTAssertNil(done.feedback)
    // No exchange (a route that recorded nothing), or an empty one: no thumbs, as on the console.
    XCTAssertNil(AssistTurn(role: "assistant", text: "").done(event(#"{"type":"done","exchangeId":null}"#)).exchangeID)
    XCTAssertNil(AssistTurn(role: "assistant", text: "").done(event(#"{"type":"done","exchangeId":""}"#)).exchangeID)
  }

  func testATapPostsTheConsolesBody() async {
    var sent: JSONValue?
    let said = await sendAssistFeedback(.down, exchangeID: "ex-1", orgID: "org-1") { sent = $0 }
    XCTAssertEqual(sent, event(#"{"orgId":"org-1","exchangeId":"ex-1","feedback":"down"}"#))
    XCTAssertNil(said)
    XCTAssertEqual(assistFeedbackBody(orgID: "org-1", exchangeID: "ex-1", feedback: .up)["feedback"]?.stringValue, "up")
    XCTAssertEqual(AssistFeedback.up.label, "Helpful answer")
    XCTAssertEqual(AssistFeedback.down.label, "Unhelpful answer")
  }

  func testARatedAnswerSaysSo() {
    var rated = AssistTurn(role: "assistant", text: "Open Settings.")
    rated.exchangeID = "ex-1"
    rated.feedback = .up
    XCTAssertEqual(rated.feedback, .up)
    XCTAssertEqual(assistAlreadyRated, "Thanks — you already rated this answer")
  }

  func testARefusedPostSaysNothingAndAnUnsentOneSaysItCouldNotBeRecorded() async {
    // The route answered (an unknown exchange, a locked workspace): the console reads no reply, and the rating stands.
    let unknown = await sendAssistFeedback(.up, exchangeID: "ex-1", orgID: "org-1") { _ in
      throw ConsoleAPIError(status: 404, message: "Unknown exchange")
    }
    XCTAssertNil(unknown)
    let refused = await sendAssistFeedback(.up, exchangeID: "ex-1", orgID: "org-1") { _ in
      throw ConsoleAPIError(status: 403, message: "Not a member")
    }
    XCTAssertNil(refused)
    // It never reached the route: the console's "Feedback could not be recorded".
    let unreachable = await sendAssistFeedback(.up, exchangeID: "ex-1", orgID: "org-1") { _ in
      throw ConsoleAPIError(status: 0, message: "Unreachable")
    }
    XCTAssertEqual(unreachable, "Feedback could not be recorded")
    let offline = await sendAssistFeedback(.up, exchangeID: "ex-1", orgID: "org-1") { _ in throw URLError(.notConnectedToInternet) }
    XCTAssertEqual(offline, assistFeedbackFailed)
  }
}
