import HomeFinKit
import SwiftUI

/// Home: header and filter pills, the billboard, then rows. The page is washed in the
/// billboard's colour, as on Netflix.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var scope: HomeScope = {
        #if DEBUG
        if DemoMode.isOn && DemoMode.screen == "series" { return .series }
        #endif
        return .all
    }()
    @State private var plans: [HomeScope: HomePlan] = [:]
    @State private var error: String?
    @State private var scrolled = false
    @State private var tint = Color(hex: "#1b1b1b")
    @State private var showCategories = false
    @State private var path = NavigationPath()

    private var plan: HomePlan? { plans[scope] }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: compact ? 22 : 34) {
                    if let plan {
                        if let billboard = plan.billboard {
                            BillboardView(billboard: billboard, tint: $tint)
                                .id("\(scope)-\(billboard.item.id)")
                                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                        }
                        ForEach(Array(plan.rows.enumerated()), id: \.element.id) { index, row in
                            RowView(row: row)
                                .modifier(RowReveal(index: index))
                        }
                    } else if let error {
                        ContentUnavailableView {
                            Label("Couldn't load Home", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Try Again") { Task { await load() } }.buttonStyle(PrimaryButtonStyle())
                        }
                        .padding(.top, 80)
                    } else {
                        HomeSkeleton()
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .trackScrolled($scrolled)
            .background { wash }
            .pinnedHeader(scrolled: scrolled) { header }
            .refreshable { await load() }
            .hideNavigationBar()
            .navigationDestination(for: GenreRoute.self) { route in
                GenreView(route: route)
            }
        }
        .task(id: TaskKey(revision: model.homeRevision, scope: scope)) { await load() }
        .sheet(isPresented: $showCategories) {
            CategoriesView(scope: scope) { genre in
                showCategories = false
                path.append(GenreRoute(genre: genre, scope: scope))
            }
            .environment(model)
            .presentationBackground(.clear)
        }
    }

    private struct TaskKey: Hashable {
        var revision: Int
        var scope: HomeScope
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            TabHeader { BrandTitle(title: scope.title) }
            if !scrolled || !compact {
                pills
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.bottom, 8)
        .animation(Theme.spring, value: scrolled)
    }

    private var pills: some View {
        ScrollView(.horizontal) {
            GlassGroup(spacing: 8) {
                HStack(spacing: 8) {
                    if scope != .all {
                        Button {
                            withAnimation(Theme.glide) { scope = .all }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .bold))
                                .frame(width: 36, height: 36)
                                .glass(in: Circle(), interactive: true)
                        }
                        .buttonStyle(PressScaleStyle())
                        .transition(.scale.combined(with: .opacity))
                    }
                    ForEach([HomeScope.series, .films], id: \.self) { option in
                        if scope == .all || scope == option {
                            GlassChip(selected: scope == option) {
                                withAnimation(Theme.glide) { scope = scope == option ? .all : option }
                            } label: {
                                Text(option.title)
                            }
                            .transition(.scale.combined(with: .opacity))
                        }
                    }
                    GlassChip {
                        showCategories = true
                    } label: {
                        HStack(spacing: 6) {
                            Text(scope == .all ? "Categories" : "All Categories")
                            Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold))
                        }
                    }
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 2)
            }
        }
        .scrollIndicators(.hidden)
    }

    /// The billboard's colour fading to black down the page.
    private var wash: some View {
        LinearGradient(stops: [
            .init(color: tint, location: 0),
            .init(color: tint.opacity(0.55), location: 0.3),
            .init(color: .black, location: 0.7)
        ], startPoint: .top, endPoint: .bottom)
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.8), value: tint)
    }

    // MARK: data

    private func load() async {
        guard let jellyfin = model.jellyfin else { return }
        do {
            let fresh = try await HomeLoader(jellyfin: jellyfin, accounts: model.accounts).load(viewerName: model.viewerName, scope: scope)
            withAnimation(.easeOut(duration: 0.35)) {
                plans[scope] = fresh
                error = nil
            }
            if scope == .all {
                model.top10Ids = Set(fresh.rows.filter { $0.kind == .top10 }.flatMap { $0.items.map(\.id) })
                model.rememberPosters(fresh.rows.flatMap(\.items).compactMap { jellyfin.posterURL($0, maxWidth: 300) })
            }
        } catch {
            model.handle(error)
            if plan == nil { withAnimation { self.error = error.localizedDescription } }
        }
    }
}

/// Rows rise into place as they first appear (once).
struct RowReveal: ViewModifier {
    var index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 18)
            .onAppear {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.9).delay(min(Double(index), 4) * 0.04)) { shown = true }
            }
    }
}

/// Grey placeholders shimmering while Home loads.
struct HomeSkeleton: View {
    @Environment(\.isCompactLayout) private var compact
    @State private var phase = false

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.08))
                .aspectRatio(compact ? 0.7 : 16 / 7, contentMode: .fit)
                .padding(.horizontal, compact ? 24 : Theme.gutter)
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.white.opacity(0.08)).frame(width: 180, height: 18)
                    HStack(spacing: 8) {
                        ForEach(0..<6, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: Theme.cardRadius)
                                .fill(Color.white.opacity(0.08))
                                .frame(width: compact ? 110 : 260, height: compact ? 165 : 146)
                        }
                    }
                }
                .padding(.leading, Theme.gutter)
            }
        }
        .opacity(phase ? 1 : 0.5)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { phase = true }
        }
    }
}

// MARK: - Categories

struct GenreRoute: Hashable {
    var genre: String
    var scope: HomeScope
}

/// Netflix's category picker: a big centred list over a blur, closed with a glass X.
struct CategoriesView: View {
    var scope: HomeScope
    var pick: (String) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var genres: [String] = []

    var body: some View {
        ZStack(alignment: .bottom) {
            Rectangle().fill(.ultraThinMaterial).overlay(Color.black.opacity(0.55)).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 26) {
                    ForEach(genres, id: \.self) { genre in
                        Button(genre) { pick(genre) }
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(Theme.secondary)
                            .buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 70)
                .padding(.bottom, 140)
            }
            .scrollIndicators(.hidden)
            GlassCircleButton(systemImage: "xmark", size: 64, label: "Close") { dismiss() }
                .padding(.bottom, 30)
        }
        .foregroundStyle(.white)
        .task {
            genres = (try? await model.jellyfin?.genres(scope: scope)) ?? []
        }
    }
}

/// One category: a grid of posters, best rated first.
struct GenreView: View {
    var route: GenreRoute
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isCompactLayout) private var compact
    @State private var items: [Item] = []
    @State private var scrolled = false

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 8)], spacing: 10) {
                ForEach(items) { item in
                    Button { model.show(item) } label: { PosterCard(item: item, width: nil) }
                        .buttonStyle(CardButtonStyle())
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 40)
        }
        .trackScrolled($scrolled)
        .pinnedHeader(scrolled: scrolled) {
            HStack(spacing: 12) {
                GlassCircleButton(systemImage: "chevron.left", size: 40, label: "Back") { dismiss() }
                Text(route.genre).font(.system(size: 24, weight: .bold))
                Spacer()
            }
            .padding(.horizontal, Theme.gutter)
            .frame(height: 56)
        }
        .homeFinBackground()
        .hideNavigationBar()
        .task {
            items = (try? await model.jellyfin?.items(inGenre: route.genre, scope: route.scope)) ?? []
        }
    }
}
