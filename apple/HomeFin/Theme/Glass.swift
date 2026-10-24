import SwiftUI

// Liquid Glass (iOS 26 / macOS 26) with a frosted-material stand-in on iOS 18 and macOS 15, so
// every screen can just say `.glass(in:)`.

extension View {
    /// Puts the view on glass in `shape`. `tint` colours the glass; `interactive` makes it react
    /// to touch (buttons).
    @ViewBuilder
    func glass<S: Shape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            glassEffect(GlassRecipe.make(tint: tint, interactive: interactive), in: shape)
        } else {
            background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill((tint ?? Color.white).opacity(tint == nil ? 0.06 : 0.35))
                }
            }
            .overlay { shape.stroke(Color.white.opacity(0.16), lineWidth: 0.7) }
            .environment(\.colorScheme, .dark)
        }
    }

    /// Clear glass: for controls over artwork and video, where regular glass would hide too much.
    @ViewBuilder
    func clearGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            glassEffect(.clear.interactive(), in: shape)
        } else {
            background(shape.fill(.black.opacity(0.32)))
                .background(shape.fill(.ultraThinMaterial).opacity(0.6))
                .overlay { shape.stroke(Color.white.opacity(0.18), lineWidth: 0.7) }
        }
    }

    /// The soft blur where content scrolls under a pinned header (iOS 26), nothing before.
    @ViewBuilder
    func softScrollEdge() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            self
        }
    }
}

@available(iOS 26.0, macOS 26.0, *)
private enum GlassRecipe {
    static func make(tint: Color?, interactive: Bool) -> Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

/// Lets neighbouring glass shapes blend and morph into each other (iOS 26); a plain stack before.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 10
    @ViewBuilder var content: Content

    var body: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

/// A round glass button with an SF Symbol: close, back, cast, edit.
struct GlassCircleButton: View {
    var systemImage: String
    var size: CGFloat = 44
    var clear = false
    var label: String?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .modifier(CircleGlass(clear: clear))
                .contentShape(Circle())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label ?? systemImage)
    }

    private struct CircleGlass: ViewModifier {
        var clear: Bool

        func body(content: Content) -> some View {
            if clear { content.clearGlass(in: Circle()) } else { content.glass(in: Circle(), interactive: true) }
        }
    }
}

/// Shrinks a touch when pressed.
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(Theme.spring, value: configuration.isPressed)
    }
}

/// A glass pill for filters (Home's Series / Films / Categories).
struct GlassChip<Label: View>: View {
    var selected = false
    var action: () -> Void
    @ViewBuilder var label: Label

    var body: some View {
        Button(action: action) {
            label
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .glass(in: Capsule(), tint: selected ? Color.white.opacity(0.35) : nil, interactive: true)
                .contentShape(Capsule())
        }
        .buttonStyle(PressScaleStyle())
    }
}

/// A search field on glass, as on Netflix's Search tab.
struct GlassSearchField: View {
    var prompt: String
    @Binding var text: String
    var focus: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.secondary)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.secondary))
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .foregroundStyle(.white)
                .focused(focus)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.secondary)
                }
                .buttonStyle(.plain)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .glass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .animation(Theme.spring, value: text.isEmpty)
    }
}
