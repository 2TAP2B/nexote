"use client";

import { Fragment, useRef, type RefObject } from "react";

import type { MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { ToolbarMenu, useToolbarMenu } from "@/components/editor/ToolbarMenu";
import { editorToolbarGroups } from "@/components/editor/toolbarActions";
import { useNotes } from "@/lib/notes-context";

/** Desktop formatting bar below the note: the phone toolbar's buttons
 *  (insert menu, @ link, date, formatting, blocks, callouts of every type,
 *  image, AI) for actions at the caret, which the selection toolbar can't
 *  reach. Settings › Editor › Formatting toolbar hides it. */
export default function EditorToolbar({
  editorRef,
  aiAvailable,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
}) {
  const { settings } = useNotes();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const menu = useToolbarMenu();
  const groups = editorToolbarGroups({
    editorRef,
    aiAvailable,
    markup: settings.calloutsAndHighlights,
    blockSelect: false,
    pickImage: () => fileRef.current?.click(),
  });

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      // Keep the editor's caret and selection: buttons never take focus.
      onMouseDown={(e) => e.preventDefault()}
      className="no-scrollbar shrink-0 overflow-x-auto px-3 py-1.5"
      style={{ borderTop: "1px solid var(--border)", background: "var(--background)" }}
    >
      <div className="mx-auto flex w-max items-center gap-0.5">
        {groups.map((group, gi) => (
          <Fragment key={group[0].key}>
            {gi > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0" style={{ background: "var(--border)" }} />}
            {group.map((action) => {
              const Icon = action.icon;
              const open = menu.open?.key === action.key;
              return (
                <button
                  key={action.key}
                  type="button"
                  aria-label={action.label}
                  aria-haspopup={action.menu ? "menu" : undefined}
                  aria-expanded={action.menu ? open : undefined}
                  title={action.label}
                  onClick={(e) => menu.press(action, e.currentTarget)}
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted " +
                    (action.accent || open ? "text-primary" : "text-muted-foreground hover:text-foreground") +
                    (open ? " bg-muted" : "")
                  }
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      {menu.open && <ToolbarMenu menu={menu.open} onClose={menu.close} />}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) editorRef.current?.insertImageFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
