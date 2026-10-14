// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The register's own rules (commerce-pos-ops.ts), ported once and replayed
 * against the console's answers in function-cases.generated.json. The Kotlin
 * kit's `PosOpsRules.kt`.
 */

/// Why a PIN cannot be used, or nil when it can: 4 to 6 digits, and not one a
/// stranger tries first, every digit the same or a straight run (`posPinProblem`).
public func posPinProblem(_ pin: String?) -> String? {
  let value = pin ?? ""
  guard value.range(of: "^[0-9]{4,6}$", options: .regularExpression) != nil else { return "A PIN is 4 to 6 digits." }
  if Set(value).count == 1 { return "Pick a PIN that is not one digit repeated." }
  let digits = value.compactMap { $0.wholeNumberValue }
  let step = digits[1] - digits[0]
  if (step == 1 || step == -1),
    digits.indices.allSatisfy({ $0 == 0 || digits[$0] - digits[$0 - 1] == step })
  {
    return "Pick a PIN that is not a straight run like 1234."
  }
  return nil
}

private func jsRounded(_ value: Double) -> Int { value.isFinite ? Int((value + 0.5).rounded(.down)) : 0 }

/// Counted minus expected: positive is over, negative is short (`posCashVarianceCents`).
public func posCashVarianceCents(counted: Double, expected: Double) -> Int {
  jsRounded(counted) - jsRounded(expected)
}
