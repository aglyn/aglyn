// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// A filled field keeps its name above it, as the console's floating MUI label and Figma's form fields do; an empty
/// field whose prompt is its name says it once, inside it.
final class FieldLabelTests: XCTestCase {
  func testAFilledFieldKeepsItsName() {
    XCTAssertTrue(AglynFieldLabel.showsAbove(value: "hello@example.com", prompt: nil, label: "Contact email"))
    XCTAssertTrue(AglynFieldLabel.showsAbove(value: "2", prompt: "Contact email", label: "Guests"))
  }

  func testAnEmptyFieldSaysItsNameOnce() {
    XCTAssertFalse(AglynFieldLabel.showsAbove(value: "", prompt: nil, label: "Contact email"))
    XCTAssertFalse(AglynFieldLabel.showsAbove(value: "", prompt: "Contact email", label: "Contact email"))
    XCTAssertFalse(AglynFieldLabel.showsAbove(value: "", prompt: "  ", label: "Contact email"))
  }

  func testAnEmptyFieldWithItsOwnPromptKeepsItsNameAbove() {
    XCTAssertTrue(AglynFieldLabel.showsAbove(value: "", prompt: "Mobile dog grooming", label: "One-line pitch"))
  }

  func testAFieldWithNoNameShowsNone() {
    XCTAssertFalse(AglynFieldLabel.showsAbove(value: "x", prompt: nil, label: " "))
  }
}
