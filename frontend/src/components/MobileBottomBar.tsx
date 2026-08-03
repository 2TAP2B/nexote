"use client";

import { Plus, Search, LayoutDashboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DASHBOARD_ID, useNotes } from "@/lib/notes-context";

type Props = {
  onOpenPalette: () => void;
};

export default function MobileBottomBar({ onOpenPalette }: Props) {
  const { openTabs, activeId, notesById, openTab, create, creating } =
    useNotes();
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let el: HTMLElement | null = null;

    const onScroll = () => {
      if (!el) return;
      const scrollY = el.scrollTop;
      const delta = scrollY - lastScrollY.current;
      if (delta > 10 && scrollY > 60) {
        setVisible(false);
      } else if (delta < -10) {
        setVisible(true);
      }
      lastScrollY.current = scrollY;
    };

    const attach = () => {
      el = document.querySelector<HTMLElement>(".ProseMirror");
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        return true;
      }
      return false;
    };

    if (!attach()) {
      const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        el?.removeEventListener("scroll", onScroll);
      };
    }

    return () => {
      el?.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden flex items-center"
      style={{
        height: 44,
        background: "var(--tab-active)",
        borderTop: "1px solid var(--border)",
        transform: visible ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.25s ease",
      }}
    >
      {/* Scrollable tabs */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto h-full no-scrollbar">
        {openTabs.length === 0 && (
          <div className="flex items-center px-3 text-xs text-muted-foreground/40">
            No open notes
          </div>
        )}
        {openTabs.map((id) => {
          const isDashboard = id === DASHBOARD_ID;
          const note = notesById[id];
          const title = isDashboard ? "Dashboard" : note?.title || "Untitled";
          const active = id === activeId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => void openTab(id)}
              className="flex shrink-0 items-center justify-center text-xs"
              style={{
                height: 34,
                marginTop: 5,
                marginBottom: 5,
                background: active ? "var(--background)" : "transparent",
                borderRadius: 6,
                marginLeft: 4,
                minWidth: isDashboard ? 40 : 60,
                maxWidth: 130,
                padding: isDashboard ? 0 : undefined,
              }}
            >
              {isDashboard ? (
                <LayoutDashboard
                  size={14}
                  style={{ opacity: active ? 1 : 0.55 }}
                />
              ) : (
                <span
                  className="truncate"
                  style={{
                    fontWeight: active ? 500 : 400,
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  {note?.title || "Untitled"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 px-1 shrink-0">
        <button
          type="button"
          aria-label="Create new note"
          onClick={() => void create()}
          disabled={creating}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground"
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          aria-label="Search notes"
          onClick={onOpenPalette}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground/70 hover:text-foreground"
        >
          <Search size={18} />
        </button>
      </div>
    </div>
  );
}
