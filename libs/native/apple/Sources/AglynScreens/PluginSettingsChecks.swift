// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// A plugin settings form's pre-save check, as the console's settings card runs its schema's `validate` before a save.
/// A form's `refuse` entry names one (`{ "check": "weglot" }`, written by the generator from the schema); its answer is
/// said beside Save, which it holds back. The console's answers to every rule are recorded in
/// `libs/native/contracts/plugin-settings-check-cases.generated.json`, and the tests replay them.
public enum PluginSettingsChecks {
  /// The refusal for `check` over the values the form will save, or nil when it may be saved (or the check is unknown).
  public static func refusal(_ check: String, _ values: [String: JSONValue]) -> String? {
    switch check {
    case "weglot": weglot(values)
    default: nil
    }
  }

  /// The values a form's check is asked over. On a site (`site: true`) they are the ones it will RUN with: each field
  /// its own override where it has one (`ov_<field>` on), else the workspace's (`data.org`), else the default
  /// (`const.defaults`), as the console's site card checks them.
  public static func values(in filled: JSONValue, site: Bool) -> [String: JSONValue] {
    guard case .object(let form)? = filled["form"] else { return [:] }
    guard site else { return form }
    let org: [String: JSONValue] = {
      if case .object(let fields)? = ScreenValues.lookup("data.org", in: filled) { return fields }
      return [:]
    }()
    let defaults: [String: JSONValue] = {
      if case .object(let fields)? = ScreenValues.lookup("const.defaults", in: filled) { return fields }
      return [:]
    }()
    var out: [String: JSONValue] = [:]
    let keys = Set(form.keys.filter { !$0.hasPrefix("ov_") }).union(org.keys).union(defaults.keys)
    for key in keys {
      if form["ov_\(key)"] == .bool(true) {
        out[key] = form[key] ?? .null
      } else {
        out[key] = org[key] ?? defaults[key] ?? .null
      }
    }
    return out
  }

  // MARK: Weglot (libs/plugins/weglot/src/lib/model/weglot-settings.ts)

  static let weglotKeyPattern = "^wg_[A-Za-z0-9]{16,64}$"
  static let weglotLanguagePattern = "^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$"
  static let weglotMaxTargetLanguages = 30

  /// One language code, normalized, or nil (`parseWeglotLanguage`).
  static func weglotLanguage(_ raw: JSONValue?) -> String? {
    guard case .string(let text)? = raw else { return nil }
    let code = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return code.range(of: weglotLanguagePattern, options: .regularExpression) != nil ? code : nil
  }

  /// The target list as typed, commas, semicolons or spaces between codes (`parseWeglotLanguageList`): the codes in the
  /// order typed without repeats, and the entries it could not read.
  static func weglotLanguageList(_ raw: JSONValue?) -> (codes: [String], invalid: [String]) {
    var codes: [String] = []
    var invalid: [String] = []
    guard case .string(let text)? = raw else { return (codes, invalid) }
    let separators = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;"))
    for entry in text.components(separatedBy: separators) where !entry.isEmpty {
      if let code = weglotLanguage(.string(entry)) {
        if !codes.contains(code) { codes.append(code) }
      } else {
        invalid.append(entry)
      }
    }
    return (codes, invalid)
  }

  /// The Weglot card's pre-save check (`validateWeglotConfig`): switched off, anything may be saved.
  static func weglot(_ values: [String: JSONValue]) -> String? {
    guard values["enabled"] == .bool(true) else { return nil }
    let apiKey: String = {
      if case .string(let text)? = values["apiKey"] { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
      return ""
    }()
    if apiKey.isEmpty { return "Add your Weglot API key before turning translation on." }
    if apiKey.range(of: weglotKeyPattern, options: .regularExpression) == nil {
      return "That is not a Weglot API key. Copy the key that starts with wg_ from your Weglot project settings."
    }
    guard let source = weglotLanguage(values["sourceLanguage"]) else {
      return "Enter the language your site is written in as a code, such as en."
    }
    let (codes, invalid) = weglotLanguageList(values["targetLanguages"])
    if !invalid.isEmpty {
      return "Not a language code: \(invalid.joined(separator: ", ")). Use codes such as fr or pt-br."
    }
    if codes.isEmpty { return "Add at least one language to translate into." }
    if codes.contains(source) {
      return "The languages to translate into cannot include the language your site is written in."
    }
    if codes.count > weglotMaxTargetLanguages {
      return "Weglot translates into at most \(weglotMaxTargetLanguages) languages here."
    }
    return nil
  }
}
