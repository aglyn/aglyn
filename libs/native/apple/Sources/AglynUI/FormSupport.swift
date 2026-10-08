// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// A field's helper line under it in a form: what the field is for, or —
/// in the error color — what is wrong with it (MUI's `helperText`).
public struct AglynHelperText: View {
  let text: String?
  let isError: Bool

  public init(_ text: String?, isError: Bool = false) {
    self.text = text
    self.isError = isError
  }

  public var body: some View {
    if let text, !text.isEmpty {
      Text(text)
        .font(AglynFont.caption)
        .foregroundStyle(isError ? AglynColor.error : .secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel(isError ? "Problem: \(text)" : text)
    }
  }
}

/// A labeled text field with its helper line, for a grouped form: the
/// label above when there is text, the placeholder inside, the helper below.
public struct AglynLabeledField: View {
  let label: String
  let placeholder: String?
  @Binding var text: String
  let helper: String?
  let isError: Bool
  let multiline: Bool

  public init(
    _ label: String, text: Binding<String>, placeholder: String? = nil, helper: String? = nil, isError: Bool = false,
    multiline: Bool = false
  ) {
    self.label = label
    self._text = text
    self.placeholder = placeholder
    self.helper = helper
    self.isError = isError
    self.multiline = multiline
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text(label).font(AglynFont.caption).foregroundStyle(isError ? AglynColor.error : .secondary)
      Group {
        if multiline {
          TextField(placeholder ?? label, text: $text, axis: .vertical).lineLimit(3...10)
        } else {
          TextField(placeholder ?? label, text: $text)
        }
      }
      .accessibilityLabel(label)
      AglynHelperText(helper, isError: isError)
    }
    .padding(.vertical, 2)
  }
}

/// A plan quota as the console's readout states it: `3/25 workflows on your
/// plan`, `∞` for an unlimited one, and `3 workflows · checking your plan…`
/// until the plan is known.
public struct AglynQuotaReadout: View {
  let ready: Bool
  let used: Int
  let limit: Double?
  let noun: String
  let plural: String

  /// `limit` nil or infinite is unlimited.
  public init(ready: Bool, used: Int, limit: Double?, noun: String, plural: String? = nil) {
    self.ready = ready
    self.used = used
    self.limit = limit
    self.noun = noun
    self.plural = plural ?? "\(noun)s"
  }

  public static func text(ready: Bool, used: Int, limit: Double?, noun: String, plural: String? = nil) -> String {
    let plural = plural ?? "\(noun)s"
    guard ready else { return "\(used) \(used == 1 ? noun : plural) · checking your plan…" }
    let cap = limit.flatMap { $0.isFinite ? String(Int($0)) : nil } ?? "∞"
    return "\(used)/\(cap) \(plural) on your plan"
  }

  public var body: some View {
    Text(Self.text(ready: ready, used: used, limit: limit, noun: noun, plural: plural))
      .font(AglynFont.caption)
      .foregroundStyle(.secondary)
  }
}

/// The system pasteboard, on iPhone, iPad and Mac.
public enum AglynPasteboard {
  @MainActor
  public static func copy(_ text: String) {
    #if os(iOS)
      UIPasteboard.general.string = text
    #elseif os(macOS)
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    #endif
  }
}

/// A transient message over the bottom of a screen (the console's snackbar):
/// it slides in, reads out to VoiceOver, and leaves on its own.
public struct AglynToast: Equatable {
  public let message: String
  public let tone: AglynTone
  public let id = UUID()

  public init(_ message: String, tone: AglynTone = .neutral) {
    self.message = message
    self.tone = tone
  }

  public static func == (a: AglynToast, b: AglynToast) -> Bool { a.id == b.id }
}

private struct AglynToastModifier: ViewModifier {
  @Binding var toast: AglynToast?

  func body(content: Content) -> some View {
    content.overlay(alignment: .bottom) {
      if let toast {
        AglynNotice(toast.message, tone: toast.tone) { self.toast = nil }
          .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
          .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
          .frame(maxWidth: 560)
          .padding(AglynSpace.two)
          .transition(.move(edge: .bottom).combined(with: .opacity))
          .task(id: toast.id) {
            #if os(iOS)
              UIAccessibility.post(notification: .announcement, argument: toast.message)
            #endif
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            if self.toast?.id == toast.id {
              withAnimation { self.toast = nil }
            }
          }
          .accessibilityIdentifier("aglyn-toast")
      }
    }
    .animation(.snappy, value: toast)
  }
}

extension View {
  /// Shows `toast` over the bottom of the view until it times out or is dismissed.
  public func aglynToast(_ toast: Binding<AglynToast?>) -> some View {
    modifier(AglynToastModifier(toast: toast))
  }
}
