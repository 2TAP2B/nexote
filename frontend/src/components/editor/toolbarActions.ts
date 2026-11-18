import {
  AtSign,
  Bold,
  Bug,
  CalendarDays,
  Check,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Code2,
  FileText,
  Flame,
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
  Pencil,
  Plus,
  Quote,
  Sparkles,
  Strikethrough,
  Table,
  TextQuote,
  TextSelect,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { RefObject } from "react";

import type { FormatAction, MilkdownEditorHandle } from "@/components/MilkdownEditor";
import { CALLOUT_TYPES, calloutKind, type CalloutType } from "@/components/editor/callout";

export type ToolbarMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Icon color (callout types use their box color). */
  color?: string;
  run: () => void;
};

/** A button runs `run`, or opens `menu` (a list of choices) when it has one. */
export type ToolbarAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  run?: () => void;
  menu?: ToolbarMenuItem[];
  accent?: boolean;
};

// The lucide counterparts of the callout box icons (editor/callout.ts).
const CALLOUT_ICONS: Record<CalloutType, LucideIcon> = {
  note: Pencil,
  abstract: ClipboardList,
  info: Info,
  todo: CircleCheck,
  tip: Flame,
  success: Check,
  question: CircleHelp,
  warning: TriangleAlert,
  failure: X,
  danger: Zap,
  bug: Bug,
  example: List,
  quote: Quote,
};

/** The editor toolbar's buttons in groups, shared by the phone bar (above the
 *  keyboard) and the desktop bar (below the note) so both offer the same. */
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
  const calloutMenu: ToolbarMenuItem[] = CALLOUT_TYPES.map((type) => {
    const kind = calloutKind(type);
    return { key: type, label: kind.label, icon: CALLOUT_ICONS[type], color: kind.color, run: format(`callout-${type}`) };
  });
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
      ...(markup ? [{ key: "callout", label: "Callout", icon: Info, menu: calloutMenu }] : []),
      { key: "code-block", label: "Code block", icon: Code2, run: format("code-block") },
      { key: "table", label: "Table", icon: Table, run: format("table") },
      { key: "image", label: "Image", icon: ImageIcon, run: pickImage },
      { key: "pdf", label: "PDF", icon: FileText, run: () => editorRef.current?.pickPdf() },
    ],
  ];
  if (aiAvailable) {
    groups.push([{ key: "ai", label: "Ask AI", icon: Sparkles, run: () => editorRef.current?.askAI(), accent: true }]);
  }
  return groups;
}
