// Block selection mode (like Anytype): while on, the editor is read-only and
// each tap toggles one block — a list item on its own, otherwise a top-level
// block — so any set of blocks, gaps included, can be copied, cut or deleted
// together. ProseMirror selections are one continuous range, hence a mode of
// its own with its own actions instead of the native selection.

import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

export type BlockSelectState = { active: boolean; selected: number[] };

type Meta = { type: "mode"; active: boolean } | { type: "toggle"; pos: number } | { type: "clear" };

export const blockSelectKey = new PluginKey<BlockSelectState>("nexote-block-select");

const LIST_ITEM = "list_item";

export function blockSelectState(state: EditorState): BlockSelectState {
  return blockSelectKey.getState(state) ?? { active: false, selected: [] };
}

export function setBlockSelectMode(view: EditorView, active: boolean): void {
  view.dispatch(view.state.tr.setMeta(blockSelectKey, { type: "mode", active } satisfies Meta));
}

/** Start of the block a position belongs to: the innermost list item, else the top-level block. */
function blockAt(doc: ProseNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).type.name === LIST_ITEM) return $pos.before(d);
  }
  if ($pos.depth >= 1) return $pos.before(1);
  return doc.nodeAt(pos) ? pos : null;
}

/**
 * The selection as whole nodes to act on: an ancestor swallows its selected
 * descendants, and a list whose items are all selected stands in for them
 * (deleting every item one by one would leave an invalid empty list).
 */
function normalized(doc: ProseNode, positions: number[]): number[] {
  const set = new Set(positions);
  let changed = true;
  while (changed) {
    changed = false;
    const parents = new Map<number, number>();
    for (const pos of set) {
      const $pos = doc.resolve(pos);
      if (doc.nodeAt(pos)?.type.name !== LIST_ITEM || $pos.depth === 0) continue;
      const listPos = $pos.before($pos.depth);
      parents.set(listPos, (parents.get(listPos) ?? 0) + 1);
    }
    for (const [listPos, count] of parents) {
      const list = doc.nodeAt(listPos);
      if (!list || count !== list.childCount || set.has(listPos)) continue;
      list.forEach((_child, offset) => set.delete(listPos + 1 + offset));
      set.add(listPos);
      changed = true;
    }
  }
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.filter((pos) =>
    !sorted.some((outer) => outer < pos && pos < outer + (doc.nodeAt(outer)?.nodeSize ?? 0)),
  );
}

/** The selected blocks as a document (list items keep their list), for copying. */
export function selectedBlocksDoc(state: EditorState): ProseNode | null {
  const { doc, schema } = state;
  // Consecutive selected items of one list are copied as one list.
  const groups: { listPos: number | null; list: ProseNode | null; nodes: ProseNode[] }[] = [];
  for (const pos of normalized(doc, blockSelectState(state).selected)) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    const $pos = doc.resolve(pos);
    const inList = node.type.name === LIST_ITEM && $pos.depth > 0;
    const listPos = inList ? $pos.before($pos.depth) : null;
    const prev = groups[groups.length - 1];
    if (inList && prev && prev.listPos === listPos) prev.nodes.push(node);
    else groups.push({ listPos, list: inList ? $pos.parent : null, nodes: [node] });
  }
  const nodes = groups.flatMap((g) => (g.list ? [g.list.type.create(g.list.attrs, g.nodes)] : g.nodes));
  return nodes.length ? schemaDoc(schema, nodes) : null;
}

function schemaDoc(schema: Schema, nodes: ProseNode[]): ProseNode | null {
  return schema.topNodeType.createAndFill(undefined, nodes);
}

/** A transaction deleting the selected blocks (one undo step), leaving the mode on. */
export function deleteSelectedBlocks(state: EditorState): Transaction | null {
  const positions = normalized(state.doc, blockSelectState(state).selected);
  if (positions.length === 0) return null;
  const tr = state.tr;
  for (const pos of [...positions].reverse()) {
    const node = state.doc.nodeAt(pos);
    if (!node) continue;
    tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
  }
  return tr.setMeta(blockSelectKey, { type: "clear" } satisfies Meta);
}

export function blockSelectPlugin(onChange: (state: BlockSelectState) => void) {
  return new Plugin<BlockSelectState>({
    key: blockSelectKey,
    state: {
      init: () => ({ active: false, selected: [] }),
      apply(tr, value) {
        const meta = tr.getMeta(blockSelectKey) as Meta | undefined;
        let next = value;
        if (tr.docChanged && value.selected.length) {
          const selected: number[] = [];
          for (const pos of value.selected) {
            const mapped = tr.mapping.mapResult(pos, 1);
            if (!mapped.deleted && tr.doc.nodeAt(mapped.pos)) selected.push(mapped.pos);
          }
          next = { ...next, selected };
        }
        if (!meta) return next;
        if (meta.type === "mode") return { active: meta.active, selected: [] };
        if (meta.type === "clear") return { ...next, selected: [] };
        const selected = next.selected.includes(meta.pos)
          ? next.selected.filter((p) => p !== meta.pos)
          : [...next.selected, meta.pos];
        return { ...next, selected };
      },
    },
    props: {
      editable: (state) => !blockSelectState(state).active,
      attributes: (state): Record<string, string> =>
        blockSelectState(state).active ? { class: "nexote-block-select-mode" } : {},
      decorations(state) {
        const { active, selected } = blockSelectState(state);
        if (!active || selected.length === 0) return null;
        const decos: Decoration[] = [];
        for (const pos of selected) {
          const node = state.doc.nodeAt(pos);
          if (node) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "nexote-block-selected" }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
    view(view) {
      // Capture phase: taps must select even inside node views (code blocks,
      // images, task checkboxes) that would otherwise act on them.
      const onMouseDown = (e: Event) => {
        if (blockSelectState(view.state).active) e.preventDefault();
      };
      const onClick = (e: Event) => {
        if (!blockSelectState(view.state).active || !(e.target instanceof Node)) return;
        e.preventDefault();
        e.stopPropagation();
        let pos: number;
        try {
          pos = view.posAtDOM(e.target, 0);
        } catch {
          return;
        }
        const block = blockAt(view.state.doc, Math.min(pos, view.state.doc.content.size));
        if (block !== null) view.dispatch(view.state.tr.setMeta(blockSelectKey, { type: "toggle", pos: block } satisfies Meta));
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && blockSelectState(view.state).active) setBlockSelectMode(view, false);
      };
      view.dom.addEventListener("mousedown", onMouseDown, true);
      view.dom.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKey);
      let last = blockSelectState(view.state);
      onChange(last);
      return {
        update(v) {
          const now = blockSelectState(v.state);
          if (now === last) return;
          last = now;
          onChange(now);
        },
        destroy() {
          view.dom.removeEventListener("mousedown", onMouseDown, true);
          view.dom.removeEventListener("click", onClick, true);
          window.removeEventListener("keydown", onKey);
        },
      };
    },
  });
}
