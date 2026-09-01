# Agent Patterns

Common multi-step reasoning patterns for Deft agent authors and contributors. These patterns apply to both on-device (Gemma 4) and cloud LLM backends.

---

## Long-list traversal

### When to use

Android's accessibility tree only contains nodes that are currently **rendered on screen**. Apps that use `RecyclerView` or `ScrollView` for long lists (contacts, emails, settings, messages) only render the visible rows. Items below the fold do not appear in `getAccessibilityTree()` output until the user scrolls to them.

Use the long-list traversal pattern when:
- The agent is looking for a specific list item (email subject, contact name, setting label) and `find_node` returns null.
- The current screen shows a scrollable list with no end indicator (unknown length).
- A previous `inspect_ui` confirms you are inside a long scrollable list.

Do **not** use it when:
- The target is clearly not a list item (e.g. a button that always appears in a fixed header).
- You have already scrolled and hit the end indicator (no new content appeared after the last scroll).

### Traversal pattern: `ui_find_node` + `ui_scroll`

Use the manual pattern when:
- You need to **inspect or interact with multiple matching nodes**, not just the first one.
- You want to collect all matching items across the full list before deciding which one to act on.

**Pseudocode**:

```
MAX_SCROLLS = 20
seen = {}            // track refs already processed
scroll_count = 0

loop:
  result = ui_find_node { text: target_text }
  nodes = result.matches

  fresh = [n for n in nodes if n.ref not in seen]
  if fresh:
    process(fresh)                    // tap, read, etc.
    mark fresh as seen

  if scroll_count >= MAX_SCROLLS:
    // Give up — either target not found or list is exhausted
    task_failed { reason: "Target not found after " + MAX_SCROLLS + " scroll steps" }
    break

  did_scroll = scroll { direction: "down" }
  if not did_scroll:
    // scrollNode returned false → hit the bottom of the list
    task_failed { reason: "Reached end of list without finding target" }
    break

  wait_for_change { timeoutMs: 1000 }   // wait for new rows to render
  scroll_count += 1
```

**Worked example** — LLM step-through for "archive all emails from Alice in Gmail":

```
[Step 1] inspect_ui
→ Observation: Gmail inbox, multiple senders visible.

[Step 2] ui_find_node { text: "Alice" }
→ Observation: { ambiguous: true, matches: [{ ref: "u12" }, { ref: "u17" }] }

[Step 3] tap { ref: "u12" }      // long-press → Archive
[Step 4] tap { ref: "u17" }      // already visible, archive

[Step 5] scroll { direction: "down" }
→ Observation: true

[Step 6] wait_for_change { timeoutMs: 800 }
→ Observation: true (new rows appeared)

[Step 7] ui_find_node { text: "Alice" }
→ Observation: { ambiguous: false, matches: [{ ref: "u31" }] }

[Step 8] tap { ref: "u31" }

[Step 9] scroll { direction: "down" }
→ Observation: false  (bottom of list reached — no more items)

[Step 10] task_complete { summary: "Archived 3 emails from Alice." }
```

The agent tracks which nodes it has already acted on (by ref) so repeated calls to `ui_find_node` after scrolling don't re-process the same items.

---

### API Reference

#### `ui_find_node`

Search the current accessibility tree and return all ranked candidates in `matches`. A unique match is also copied to the top level for convenient direct use. Multiple matches set `ambiguous=true` and deliberately omit a default top-level `ref`.

```typescript
ui_find_node(args: {
  text?: string;               // substring match against node.text (case-sensitive)
  contentDescription?: string; // substring match against node.contentDescription
  className?: string;          // exact match, e.g. "android.widget.Button"
  isChecked?: boolean;         // filter by checked state
  isEnabled?: boolean;         // filter by enabled state (false = disabled nodes)
}): Promise<{
  observationId: string;
  found: boolean;
  ambiguous: boolean;
  matchCount: number;
  truncated: boolean;
  matches: Array<{
    ref: string;
    text: string | null;
    contentDescription: string | null;
    bounds: object | null;
    center: { x: number; y: number } | null;
  }>;
}>
```

The candidates are ordered by specificity: exact text, prefix text, then substring text. When `matchCount > 1`, choose from `matches` using the returned metadata instead of assuming the first candidate is the intended target.

#### `scroll`

Scroll a scrollable element in a direction. If `nodeId` is omitted, the first scrollable container on screen is auto-detected.

```typescript
scroll(args: {
  nodeId?: string;                            // auto-detected if omitted
  direction: 'up' | 'down' | 'left' | 'right';
  distance?: 'short' | 'medium' | 'long';     // defaults to medium
}): Promise<ToolResult>
```

### Choosing the right tool

| Situation | Recommended tool |
|---|---|
| "Find and tap an unambiguous item matching X in a scrollable list" | `ui_find_node` + `ui_scroll_page` |
| "Find all items matching X across the whole list" | `ui_find_node.matches` + `ui_scroll` loop |
| "Item is likely on-screen now" | `ui_find_node` (no scroll) |
| "Wait for a specific item to appear after an action" | `wait_for_node` (polls without scrolling) |

---

### Pitfalls

**Hitting the bottom without a signal**: Some lists don't return `false` from `scroll` at the bottom — they just stop moving. Guard with both the `maxScrolls` limit AND a check for whether `ui_find_node.matches` contains any new nodes after the scroll (if nothing new appears after two consecutive scrolls, you've hit the end).

**Duplicate nodeIds across scroll positions**: In `RecyclerView`, Android recycles view objects, so the same `nodeId` can refer to different content at different scroll positions. Always re-read the tree after scrolling before acting on a stored `nodeId` — a node that was at position 5 before the scroll may now be at position 10 with a different view backing it.

**Slow tree updates**: On low-end devices, the accessibility tree can lag behind the visual state. If `ui_find_node` returns no matches after a scroll, wait with `wait_for_change` before concluding the item isn't there.
