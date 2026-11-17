// Putting a list in order where the phones show it in the same order (Uygulama › Hediyeler, Emojiler, Mağaza): drag a
// row, card or tile with the mouse onto another's place, the arrows for one step, or a quick sort (cheapest first,
// most sent…) of a whole group. Each ends the same way: the group's ids in their new order, saved on the app's server,
// which the phones follow. A group is what the app's server orders as one: a gift shelf, the emoji packs, one pack's
// stickers, one kind of the shop; dropping on another group's item does nothing.
import { html, useRef, useState } from './lib.js';

/** The ids with `from` taken out and put in `to`'s place (after it when it came from above, before it from below). */
export function moved(ids, from, to) {
  const out = ids.filter((x) => x !== from);
  out.splice(ids.indexOf(to), 0, from);
  return out;
}

/** The ids of `items` in a quick sort's order; ties keep their order. */
export const sortedIds = (items, sort) => [...items].sort(sort.cmp).map((x) => x.id);

/** The quick sorts, by what the items have. */
export const SORTS = {
  cheap: { label: 'Ucuzdan pahalıya', cmp: (a, b) => a.price - b.price },
  dear: { label: 'Pahalıdan ucuza', cmp: (a, b) => b.price - a.price },
  name: { label: 'Ada göre (A → Z)', cmp: (a, b) => a.name.localeCompare(b.name, 'tr') },
  sent: { label: 'En çok gönderilen', cmp: (a, b) => (b.sent?.count ?? 0) - (a.sent?.count ?? 0) },
  owned: { label: 'En çok alınan', cmp: (a, b) => (b.owners ?? 0) - (a.owners ?? 0) },
  vip: { label: 'VIP seviyesine göre', cmp: (a, b) => (a.minVip ?? 0) - (b.minVip ?? 0) || a.price - b.price },
};

/**
 * Drag-and-drop over groups: `save(group, ids)` when an item is dropped on another of its group. Returns, for an item,
 * the props of the element that is dragged (draggable, the handlers, and `class`: dragging / drop-here).
 */
export function useDragOrder(save) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  // The events read the drag here: the state is a render behind, and a quick drag can drop before the next one.
  const now = useRef(null);
  const end = () => ((now.current = null), setDrag(null), setOver(null));
  // An item can hold another group's (a pack's card its stickers): each event stops at the first item of its group.
  return (group, ids, id) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(id));
      now.current = { group, id };
      setDrag(now.current);
    },
    onDragOver: (e) => {
      const drag = now.current;
      if (drag?.group !== group || drag.id === id) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (over !== id) setOver(id);
    },
    onDrop: (e) => {
      const drag = now.current;
      if (drag?.group !== group) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.id !== id) save(group, moved(ids, drag.id, id));
      end();
    },
    onDragEnd: end,
    class: drag?.id === id && drag.group === group ? 'dragging' : over === id && drag?.group === group ? 'drop-here' : '',
  });
}

/** The quick sorts for a group: each asks first (the phones' order changes too), then `onSort(sort)`. */
export function SortBar({ sorts, what, onSort, disabled }) {
  const pick = (s) => confirm(`${what} “${s.label}” dizilsin mi? Telefonlarda da bu sırayla görünür. Elle verdiğiniz sıra değişir.`) && onSort(s);
  return html`<div class="sort-bar">
    <small class="muted">Sırala:</small>
    ${sorts.map((s) => html`<button type="button" class="btn ghost tiny" disabled=${disabled} onClick=${() => pick(s)}>${s.label}</button>`)}
    <small class="muted">ya da sürükleyip bırakın</small>
  </div>`;
}
