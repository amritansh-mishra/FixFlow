// The 🔔 in the top bar: unread count, and a dropdown of recent notifications.
//
// It asks the API for new notifications every 30 seconds, but only while the
// tab is visible, so a forgotten background tab doesn't keep polling.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AppNotification } from "../api";
import { useAuth } from "../auth";
import { navigate } from "../router";
import { timeAgo } from "./ui";

const POLL_MS = 30_000;

const ICONS: Record<AppNotification["type"], string> = {
  ticket_assigned: "🛠️",
  status_changed: "🔄",
  comment_added: "💬",
};

export function NotificationBell() {
  const { token } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: AppNotification[]; unreadCount: number }>("/api/notifications?limit=15", { token });
      setItems(res.data);
      setUnread(res.unreadCount);
    } catch {
      // A failed check isn't worth interrupting the user; the next one may work.
    }
  }, [token]);

  // Check now, then every 30s while the tab is visible, and right away when
  // the user comes back to the tab.
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(ids?: string[]) {
    await api("/api/notifications/read", { method: "POST", token, body: ids ? { ids } : {} }).catch(() => {});
    await load();
  }

  async function openNotification(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) await markRead([n.id]);
    navigate(`/tickets/${n.ticketId}`);
  }

  return (
    <div className="bell" ref={wrapper}>
      <button
        className="bell-button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel card" role="dialog" aria-label="Notifications">
          <div className="bell-header">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="link small" onClick={() => void markRead()}>
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted small bell-empty">You're all caught up.</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`bell-item ${n.readAt ? "" : "unread"}`} onClick={() => void openNotification(n)}>
                    <span className="bell-icon" aria-hidden="true">{ICONS[n.type]}</span>
                    <span className="bell-text">
                      <span>{n.message}</span>
                      <span className="muted small">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="bell-dot" aria-label="unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
