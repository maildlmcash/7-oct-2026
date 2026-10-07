// Desk sign-in roles. These are not catalog grants and cannot place live orders.
export const DESK_ROLE_ACCESS = Object.freeze({
  User: Object.freeze({
    title: "User",
    summary: "Research, watchlist, and paper preview only.",
    sections: Object.freeze([
      "Dashboard",
      "Market",
      "DEX",
      "Wallets",
      "Predictions",
      "Paper",
      "Search",
      "Checklist",
    ]),
    denied: Object.freeze(["Bugs", "Admin"]),
  }),
  Admin: Object.freeze({
    title: "Admin",
    summary: "User access, plus bug review and the release checklist.",
    sections: Object.freeze([
      "Dashboard",
      "Market",
      "DEX",
      "Wallets",
      "Predictions",
      "Paper",
      "Search",
      "Checklist",
      "Bugs",
      "Admin",
    ]),
    denied: Object.freeze([]),
  }),
});

export function isDeskRole(role) {
  return role === "User" || role === "Admin";
}

export function deskSections(role) {
  if (!isDeskRole(role)) return null;
  return DESK_ROLE_ACCESS[role].sections;
}
