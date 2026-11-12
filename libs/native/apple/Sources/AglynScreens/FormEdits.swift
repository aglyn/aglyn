import AglynContracts
import AglynCore
import Foundation

/// A FORM SAVE IS NEVER PRESSED ON THE CACHE'S COPY, AND NEVER REFUSED FOR IT (AGL-4047), as the console's
/// `useSeedEdits` and `isSeedChecking` keep it.
///
/// Two halves, and a form needs both:
/// 1. HOLD SAVE while a load the form is seeded from is only the device cache's answer (`checking.<key>`), with the
///    reason beside it, so the press comes once the server has answered.
/// 2. KEEP THE EDITS AS EDITS, laid over whatever the data says now. A field the person changed keeps their value
///    through any fresher answer; every other field follows it, so a held Save never writes the cache's copy of them.
enum FormEdits {
  /// What a held Save says beside it (`seedCheckingText`), for the form's `checking` subject ("profile").
  static func checkingText(_ subject: String?) -> String {
    seedCheckingText(subject ?? "settings")
  }

  /// What a Save pressed while held says when the server's copy never came (`seedUnconfirmedText`).
  static func unconfirmedText(_ subject: String?) -> String {
    seedUnconfirmedText(subject ?? "settings")
  }

  /// The loads still `checking` that this form reads: its `object`, or any field's `initial`.
  static func heldBy(object: String?, initials: [String], checking: JSONValue?) -> [String] {
    guard case .object(let held)? = checking else { return [] }
    let texts = [object ?? ""] + initials
    return held.keys.sorted().filter { key in held[key] == .bool(true) && texts.contains { mentions($0, key) } }
  }

  /// Whether `text` reads `data.<key>` itself, not a longer key that starts with it (`data.site` for `si`).
  static func mentions(_ text: String, _ key: String) -> Bool {
    var rest = text[...]
    while let found = rest.range(of: "data.\(key)") {
      let after = found.upperBound
      if after == rest.endIndex || !(rest[after].isLetter || rest[after].isNumber || rest[after] == "_") { return true }
      rest = rest[after...]
    }
    return false
  }

  /// The edits left once the form's seed has moved: an edit the seed now shows has landed and follows the seed again,
  /// and so does one the last Save wrote (a phone number the write formatted). Anything typed since is kept.
  static func settled(
    _ edits: [String: FieldValue], pressed: [String: FieldValue]?, seed: [String: FieldValue]
  ) -> [String: FieldValue] {
    edits.filter { key, value in value != seed[key] && value != pressed?[key] }
  }
}
