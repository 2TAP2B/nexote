import {
  AtSign,
  Bold,
  CalendarDays,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  Sparkles,
  Strikethrough,
  Table,
  TextQuote,
  TextSelect,
  type LucideIcon,
} from "lucide-react";
import type { RefObject } from "react";

import type { FormatAction, MilkdownEditorHandle } from "@/components/MilkdownEditor";

export type ToolbarAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  accent?: boolean;
};

/** The editor toolbar's buttons in groups, shared by the phone bar (above the
 *  keyboard) and the desktop bar (above the note) so both offer the same. */
export function editorToolbarGroups({
  editorRef,
  aiAvailable,
  markup,
  blockSelect,
  pickImage,
}: {
  editorRef: RefObject<MilkdownEditorHandle | null>;
  aiAvailable: boolean;
  /** Settings › Editor › Callouts and highlights. */
  markup: boolean;
  /** Include "Select blocks" (desktop has it in the note header). */
  blockSelect: boolean;
  pickImage: () => void;
}): ToolbarAction[][] {
  const format = (action: FormatAction) => () => editorRef.current?.format(action);
  const groups: ToolbarAction[][] = [
    [
      { key: "insert", label: "Insert (/ commands)", icon: Plus, run: () => editorRef.current?.openSlash(), accent: true },
    ],
    [
      { key: "mention", label: "Link to note (@)", icon: AtSign, run: () => editorRef.current?.startMention() },
      { key: "date", label: "Insert date", icon: CalendarDays, run: () => editorRef.current?.insertDate() },
      ...(blockSelect
        ? [{ key: "select", label: "Select blocks", icon: TextSelect, run: () => editorRef.current?.toggleBlockSelect() }]
        : []),
    ],
    [
      { key: "bold", label: "Bold", icon: Bold, run: format("bold") },
      { key: "italic", label: "Italic", icon: Italic, run: format("italic") },
      { key: "strike", label: "Strikethrough", icon: Strikethrough, run: format("strike") },
      ...(markup ? [{ key: "highlight", label: "Highlight (==text==)", icon: Highlighter, run: format("highlight") }] : []),
    ],
    [
      { key: "h1", label: "Heading 1", icon: Heading1, run: format("h1") },
      { key: "h2", label: "Heading 2", icon: Heading2, run: format("h2") },
      { key: "h3", label: "Heading 3", icon: Heading3, run: format("h3") },
    ],
    [
      { key: "bullet-list", label: "Bullet list", icon: List, run: format("bullet-list") },
      { key: "ordered-list", label: "Ordered list", icon: ListOrdered, run: format("ordered-list") },
      { key: "task-list", label: "Task list", icon: ListTodo, run: format("task-list") },
      { key: "quote", label: "Quote", icon: TextQuote, run: format("quote") },
      ...(markup ? [{ key: "callout", label: "Callout (> [!info])", icon: Info, run: format("callout-info") }] : []),
      { key: "code-block", label: "Code block", icon: Code2, run: format("code-block") },
      { key: "table", label: "Table", icon: Table, run: format("table") },
      { key: "image", label: "Image", icon: ImageIcon, run: pickImage },
    ],
  ];
  if (aiAvailable) {
    groups.push([{ key: "ai", label: "Ask AI", icon: Sparkles, run: () => editorRef.current?.askAI(), accent: true }]);
  }
  return groups;
}
