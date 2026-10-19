// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// The one layout every signed-out screen shares (Figma "Sign in & launch", AGL-3934): the logo-kit lockup top-left over
/// the Facets ground (which RootView draws behind every auth screen, so it holds still as screens change), then the
/// raised card with the heading, an optional link at its top right, the screen's content, and the footer centered under
/// the card. On a phone the card spans the screen less 16-point margins under the lockup; on iPad and the Mac it is 440
/// (420) wide and centered in the window.
struct AuthCard<Content: View, Footer: View, Accessory: View>: View {
  @Environment(AppModel.self) private var model
  @Environment(\.authReveal) private var reveal
  let title: String
  let subtitle: String?
  let systemImage: String?
  @ViewBuilder let accessory: () -> Accessory
  @ViewBuilder let content: () -> Content
  @ViewBuilder let footer: () -> Footer

  init(
    _ title: String, subtitle: String? = nil, systemImage: String? = nil,
    @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() },
    @ViewBuilder content: @escaping () -> Content,
    @ViewBuilder footer: @escaping () -> Footer = { EmptyView() }
  ) {
    self.title = title
    self.subtitle = subtitle
    self.systemImage = systemImage
    self.accessory = accessory
    self.content = content
    self.footer = footer
  }

  private typealias M = AglynAuthTokens.Metrics
  private typealias C = AglynAuthTokens.Colors

  var body: some View {
    GeometryReader { proxy in
      let compact = AglynAuthLayout.isCompact(width: proxy.size.width)
      ScrollView {
        VStack(spacing: 0) {
          AglynArtwork.logo
            .resizable()
            .scaledToFit()
            .frame(height: M.lockupHeight)
            .fixedSize()
            .accessibilityLabel(model.appName)
            // Hidden under the launch intro's own lockup until the destination is revealed, then in its place.
            .opacity(reveal.opacity)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, AglynAuthLayout.lockupLeading(compact: compact))
            .padding(.top, AglynAuthLayout.lockupTop(compact: compact))
          if compact {
            Spacer().frame(height: M.cardGapBelowLockup)
          } else {
            Spacer(minLength: M.lockupClearSpace)
          }
          VStack(spacing: 14) {
            card(compact: compact)
            footer()
              .font(AglynAuthFont.small)
              .foregroundStyle(C.textSecondary.color)
              .multilineTextAlignment(.center)
          }
          .frame(maxWidth: compact ? .infinity : AglynAuthLayout.cardWidth)
          .padding(.horizontal, compact ? M.cardMarginCompact : M.cardPaddingRegular)
          .offset(y: reveal.offset)
          .opacity(reveal.opacity)
          Spacer(minLength: M.lockupClearSpace)
        }
        .frame(minHeight: proxy.size.height)
      }
      .scrollBounceBehavior(.basedOnSize)
      .scrollDismissesKeyboard(.interactively)
      // The card scrolls away under the status bar's edge rather than behind the clock.
      .clipped()
    }
  }

  private func card(compact: Bool) -> some View {
    let shape = RoundedRectangle(cornerRadius: AglynAuthDensity.cardRadius, style: .continuous)
    return VStack(alignment: .leading, spacing: compact ? M.cardSpacingCompact : M.cardSpacingRegular) {
      if let systemImage {
        Image(systemName: systemImage)
          .font(.system(size: 24, weight: .medium))
          .foregroundStyle(C.infoForeground.color)
          .frame(width: 56, height: 56)
          .background(C.infoBackground.color, in: Circle())
          .frame(maxWidth: .infinity)
          .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 6) {
        // The title keeps one line beside the accessory ("Create account") while both fit; a longer title ("Sign in to
        // Aglyn POS" on a phone) takes the whole width, the accessory above it at the top right, rather than wrapping.
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).font(AglynAuthFont.title).lineLimit(1).fixedSize().accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            accessory()
          }
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Spacer(minLength: 0)
              accessory()
            }
            Text(title).font(AglynAuthFont.title).fixedSize(horizontal: false, vertical: true)
              .accessibilityAddTraits(.isHeader)
          }
        }
        if let subtitle {
          Text(subtitle).font(AglynAuthFont.body).foregroundStyle(C.textSecondary.color)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      content()
    }
    .foregroundStyle(C.textPrimary.color)
    .padding(compact ? M.cardPaddingCompact : M.cardPaddingRegular)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(C.raised.color, in: shape)
    .overlay(shape.strokeBorder(C.borderSubtle.color, lineWidth: 1))
    // Elevation/Popover: 0 4 12 −2 at 10% and 0 16 40 −8 at 22%.
    .shadow(color: C.shadow.color.opacity(0.10), radius: 5, y: 4)
    .shadow(color: C.shadow.color.opacity(0.22), radius: 16, y: 16)
  }
}

/// How far the destination card still has to rise, and how visible it is, while the launch intro reveals it.
struct AuthReveal: Equatable {
  var offset: CGFloat = 0
  var opacity: Double = 1
}

extension EnvironmentValues {
  @Entry var authReveal = AuthReveal()
}

/// A form error under the fields: the field message's look, read out when it appears.
struct AuthMessage: View {
  let text: String
  var tone: AglynTone = .error

  var body: some View {
    if tone == .error {
      AglynFieldMessage(text, isError: true).accessibilityIdentifier("auth-error")
    } else {
      AglynAuthNotice(text, systemImage: "info.circle", tone: tone == .warning ? .warning : .info)
    }
  }
}

/// The card's primary action: full width, 48 points, a spinner beside the label while busy.
struct AuthPrimaryButton: View {
  let title: String
  let busy: Bool
  var enabled = true
  let action: () -> Void

  var body: some View {
    Button(action: action) { AglynButtonLabel(title, busy: busy) }
      .buttonStyle(AglynButtonStyle(.primary))
      .disabled(busy || !enabled)
      .keyboardShortcut(.defaultAction)
  }
}

/// A text link in a footer or at the card's top right ("Create account").
struct AuthLink: View {
  let title: String
  var identifier: String?
  let action: () -> Void

  init(_ title: String, identifier: String? = nil, action: @escaping () -> Void) {
    self.title = title
    self.identifier = identifier
    self.action = action
  }

  var body: some View {
    Button(title, action: action)
      .buttonStyle(AglynAuthLinkStyle())
      .accessibilityIdentifier(identifier ?? title)
  }
}

/// A footer line: a sentence and its link ("Having trouble logging in? Account recovery").
struct AuthFooterLine: View {
  let lead: String?
  let link: String
  var identifier: String?
  let action: () -> Void

  var body: some View {
    HStack(spacing: 4) {
      if let lead { Text(lead) }
      AuthLink(link, identifier: identifier, action: action)
    }
    .font(AglynAuthFont.small)
    .frame(maxWidth: .infinity)
  }
}

/// A labelled text field with the first rule its value breaks under it, once the person has tried to submit; the error
/// or helper line wraps to its full length.
struct AuthField: View {
  let label: String
  @Binding var text: String
  var secure = false
  var content: AuthFieldContent = .plain
  var placeholder: String?
  var message: String?
  var supporting: String?
  var identifier: String
  @FocusState private var focused: Bool

  var body: some View {
    AglynAuthFieldFrame(label, message: message, supporting: supporting, focused: focused) {
      Group {
        if secure {
          SecureField(label, text: $text, prompt: Text(placeholder ?? label))
        } else {
          TextField(label, text: $text, prompt: Text(placeholder ?? label))
        }
      }
      .textFieldStyle(.plain)
      .focused($focused)
      .autocorrectionDisabled(content != .plain)
      #if os(iOS)
        .textInputAutocapitalization(content == .name || content == .organization ? .words : .never)
        .keyboardType(content == .email ? .emailAddress : .default)
      #endif
      .textContentType(content.textContentType)
      .accessibilityIdentifier(identifier)
      .accessibilityHint(message ?? supporting ?? "")
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

/// A checkbox row (the console's `AuthCheckboxRow`): a 22-point box with its sentence beside it.
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
          .font(.system(size: 20))
          .foregroundStyle(isOn ? AglynAuthTokens.Colors.primary.color : AglynAuthTokens.Colors.borderStrong.color)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(accessibilityLabel)
      .accessibilityValue(isOn ? "Checked" : "Not checked")
      .accessibilityAddTraits(.isButton)
      .accessibilityIdentifier(identifier)
      label().font(AglynAuthFont.small).fixedSize(horizontal: false, vertical: true)
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
