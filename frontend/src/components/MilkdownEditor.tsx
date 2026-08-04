"use client";

import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { forwardRef, useImperativeHandle, useRef } from "react";

// Crepe theme CSS is imported in src/app/globals.css so the cascade order
// relative to our .milkdown overrides is deterministic (keeps the editor in
// sync with the app theme, including dark mode).

export type MilkdownEditorHandle = {
  focus: () => void;
  selectHeading: () => void;
  focusEnd: () => void;
};

type MilkdownEditorProps = {
  defaultValue: string;
  onChange: (markdown: string) => void;
};

// Inner editor lives inside MilkdownProvider so it can use the editor hooks.
const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditor({ defaultValue, onChange }, ref) {
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEditor((root) => {
      const crepe = new Crepe({
        root,
        defaultValue,
        featureConfigs: {
          [Crepe.Feature.LinkTooltip]: {
            inputPlaceholder: "Paste a link…",
          },
        },
      });

      // Block-to-block arrow navigation: when ArrowUp is pressed at the
      // start of a block, jump to the start of the previous block. When
      // ArrowDown is pressed at the end of a block, jump to the start of
      // the next block.
      crepe.editor.config((ctx) => {
        const opts = ctx.get("editorViewOptions" as never) as Record<string, unknown>;
        ctx.set("editorViewOptions" as never, {
          ...opts,
          handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
            const view = ctx.get("editorView" as never) as EditorView;
            const { state, dispatch } = view;
            const { selection } = state;
            if (event.key === "ArrowUp") {
              if (!selection.empty) return false;
              const $head = selection.$head;
              if ($head.parentOffset === 0) {
                const doc = state.doc;
                const pos = $head.before($head.depth);
                if (pos <= 0) return false;
                const prevNode = doc.resolve(pos - 1).nodeBefore;
                if (!prevNode) return false;
                const targetPos = pos - prevNode.nodeSize;
                dispatch(
                  state.tr.setSelection(
                    TextSelection.create(doc, targetPos + 1),
                  ),
                );
                view.focus();
                return true;
              }
            } else {
              if (!selection.empty) return false;
              const $head = selection.$head;
              if ($head.parentOffset === $head.parent.content.size) {
                const doc = state.doc;
                if ($head.depth === 0) return false;
                const pos = $head.after($head.depth);
                // Ensure there IS a next block to jump to.
                if (pos + 1 >= doc.content.size) return false;
                dispatch(
                  state.tr.setSelection(
                    TextSelection.create(doc, pos + 1),
                  ),
                );
                view.focus();
                return true;
              }
            }
            return false;
          },
        } as never);
      });

      crepe.on((listener) => {
        listener.markdownUpdated((_, markdown) => {
          onChangeRef.current(markdown);
        });
      });

      crepeRef.current = crepe;
      return crepe;
    });

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            editorView.focus();
          });
        },
        selectHeading: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            const { state, dispatch } = editorView;
            const firstNode = state.doc.firstChild;
            if (firstNode && firstNode.type.name === "heading") {
              // Positions: 0 = before the heading, 1 = inside the heading
              // text, nodeSize-1 = after the last text char.
              const textStart = 1;
              const textEnd = firstNode.nodeSize - 1;
              dispatch(
                state.tr.setSelection(
                  new TextSelection(
                    state.doc.resolve(textStart),
                    state.doc.resolve(textEnd),
                  ),
                ),
              );
              editorView.focus();
            } else {
              editorView.focus();
            }
          });
        },
        focusEnd: () => {
          const editor = crepeRef.current?.editor;
          if (!editor) return;
          editor.action((ctx) => {
            const editorView = ctx.get("editorView") as EditorView;
            const { state, dispatch } = editorView;
            const doc = state.doc;
            // Walk to the last block-level node and place cursor at its end.
            if (doc.childCount === 0) {
              editorView.focus();
              return;
            }
            let pos = 0;
            doc.forEach((child) => {
              pos += child.nodeSize;
            });
            // pos is now at the end of the last child (before the closing
            // of the doc). Place the cursor one position before that
            // (inside the last block's closing boundary).
            const target = Math.max(0, pos - 1);
            dispatch(
              state.tr.setSelection(
                TextSelection.create(doc, target),
              ),
            );
            editorView.focus();
          });
        },
      }),
      [],
    );

    return <Milkdown />;
  },
);

// Public wrapper. Kept separate so the provider boundary is explicit and so
// the dynamic import in the parent can target this component.
const MilkdownEditorWrapper = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditorWrapper(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownEditor {...props} ref={ref} />
      </MilkdownProvider>
    );
  },
);

export default MilkdownEditorWrapper;