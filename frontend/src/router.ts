// A tiny hash router: #/tickets, #/tickets/<id>, #/dashboard, #/team.
// Hash URLs work on any static host without server rewrite rules.

import { useEffect, useState } from "react";

export type Route =
  | { name: "tickets" }
  | { name: "ticket"; id: string }
  | { name: "dashboard" }
  | { name: "team" }
  | { name: "account" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "tickets" && parts[1]) return { name: "ticket", id: parts[1] };
  if (parts[0] === "dashboard") return { name: "dashboard" };
  if (parts[0] === "team") return { name: "team" };
  if (parts[0] === "account") return { name: "account" };
  return { name: "tickets" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
