// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

// The settings-card kit (the Kotlin kit's `FormCard`, `CountedTextField` and
// `ColorField`): a titled group of fields that saves as one, the way the
// console's Setup cards do.

/// What a text field is for, so the keyboard on a phone fits it.
public enum AglynKeyboard: Sendable {
  case text, url, email, phone, number
}

/// A titled card of fields in a grouped form: a one-line description, the
/// fields, why the last save failed or that it worked, and Discard and Save.
/// Save and Discard stay disabled until a field differs from what is stored.
public struct AglynFormCard<Content: View>: View {
  let title: String
  let message: String?
  let dirty: Bool
  let canSave: Bool
  let busy: Bool
  let error: String?
  let notice: String?
  let onDiscard: () -> Void
  let onSave: () -> Void
  let content: Content

  public init(
    _ title: String, message: String? = nil, dirty: Bool, canSave: Bool = true, busy: Bool = false,
    error: String? = nil, notice: String? = nil, onDiscard: @escaping () -> Void, onSave: @escaping () -> Void,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.message = message
    self.dirty = dirty
    self.canSave = canSave
    self.busy = busy
    self.error = error
    self.notice = notice
    self.onDiscard = onDiscard
    self.onSave = onSave
    self.content = content()
  }

  public var body: some View {
    Section {
      if let message { Text(message).font(AglynFont.subheadline).foregroundStyle(.secondary) }
      content
      if let error { AglynNotice(error, tone: .error) }
      if let notice, !dirty, error == nil { AglynNotice(notice, tone: .success) }
      HStack {
        Spacer()
        Button("Discard", action: onDiscard)
          .disabled(!dirty || busy)
          .accessibilityIdentifier("card-discard-\(title)")
        Button(action: onSave) {
          if busy { ProgressView().controlSize(.small) } else { Text("Save") }
        }
        .buttonStyle(.borderedProminent)
        .disabled(!dirty || !canSave || busy)
        .accessibilityIdentifier("card-save-\(title)")
      }
      .buttonStyle(.borderless)
    } header: {
      Text(title).accessibilityAddTraits(.isHeader)
    }
  }
}

/// A labeled text field with a character count and a helper or error line.
public struct AglynCountedField: View {
  let label: String
  @Binding var text: String
  let max: Int?
  let required: Bool
  let multiline: Bool
  let error: String?
  let supporting: String?
  let placeholder: String?
  let keyboard: AglynKeyboard
  let enabled: Bool

  public init(
    _ label: String, text: Binding<String>, max: Int? = nil, required: Bool = false, multiline: Bool = false,
    error: String? = nil, supporting: String? = nil, placeholder: String? = nil, keyboard: AglynKeyboard = .text,
    enabled: Bool = true
  ) {
    self.label = label
    self._text = text
    self.max = max
    self.required = required
    self.multiline = multiline
    self.error = error
    self.supporting = supporting
    self.placeholder = placeholder
    self.keyboard = keyboard
    self.enabled = enabled
  }

  private var binding: Binding<String> {
    Binding(get: { text }, set: { text = max.map($0.capped) ?? $0 })
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        Text(required ? "\(label) (required)" : label)
          .font(AglynFont.caption).foregroundStyle(error == nil ? Color.secondary : AglynColor.error)
        Spacer()
        if let max { AglynCharacterCount(text.count, of: max) }
      }
      Group {
        if multiline {
          TextField(placeholder ?? label, text: binding, axis: .vertical).lineLimit(2...8)
        } else {
          TextField(placeholder ?? label, text: binding)
        }
      }
      .disabled(!enabled)
      .autocorrectionDisabled(keyboard != .text)
      #if os(iOS)
        .textInputAutocapitalization(keyboard == .text ? .sentences : .never)
        .keyboardType(keyboard.uiKeyboard)
      #endif
      .accessibilityLabel(label)
      if let error {
        AglynHelperText(error, isError: true)
      } else {
        AglynHelperText(supporting)
      }
    }
    .padding(.vertical, 2)
  }
}

#if os(iOS)
  extension AglynKeyboard {
    var uiKeyboard: UIKeyboardType {
      switch self {
      case .text: .default
      case .url: .URL
      case .email: .emailAddress
      case .phone: .phonePad
      case .number: .decimalPad
      }
    }
  }
#endif

/// A color typed as hex with its swatch and the system color picker; the
/// field says when the words are not a color.
public struct AglynColorField: View {
  let label: String
  @Binding var hex: String
  let enabled: Bool

  public init(_ label: String, hex: Binding<String>, enabled: Bool = true) {
    self.label = label
    self._hex = hex
    self.enabled = enabled
  }

  public var body: some View {
    let parsed = AglynCSSColor.parse(hex)
    let invalid = !hex.trimmingCharacters(in: .whitespaces).isEmpty && !isHexColor(hex)
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack(spacing: AglynSpace.oneAndHalf) {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(parsed.map { Color(.sRGB, red: $0.0, green: $0.1, blue: $0.2, opacity: $0.3) } ?? .clear)
          .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(AglynColor.divider))
          .frame(width: 28, height: 28)
          .accessibilityLabel(parsed != nil ? "Swatch of \(hex)" : "No color")
        VStack(alignment: .leading, spacing: 2) {
          Text(label).font(AglynFont.caption).foregroundStyle(invalid ? AglynColor.error : Color.secondary)
          TextField("#1A73E8", text: Binding(get: { hex }, set: { hex = String($0.trimmingCharacters(in: .whitespaces).prefix(9)) }))
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
            .accessibilityLabel(label)
        }
        ColorPicker(
          "Pick \(label)",
          selection: Binding(
            get: { parsed.map { Color(.sRGB, red: $0.0, green: $0.1, blue: $0.2, opacity: $0.3) } ?? .clear },
            set: { if let picked = hexString($0) { hex = picked } }),
          supportsOpacity: false
        )
        .labelsHidden()
      }
      if invalid { AglynHelperText("Use a hex color such as #1A73E8", isError: true) }
    }
    .disabled(!enabled)
  }
}

/// Whether `text` is a hex color (`#rgb`, `#rrggbb` or `#rrggbbaa`, the `#` optional).
public func isHexColor(_ text: String) -> Bool {
  let digits = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "", options: .anchored)
  return [3, 6, 8].contains(digits.count) && digits.allSatisfy(\.isHexDigit)
}

/// A picked color as `#rrggbb`.
@MainActor
func hexString(_ color: Color) -> String? {
  #if os(iOS)
    var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    guard UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a) else { return nil }
  #else
    guard let rgb = NSColor(color).usingColorSpace(.sRGB) else { return nil }
    let (r, g, b) = (rgb.redComponent, rgb.greenComponent, rgb.blueComponent)
  #endif
  return String(format: "#%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
}

/// A switch with a supporting line.
public struct AglynSwitchRow: View {
  let title: String
  let isOn: Bool
  let supporting: String?
  let enabled: Bool
  let onChange: (Bool) -> Void

  public init(_ title: String, isOn: Bool, supporting: String? = nil, enabled: Bool = true, onChange: @escaping (Bool) -> Void) {
    self.title = title
    self.isOn = isOn
    self.supporting = supporting
    self.enabled = enabled
    self.onChange = onChange
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Toggle(title, isOn: Binding(get: { isOn }, set: onChange)).disabled(!enabled)
      AglynHelperText(supporting)
    }
  }
}
