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