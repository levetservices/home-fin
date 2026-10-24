import HomeFinKit
import SwiftUI

/// Signed out: Netflix's welcome. A drifting poster mosaic, two pages of pitch and Sign In.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @State private var page: Int? = 0

    private static let pages = [
        (title: "Films and series from your own server", icon: "play.rectangle.on.rectangle"),
        (title: "Download and watch anywhere", icon: "arrow.down.circle")
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(Self.pages.indices, id: \.self) { index in
                        card(index)
                            .padding(.horizontal, 16)
                            .containerRelativeFrame(.horizontal)
                            .id(index)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $page)
            .scrollIndicators(.hidden)

            HStack(spacing: 8) {
                ForEach(Self.pages.indices, id: \.self) { index in
                    Circle()
                        .fill(index == (page ?? 0) ? Color.white : Color.white.opacity(0.35))
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.vertical, 16)
            .animation(Theme.spring, value: page)

            invite
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
        .background {
            LinearGradient(colors: [Color(hex: "#160b10"), .black, Color(hex: "#3a0b10")], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
        .foregroundStyle(.white)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Wordmark(size: 30)
            Spacer()
            Menu {
                if model.server != nil {
                    Button("Change server", systemImage: "server.rack") { model.changeServer() }
                }
                Link(destination: URL(string: "https://jellyfin.org/docs/general/quick-start")!) {
                    Label("What's a media server?", systemImage: "questionmark.circle")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .rotationEffect(.degrees(90))
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            Button("Sign In") { model.beginSignIn() }
                .font(.system(size: 16, weight: .semibold))
                .padding(.horizontal, 16)
                .frame(height: 38)
                .glass(in: RoundedRectangle(cornerRadius: 8, style: .continuous), interactive: true)
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private func card(_ index: Int) -> some View {
        ZStack(alignment: .bottom) {
            if index == 0 {
                PosterMosaic(posters: model.welcomePosters)
            } else {
                ZStack {
                    RadialGradient(colors: [Color(hex: "#5a0d14"), .black], center: .center, startRadius: 10, endRadius: 320)
                    Image(systemName: Self.pages[index].icon)
                        .font(.system(size: 120, weight: .thin))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.bottom, 120)
                }
            }
            LinearGradient(colors: [.clear, .black.opacity(0.75), .black.opacity(0.95)], startPoint: .center, endPoint: .bottom)
            Text(Self.pages[index].title)
                .font(.system(size: 30, weight: .bold))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .padding(.bottom, 44)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
    }

    private var invite: some View {
        VStack(spacing: 4) {
            if model.server != nil {
                Text("Signing in to \(model.serverName).")
                Text(model.server?.host() ?? "").foregroundStyle(Color(hex: "#6ea8ff"))
            } else {
                Text("Got an invite to someone's Home Fin?")
                Text("Open the link on this device, or tap Sign In.").foregroundStyle(Color(hex: "#6ea8ff"))
            }
        }
        .font(.system(size: 15))
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: "#2a0508").opacity(0.7)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: "#e5534b"), lineWidth: 1.5))
    }
}

/// Three columns of posters drifting past each other. Uses posters remembered from the last time
/// someone was signed in on this device; plain tiles on a first run.
struct PosterMosaic: View {
    var posters: [URL]
    @State private var drift = false

    var body: some View {
        GeometryReader { proxy in
            let width = (proxy.size.width - 16) / 3
            HStack(alignment: .top, spacing: 8) {
                ForEach(0..<3, id: \.self) { column in
                    VStack(spacing: 8) {
                        ForEach(0..<5, id: \.self) { row in
                            tile(column * 5 + row)
                                .frame(width: width, height: width * 1.45)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                    .offset(y: (column == 1 ? -40 : -120) + (drift ? (column == 1 ? -60 : 60) : 0))
                }
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 18).repeatForever(autoreverses: true)) { drift = true }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder private func tile(_ index: Int) -> some View {
        if !posters.isEmpty {
            Artwork(url: posters[index % posters.count])
        } else {
            let hues: [Color] = [Color(hex: "#7a1a1a"), Color(hex: "#1e3a5f"), Color(hex: "#2f5233"), Color(hex: "#5b2c6f"), Color(hex: "#8a5a12")]
            LinearGradient(colors: [hues[index % hues.count], .black], startPoint: .topLeading, endPoint: .bottomTrailing)
                .overlay(alignment: .topLeading) {
                    BrandMark(size: 18).padding(6)
                }
        }
    }
}
