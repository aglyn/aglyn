// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynEmailPlugin

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func number(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }

private func rateMatches(_ got: SendRate?, _ want: Any?, _ label: String) {
  guard let want = want as? [String: Any] else {
    XCTAssertNil(got, label)
    return
  }
  XCTAssertEqual(got?.value ?? -1, number(want["value"]) ?? -2, accuracy: 1e-9, label)
  XCTAssertEqual(got?.denominatorLabel, want["denominatorLabel"] as? String, label)
}

final class EmailTests: XCTestCase {
  func testSendDisplayIsTheConsoles() throws {
    for (index, item) in try functionCases("campaignSendDisplay").enumerated() {
      let got = campaignSendDisplay(item.args.first as? [String: Any])
      let want = item.result as! [String: Any]
      let progress = want["progress"] as! [String: Any]
      XCTAssertEqual(got.state, want["state"] as? String, "case \(index)")
      XCTAssertEqual(got.label, want["label"] as? String, "case \(index)")
      XCTAssertEqual(got.progress.state, progress["state"] as? String, "case \(index)")
      XCTAssertEqual(got.progress.label, progress["label"] as? String, "case \(index)")
      XCTAssertEqual(got.progress.reached, (progress["reached"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.progress.remaining, (progress["remaining"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.progress.audience, (progress["audience"] as? NSNumber)?.intValue, "case \(index)")
    }
  }

  func testReportIsTheConsoles() throws {
    for (index, item) in try functionCases("campaignReport").enumerated() {
      let got = campaignReport(item.args.first as? [String: Any])
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.sent, (want["sent"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.delivered, (want["delivered"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.caveats.map(\.id), (want["caveats"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }, "case \(index)")
      XCTAssertEqual(got.caveats.map(\.message), (want["caveats"] as? [[String: Any]] ?? []).compactMap { $0["message"] as? String }, "case \(index)")
      let rates = want["rates"] as? [String: Any] ?? [:]
      for key in ["delivery", "open", "click", "clickToOpen", "bounce", "complaint", "unsubscribe"] {
        rateMatches(got.rates[key] ?? nil, rates[key], "case \(index) \(key)")
      }
      XCTAssertEqual(
        got.populations.map(\.id), (want["populations"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }, "case \(index)")
    }
  }

  func testLinkReportIsTheConsoles() throws {
    for (index, item) in try functionCases("sendLinkReport").enumerated() {
      let got = sendLinkReport(item.args.first as? [String: Any])
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.rows.map(\.url), (want["rows"] as? [[String: Any]] ?? []).compactMap { $0["url"] as? String }, "case \(index)")
      XCTAssertEqual(got.attributedClicks, (want["attributedClicks"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.truncated, want["truncated"] as? Bool, "case \(index)")
    }
  }

  func testNewDesignIsTheConsoles() throws {
    for (index, item) in try functionCases("emailDesignStarterNodes").enumerated() {
      let ids = item.args[0] as! [String: Any]
      let got = emailDesignStarterNodes(sectionID: ids["sectionId"] as! String, textID: ids["textId"] as! String)
      XCTAssertEqual(NSDictionary(dictionary: got), NSDictionary(dictionary: item.result as! [String: Any]), "case \(index)")
    }
    for (index, item) in try functionCases("emailDesignDocuments").enumerated() {
      let input = item.args[0] as! [String: Any]
      let got = emailDesignDocuments(
        screenID: input["screenId"] as! String, versionID: input["versionId"] as! String, displayName: input["displayName"] as! String,
        nodes: input["nodes"] as! [String: Any])
      let want = item.result as! [String: Any]
      XCTAssertEqual(NSDictionary(dictionary: got.screen), NSDictionary(dictionary: want["screen"] as! [String: Any]), "case \(index)")
      XCTAssertEqual(NSDictionary(dictionary: got.version), NSDictionary(dictionary: want["version"] as! [String: Any]), "case \(index)")
    }
  }

  /// The plan's answer as the preview route sends it (AGL-4055): drawn as it comes, with the plan named after the notice.
  func testPlanLockReadsFromAnAnswerOrARefusal() throws {
    func body(_ json: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) }
    let free = try body(
      #"{"sendable":0,"planLock":{"kind":"not-on-plan","planLabel":"Pro","reason":"Campaign email is included from Pro.","notice":"Your plan does not include campaign email."}}"#
    )
    let lock = try XCTUnwrap(CampaignPlanLock.from(free))
    XCTAssertEqual(lock.kind, "not-on-plan")
    XCTAssertEqual(lock.reason, "Campaign email is included from Pro.")
    XCTAssertEqual(lock.message, "Your plan does not include campaign email. Included from Pro.")
    XCTAssertNil(CampaignPlanLock.from(try body(#"{"sendable":3,"planLock":null}"#)))
    XCTAssertNil(CampaignPlanLock.from(try body(#"{"sendable":3}"#)))
    XCTAssertNil(CampaignPlanLock.from(nil))
    let unnamed = try body(#"{"error":"x","planLock":{"kind":"allowance-spent","planLabel":null,"reason":"r","notice":"n"}}"#)
    XCTAssertEqual(CampaignPlanLock.from(unnamed)?.message, "n")
  }

  func testAudiencePickSplitsOnce() {
    XCTAssertEqual(AudiencePick(raw: "list:abc").kind, "list")
    XCTAssertEqual(AudiencePick(raw: "list:abc").listID, "abc")
    XCTAssertEqual(AudiencePick(raw: "segment:s1").segmentID, "s1")
    XCTAssertEqual(AudiencePick(raw: "leads").kind, "leads")
    XCTAssertEqual(AudiencePick.stored(["audience": "list", "listId": "L"])?.raw, "list:L")
    XCTAssertEqual(AudiencePick.stored(["audience": "members"])?.raw, "members")
  }

  func testAddressesSplitOnEverySeparator() {
    XCTAssertEqual(addressesIn("a@x.test, b@x.test;c@x.test\n d@x.test"), ["a@x.test", "b@x.test", "c@x.test", "d@x.test"])
  }

  func testACanceledEmailThatNeverWentOutSaysSoAndNamesWhatAnAbsentSenderMeans() {
    let canceled: [String: Any] = ["status": "canceled"]
    XCTAssertEqual(campaignSendDisplay(canceled).label, "Canceled before it was sent")
    XCTAssertEqual(sentAsMissing(canceled), "Not sent")
    XCTAssertEqual(deliveryPlaceholder(canceled), "This email was not sent to anybody, so there is nothing to report.")
    XCTAssertNil(emailSentAs(canceled))
    XCTAssertEqual(sentAsMissing(["status": "scheduled"]), "Not sent yet")
    let old: [String: Any] = ["status": "sent", "stats": ["sent": 12]]
    XCTAssertEqual(sentAsMissing(old), "Not recorded")
    XCTAssertNil(deliveryPlaceholder(old))
    var stamped = old
    stamped["sentAs"] = ["from": " news@bakery.test ", "fromName": ""]
    XCTAssertEqual(emailSentAs(stamped), SentAs(from: "news@bakery.test", fromName: nil, replyTo: nil))
    let partly: [String: Any] = ["status": "canceled", "stats": ["sent": 10], "resume": ["remaining": 30]]
    XCTAssertEqual(campaignSendDisplay(partly).label, "Reached 10 — canceled with 30 not addressed")
    XCTAssertNil(deliveryPlaceholder(partly))
  }
}
