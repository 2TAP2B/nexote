"use client";

import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useEffect, useRef } from "react";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

type MilkdownEditorProps = {
  defaultValue: string;
  onChange: (markdown: string) => void;
};

// Inner editor lives inside MilkdownProvider so it can use the editor hooks.
function MilkdownEditor({ defaultValue, onChange }: MilkdownEditorProps) {
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

    // Crepe exposes a listener API for document changes; emit the serialized
    // markdown to the parent so it can autosave.
    crepe.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        onChangeRef.current(markdown);
      });
    });

    crepeRef.current = crepe;
    return crepe;
  });

  return <Milkdown />;
}

// Public wrapper. Kept separate so the provider boundary is explicit and so
// the dynamic import in the parent can target this component.
export default function MilkdownEditorWrapper(
  props: MilkdownEditorProps,
) {
  return (
    <MilkdownProvider>
      <MilkdownEditor {...props} />
    </MilkdownProvider>
  );
}