"use client";

import { Fragment, useRef, type RefObject } from "react";

import type { MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { editorToolbarGroups } from "@/components/editor/toolbarActions";
import { useNotes } from "@/lib/notes-context";

/** Desktop formatting bar above the note: the phone toolbar's buttons
 *  (insert menu, @ link, date, formatting, blocks, image, AI) for actions at
 *  the caret, which the selection toolbar can't reach. Settings › Editor ›
 *  Formatting toolbar hides it. */
export default function EditorToolbar({
  editorRef,
  aiAvailable,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
}) {
  const { settings } = useNotes();
  const fileRef = useRef<HTMLInputElement | null>(null);
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
      className="no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto px-3 py-1"
      style={{ borderBottom: "1px solid var(--border)", background: "var(--background)" }}
    >
      {groups.map((group, gi) => (
        <Fragment key={group[0].key}>
          {gi > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0" style={{ background: "var(--border)" }} />}
          {group.map(({ key, label, icon: Icon, run, accent }) => (
            <button
              key={key}
              type="button"
              aria-label={label}
              title={label}
              onClick={run}
              className={
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted " +
                (accent ? "text-primary" : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon size={16} />
            </button>
          ))}
        </Fragment>
      ))}
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
