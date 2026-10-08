// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynEventsCalendarPlugin

final class EventsTests: XCTestCase {
  func testTheListDropsDeletedAndSaysWhenTheWindowIsFull() {
    let docs = (0..<201).map { FirestoreDocument(id: "e\($0)", data: ["title": "E\($0)", "startsAtMs": NSNumber(value: $0)]) }
      + [FirestoreDocument(id: "gone", data: ["title": "x", "deletedAt": Date()])]
    let visible = visibleEvents(docs)
    XCTAssertTrue(visible.full)
    XCTAssertEqual(visible.rows.count, 200)
    XCTAssertEqual(visible.rows.first?.id, "e199")
  }

  func testTheMergeDeletesWhatTheRuleRemoves() {
    var draft = EventDraft()
    draft.title = " Launch "
    draft.startsAt = Date(timeIntervalSince1970: 1_800_000_000)
    draft.coverImageAlt = "orphan"
    let merge = eventMerge(draft)!
    XCTAssertEqual(merge["title"] as? String, "Launch")
    XCTAssertEqual(merge["endsAtMs"] as? Int, 1_800_000_000_000 + 3_600_000)
    XCTAssertTrue(merge["coverImageAlt"] is FirestoreSentinel)
    XCTAssertNotNil(merge["createdAt"])
    XCTAssertNil(eventMerge(EventDraft()))
    XCTAssertEqual(newEventID().count, 20)
  }
}
