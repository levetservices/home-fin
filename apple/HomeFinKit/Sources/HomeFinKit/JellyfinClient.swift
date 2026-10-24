import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Jellyfin's REST API, as one signed-in user on this device.
public struct JellyfinClient: Sendable {
    public let server: URL
    public let device: DeviceIdentity
    public let token: String?
    public let userId: String?
    let http: HTTP

    /// Fields every row card, the billboard and More Info need.
    public static let itemFields = "Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,DateCreated,DateLastMediaAdded,PremiereDate,Status"
    static let imageTypes = "Primary,Backdrop,Thumb,Logo"

    public init(server: URL, device: DeviceIdentity, token: String? = nil, userId: String? = nil, session: URLSession = .shared) {
        self.server = server
        self.device = device
        self.token = token
        self.userId = userId
        self.http = HTTP(session: session)
    }

    /// The same client after signing in.
    public func signedIn(token: String, userId: String) -> JellyfinClient {
        JellyfinClient(server: server, device: device, token: token, userId: userId, session: http.session)
    }

    // MARK: requests

    func request(_ path: String, query: [String: String?] = [:], method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: HTTP.url(server, path, query))
        request.httpMethod = method
        request.setValue(device.authorization(token: token), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    func get<T: Decodable>(_ path: String, _ query: [String: String?] = [:]) async throws -> T {
        try await http.decode(T.self, request(path, query: query))
    }

    func send(_ path: String, method: String = "POST", query: [String: String?] = [:], json: Any? = nil) async throws {
        let body = try json.map { try JSONSerialization.data(withJSONObject: $0) }
        _ = try await http.data(request(path, query: query, method: method, body: body))
    }

    var uid: String { userId ?? "" }

    // MARK: server and sign-in

    public func publicInfo() async throws -> PublicSystemInfo {
        try await get("/System/Info/Public")
    }

    public func authenticate(username: String, password: String) async throws -> AuthenticationResult {
        let body = try JSONSerialization.data(withJSONObject: ["Username": username, "Pw": password])
        return try await http.decode(AuthenticationResult.self, request("/Users/AuthenticateByName", method: "POST", body: body))
    }

    public func currentUser() async throws -> JellyfinUser {
        try await get("/Users/Me")
    }

    /// Ends this device's session (the token stops working).
    public func logout() async {
        try? await send("/Sessions/Logout")
    }

    // MARK: browsing

    public func views() async throws -> [Item] {
        let result: ItemsResult = try await get("/UserViews", ["userId": uid])
        return result.items
    }

    public func resume(limit: Int = 20) async throws -> [Item] {
        let result: ItemsResult = try await get("/UserItems/Resume", [
            "userId": uid, "Limit": String(limit), "MediaTypes": "Video", "Fields": Self.itemFields,
            "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1"
        ])
        return result.items
    }

    public func nextUp(limit: Int = 20) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/NextUp", [
            "userId": uid, "Limit": String(limit), "Fields": Self.itemFields, "EnableImageTypes": Self.imageTypes,
            "ImageTypeLimit": "1", "EnableResumable": "false"
        ])
        return result.items
    }

    public func latest(parentId: String? = nil, limit: Int = 20) async throws -> [Item] {
        try await get("/Items/Latest", [
            "userId": uid, "ParentId": parentId, "Limit": String(limit), "Fields": Self.itemFields,
            "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1", "GroupItems": "true"
        ])
    }

    /// `/Items` with the usual card fields; pass any other Jellyfin query parameters in `query`.
    public func items(_ query: [String: String?]) async throws -> [Item] {
        var full: [String: String?] = ["userId": uid, "Recursive": "true", "Fields": Self.itemFields,
                                       "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1"]
        full.merge(query) { _, new in new }
        let result: ItemsResult = try await get("/Items", full)
        return result.items
    }

    /// Films and series, best rated first: what Home's genre rows and the billboard choose from.
    public func catalogue(limit: Int = 300) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Series", "SortBy": "CommunityRating,SortName", "SortOrder": "Descending",
                         "Limit": String(limit), "Fields": Self.itemFields + ",People"])
    }

    /// My List: favourite films and series, newest first.
    public func favourites(limit: Int = 50) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Series", "Filters": "IsFavorite", "SortBy": "DatePlayed,DateCreated",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    /// Films and episodes played most recently (what "Because you watched" is seeded from).
    public func recentlyPlayed(limit: Int = 20) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Episode", "Filters": "IsPlayed", "SortBy": "DatePlayed",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    public func item(_ id: String) async throws -> Item {
        var item: Item = try await get("/Items/\(id)", ["userId": uid, "Fields": Self.itemFields + ",People,MediaSources"])
        if item.people != nil { item.people = Array(item.people!.prefix(20)) }
        return item
    }

    public func items(ids: [String]) async throws -> [Item] {
        guard !ids.isEmpty else { return [] }
        let found = try await items(["Ids": ids.joined(separator: ",")])
        let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
        return found.sorted { (order[$0.id] ?? 0) < (order[$1.id] ?? 0) }
    }

    public func similar(to id: String, limit: Int = 16) async throws -> [Item] {
        let result: ItemsResult = try await get("/Items/\(id)/Similar", ["userId": uid, "Limit": String(limit), "Fields": Self.itemFields])
        return result.items
    }

    public func seasons(seriesId: String) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/\(seriesId)/Seasons", ["userId": uid, "Fields": "ChildCount"])
        return result.items
    }

    public func episodes(seriesId: String, seasonId: String) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/\(seriesId)/Episodes", [
            "userId": uid, "SeasonId": seasonId, "Fields": "Overview,RunTimeTicks", "EnableImageTypes": "Primary,Thumb", "ImageTypeLimit": "1"
        ])
        return result.items
    }

    /// The episode to play for a series: Next Up (or resumable), otherwise the first episode.
    public func episodeToPlay(seriesId: String) async throws -> Item? {
        let next: ItemsResult = try await get("/Shows/NextUp", ["userId": uid, "SeriesId": seriesId, "Limit": "1", "Fields": Self.itemFields])
        if let first = next.items.first { return first }
        let firstEpisode = try await items(["ParentId": seriesId, "IncludeItemTypes": "Episode", "SortBy": "ParentIndexNumber,IndexNumber", "Limit": "1"])
        return firstEpisode.first
    }

    public func search(_ term: String, limit: Int = 40) async throws -> [Item] {
        try await items(["searchTerm": term, "IncludeItemTypes": "Movie,Series", "Limit": String(limit)])
    }

    // MARK: user data

    public func setFavourite(_ id: String, _ favourite: Bool) async throws {
        try await send("/UserFavoriteItems/\(id)", method: favourite ? "POST" : "DELETE", query: ["userId": uid])
    }

    /// Thumbs up (true), down (false) or neither (nil).
    public func setRating(_ id: String, likes: Bool?) async throws {
        if let likes {
            try await send("/UserItems/\(id)/Rating", method: "POST", query: ["userId": uid, "likes": likes ? "true" : "false"])
        } else {
            try await send("/UserItems/\(id)/Rating", method: "DELETE", query: ["userId": uid])
        }
    }

    public func setPlayed(_ id: String, _ played: Bool) async throws {
        try await send("/UserPlayedItems/\(id)", method: played ? "POST" : "DELETE", query: ["userId": uid])
    }

    /// "Sign in a TV": approve the Quick Connect code a TV or phone app shows, as this user.
    public func authorizeQuickConnect(code: String) async throws {
        try await send("/QuickConnect/Authorize", query: ["code": code.trimmingCharacters(in: .whitespaces), "userId": uid])
    }

    // MARK: images

    public enum ImageType: String, Sendable {
        case primary = "Primary", backdrop = "Backdrop", thumb = "Thumb", logo = "Logo"
    }

    public func imageURL(_ itemId: String, _ type: ImageType, tag: String?, maxWidth: Int, index: Int? = nil) -> URL? {
        guard let tag else { return nil }
        let path = index.map { "/Items/\(itemId)/Images/\(type.rawValue)/\($0)" } ?? "/Items/\(itemId)/Images/\(type.rawValue)"
        return HTTP.url(server, path, ["tag": tag, "maxWidth": String(maxWidth), "quality": "85"])
    }

    /// 16:9 art for a card: the title's thumb or backdrop, an episode's own still, or its series' art.
    public func landscapeURL(_ item: Item, maxWidth: Int = 640, preferEpisodeStill: Bool = false) -> URL? {
        if preferEpisodeStill, item.isEpisode, let url = imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth) {
            return url
        }
        if let url = imageURL(item.id, .thumb, tag: item.imageTags?["Thumb"], maxWidth: maxWidth) { return url }
        if let url = imageURL(item.id, .backdrop, tag: item.backdropImageTags?.first, maxWidth: maxWidth) { return url }
        if let parent = item.parentThumbItemId, let url = imageURL(parent, .thumb, tag: item.parentThumbImageTag, maxWidth: maxWidth) { return url }
        if let parent = item.parentBackdropItemId, let url = imageURL(parent, .backdrop, tag: item.parentBackdropImageTags?.first, maxWidth: maxWidth) { return url }
        return imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth)
    }

    public func backdropURL(_ item: Item, maxWidth: Int = 1920) -> URL? {
        if let url = imageURL(item.id, .backdrop, tag: item.backdropImageTags?.first, maxWidth: maxWidth) { return url }
        if let parent = item.parentBackdropItemId { return imageURL(parent, .backdrop, tag: item.parentBackdropImageTags?.first, maxWidth: maxWidth) }
        return landscapeURL(item, maxWidth: maxWidth)
    }

    public func posterURL(_ item: Item, maxWidth: Int = 400) -> URL? {
        if !item.isEpisode, let url = imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth) { return url }
        if let series = item.seriesId { return imageURL(series, .primary, tag: item.seriesPrimaryImageTag, maxWidth: maxWidth) }
        return nil
    }

    /// The title treatment (logo) for an item or its series.
    public func logoURL(_ item: Item, maxWidth: Int = 600) -> URL? {
        if let url = imageURL(item.id, .logo, tag: item.imageTags?["Logo"], maxWidth: maxWidth) { return url }
        if let parent = item.parentLogoItemId { return imageURL(parent, .logo, tag: item.parentLogoImageTag, maxWidth: maxWidth) }
        return nil
    }
}

// MARK: - More of the library

extension JellyfinClient {
    /// "Series & Films You've Liked" (thumbs up), most recently played first.
    public func liked(limit: Int = 30) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Series", "Filters": "Likes", "SortBy": "DatePlayed,DateCreated",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    /// Films and series added in the last `days` days, newest first (the bell's list).
    public func arrivals(days: Int = 14, limit: Int = 12, now: Date = Date()) async throws -> [Item] {
        let latest = try await latest(limit: limit * 2)
        let cutoff = now.addingTimeInterval(-Double(days) * 86_400)
        return latest
            .filter { ($0.isMovie || $0.isSeries) && (HomePlanner.date($0.dateCreated) ?? .distantPast) >= cutoff }
            .sorted { (HomePlanner.date($0.dateCreated) ?? .distantPast) > (HomePlanner.date($1.dateCreated) ?? .distantPast) }
            .prefix(limit)
            .map { $0 }
    }

    /// Genre names that have films or series, for the Categories menu.
    public func genres(scope: HomeScope = .all) async throws -> [String] {
        let result: ItemsResult = try await get("/Genres", ["userId": uid, "Recursive": "true", "IncludeItemTypes": scope.itemTypes,
                                                            "SortBy": "SortName"])
        return result.items.compactMap(\.name)
    }

    /// A category page: everything in a genre, best rated first.
    public func items(inGenre genre: String, scope: HomeScope = .all, limit: Int = 200) async throws -> [Item] {
        try await items(["Genres": genre, "IncludeItemTypes": scope.itemTypes, "SortBy": "CommunityRating,SortName",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    /// Saves a position (or watched) without a playback session: offline viewing catching up,
    /// or "Remove from Row" (position 0 drops a title from Continue Watching).
    public func savePosition(_ itemId: String, seconds: Double, played: Bool? = nil, lastPlayed: Date? = nil) async throws {
        var body: [String: Any] = ["PlaybackPositionTicks": Int64(max(0, seconds) * ticksPerSecond)]
        if let played { body["Played"] = played }
        if let lastPlayed { body["LastPlayedDate"] = ISO8601DateFormatter().string(from: lastPlayed) }
        try await send("/UserItems/\(itemId)/UserData", query: ["userId": uid], json: body)
    }

    public func removeFromContinueWatching(_ item: Item) async throws {
        try await savePosition(item.id, seconds: 0)
    }

    /// An image without its cache tag, for screens that only have an id (the profile picker's
    /// backdrop). Jellyfin serves artwork without a sign-in.
    public func untaggedImageURL(_ itemId: String, _ type: ImageType, maxWidth: Int) -> URL {
        HTTP.url(server, "/Items/\(itemId)/Images/\(type.rawValue)", ["maxWidth": String(maxWidth), "quality": "85"])
    }

    /// The web app's page for a title, for Share.
    public func webURL(for item: Item) -> URL {
        let id = item.isEpisode ? (item.seriesId ?? item.id) : item.id
        return URL(string: HTTP.url(server, "/web/").absoluteString + "#/details?id=\(id)") ?? server
    }

    /// A page of the web app ("homefin/account", "homefin/profiles/manage").
    public func webURL(page: String) -> URL {
        URL(string: HTTP.url(server, "/web/").absoluteString + "#/" + page) ?? server
    }
}

/// The pills under Home's header: everything, just series, or just films.
public enum HomeScope: String, CaseIterable, Sendable {
    case all, series, films

    public var title: String {
        switch self {
        case .all: return "Home"
        case .series: return "Series"
        case .films: return "Films"
        }
    }

    var itemTypes: String {
        switch self {
        case .all: return "Movie,Series"
        case .series: return "Series"
        case .films: return "Movie"
        }
    }

    public func includes(_ item: Item) -> Bool {
        switch self {
        case .all: return true
        case .series: return item.isSeries || item.isEpisode || item.type == "Season"
        case .films: return item.isMovie
        }
    }
}
