// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// The frame every signed-out screen shares: the logo, a heading and its line, the screen's content, and a footer
/// (the console's `AuthFormComponent`).
struct AuthCard<Content: View, Footer: View>: View {
  @Environment(AppModel.self) private var model
  let title: String
  let subtitle: String?
  @ViewBuilder let content: () -> Content
  @ViewBuilder let footer: () -> Footer

  init(
    _ title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content,
    @ViewBuilder footer: @escaping () -> Footer = { EmptyView() }
  ) {
    self.title = title
    self.subtitle = subtitle
    self.content = content
    self.footer = footer
  }

  /// The lockup's height; it keeps that much clear space around it (the logo kit's rule).
  private static var logoHeight: CGFloat { 32 }

  var body: some View {
    GeometryReader { proxy in
      ScrollView {
        // One centered column, 400 points at most (spec 10), centered in the window while it fits.
        VStack(alignment: .leading, spacing: AglynSpace.three) {
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            AglynArtwork.logo
              .resizable()
              .scaledToFit()
              .frame(height: Self.logoHeight)
              .padding(.bottom, Self.logoHeight - AglynSpace.one)
              .accessibilityLabel(model.appName)
            Text(title).font(AglynFont.title).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(AglynFont.body).foregroundStyle(.secondary) }
          }
          content()
          footer()
        }
        .padding(Self.logoHeight)
        .frame(maxWidth: 400 + Self.logoHeight * 2)
        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .background(AglynColor.page.ignoresSafeArea())
  }
}

/// A form error or notice line under the fields.
struct AuthMessage: View {
  let text: String
  var tone: AglynTone = .error

  var body: some View {
    if tone == .error {
      Label(text, systemImage: "exclamationmark.circle")
        .foregroundStyle(AglynColor.error)
        .font(AglynFont.subheadline)
        .accessibilityIdentifier("auth-error")
    } else {
      AglynNotice(text, tone: tone)
    }
  }
}

/// A full-width primary action that shows progress while busy.
struct AuthPrimaryButton: View {
  let title: String
  let busy: Bool
  var enabled = true
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Group {
        if busy { ProgressView().controlSize(.small) } else { Text(title).fontWeight(.semibold) }
      }
      .frame(maxWidth: .infinity, minHeight: AglynPrimaryButtonMetrics.height)
      .contentShape(Rectangle())
    }
    .buttonStyle(.borderedProminent)
    .buttonBorderShape(.roundedRectangle(radius: AglynRadius.tile))
    .disabled(busy || !enabled)
    .keyboardShortcut(.defaultAction)
  }
}

/// A labelled text field with the first rule its value breaks under it, once the person has tried to submit.
struct AuthField: View {
  let label: String
  @Binding var text: String
  var secure = false
  var content: AuthFieldContent = .plain
  var message: String?
  var supporting: String?
  var identifier: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Group {
        if secure {
          SecureField(label, text: $text)
        } else {
          TextField(label, text: $text)
        }
      }
      .textFieldStyle(.aglyn)
      .autocorrectionDisabled(content != .plain)
      #if os(iOS)
        .textInputAutocapitalization(content == .name || content == .organization ? .words : .never)
        .keyboardType(content == .email ? .emailAddress : .default)
      #endif
      .textContentType(content.textContentType)
      .accessibilityIdentifier(identifier)
      if let message {
        Text(message).font(AglynFont.caption).foregroundStyle(AglynColor.error)
      } else if let supporting {
        Text(supporting).font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }
}

enum AuthFieldContent: Equatable {
  case plain, name, familyName, organization, email, newPassword, password

  #if os(iOS)
    var textContentType: UITextContentType? {
      switch self {
      case .plain: return nil
      case .name: return .givenName
      case .familyName: return .familyName
      case .organization: return .organizationName
      case .email: return .username
      case .newPassword: return .newPassword
      case .password: return .password
      }
    }
  #else
    var textContentType: NSTextContentType? {
      switch self {
      case .email: return .username
      case .newPassword: return .newPassword
      case .password: return .password
      default: return nil
      }
    }
  #endif
}

/// A checkbox row (the console's `AuthCheckboxRow`): a toggle with its sentence beside it.
struct AuthCheckRow<Label: View>: View {
  @Binding var isOn: Bool
  let accessibilityLabel: String
  var identifier: String
  @ViewBuilder let label: () -> Label

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Button {
        isOn.toggle()
      } label: {
        Image(systemName: isOn ? "checkmark.square.fill" : "square")
          .font(.title3)
          .foregroundStyle(isOn ? AglynColor.tint : .secondary)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(accessibilityLabel)
      .accessibilityValue(isOn ? "Checked" : "Not checked")
      .accessibilityAddTraits(.isButton)
      .accessibilityIdentifier(identifier)
      label().font(AglynFont.subheadline)
    }
  }
}

/// The Terms of Service and Privacy Policy, as links to the published documents.
struct LegalLinks: View {
  @Environment(AppModel.self) private var model
  let lead: String

  var body: some View {
    let origin = model.config?.legalOrigin ?? AglynConfig.defaultLegalOrigin
    Text(
      .init(
        "\(lead) [Terms of Service](\(origin)/legal/terms) and [Privacy Policy](\(origin)/legal/privacy)."))
  }
}
