"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  GripVertical,
  Trash2,
  Check,
  X,
  User,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────

type Status = "todo" | "in_progress" | "done";

type RoadmapItem = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: number;
  assigned_to: string | null;
  category: string;
  created_at: string;
  updated_at: string;
};

const COLUMNS: { key: Status; label: string; color: string; bg: string }[] = [
  { key: "todo", label: "To Do", color: "text-slate-600", bg: "bg-slate-100" },
  { key: "in_progress", label: "In Progress", color: "text-blue-600", bg: "bg-blue-50" },
  { key: "done", label: "Done", color: "text-emerald-600", bg: "bg-emerald-50" },
];

const PEOPLE = ["Georges", "Tiemen"];
const CATEGORIES = ["core", "frontend", "infra", "polish", "general"];

// ── Main Component ───────────────────────────────────────────────────

export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);
  const [showAdd, setShowAdd] = useState<Status | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newAssign, setNewAssign] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("general");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────────

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roadmap");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      console.error("Failed to fetch roadmap:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (showAdd && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAdd]);

  // ── Helpers ────────────────────────────────────────────────────────

  const itemsByStatus = (status: Status) =>
    items.filter((i) => i.status === status).sort((a, b) => a.priority - b.priority);

  // ── Add ────────────────────────────────────────────────────────────

  const handleAdd = async (status: Status) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/admin/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          status,
          assigned_to: newAssign,
          category: newCategory,
        }),
      });
      const data = await res.json();
      if (data.item) {
        setItems((prev) => [...prev, data.item]);
      }
    } catch (e) {
      console.error("Failed to add item:", e);
    }
    setNewTitle("");
    setNewAssign(null);
    setNewCategory("general");
    setShowAdd(null);
  };

  // ── Delete ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await fetch("/api/admin/roadmap", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.error("Failed to delete:", e);
      fetchItems();
    }
  };

  // ── Status toggle (click) ─────────────────────────────────────────

  const cycleStatus = async (item: RoadmapItem) => {
    const next: Record<Status, Status> = {
      todo: "in_progress",
      in_progress: "done",
      done: "todo",
    };
    const newStatus = next[item.status];

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, status: newStatus } : i
      )
    );

    try {
      await fetch("/api/admin/roadmap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status: newStatus }),
      });
    } catch (e) {
      console.error("Failed to update status:", e);
      fetchItems();
    }
  };

  // ── Drag & Drop (native HTML5) ────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragItem(id);
    e.dataTransfer.effectAllowed = "move";
    // Make the drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDragItem(null);
    setDragOverCol(null);
  };

  const handleDragOver = (e: React.DragEvent, status: Status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: Status) => {
    e.preventDefault();
    setDragOverCol(null);

    if (!dragItem) return;

    const item = items.find((i) => i.id === dragItem);
    if (!item) return;

    // Optimistic: move to new column at bottom
    const targetItems = itemsByStatus(targetStatus);
    const newPriority =
      targetItems.length > 0
        ? Math.max(...targetItems.map((i) => i.priority)) + 1
        : 0;

    setItems((prev) =>
      prev.map((i) =>
        i.id === dragItem
          ? { ...i, status: targetStatus, priority: newPriority }
          : i
      )
    );

    try {
      await fetch("/api/admin/roadmap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: dragItem,
          status: targetStatus,
          priority: newPriority,
        }),
      });
    } catch (e) {
      console.error("Failed to move item:", e);
      fetchItems();
    }

    setDragItem(null);
  };

  // ── Assign toggle ─────────────────────────────────────────────────

  const toggleAssign = async (item: RoadmapItem) => {
    const currentIdx = item.assigned_to
      ? PEOPLE.indexOf(item.assigned_to)
      : -1;
    const nextIdx = (currentIdx + 1) % (PEOPLE.length + 1);
    const newAssign = nextIdx < PEOPLE.length ? PEOPLE[nextIdx] : null;

    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, assigned_to: newAssign } : i
      )
    );

    try {
      await fetch("/api/admin/roadmap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, assigned_to: newAssign }),
      });
    } catch (e) {
      console.error("Failed to update assignment:", e);
      fetchItems();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading roadmap…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Roadmap</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Drag items between columns · Click status badge to cycle · Click avatar to reassign
        </p>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-[900px]">
          {COLUMNS.map((col) => {
            const colItems = itemsByStatus(col.key);

            return (
              <div
                key={col.key}
                className={cn(
                  "flex-1 flex flex-col rounded-lg border transition-colors min-w-[280px]",
                  dragOverCol === col.key && dragItem
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30"
                )}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-semibold uppercase tracking-wider",
                        col.color
                      )}
                    >
                      {col.label}
                    </span>
                    <span className="text-xs text-muted-foreground rounded-full bg-muted px-1.5 py-0.5 font-medium">
                      {colItems.length}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowAdd(showAdd === col.key ? null : col.key);
                      setNewTitle("");
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {/* Add form */}
                {showAdd === col.key && (
                  <div className="px-3 py-2 border-b bg-background">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="What needs to be done?"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd(col.key);
                        if (e.key === "Escape") setShowAdd(null);
                      }}
                      className="w-full text-sm border rounded-md px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-2 mb-2">
                      <select
                        value={newAssign ?? ""}
                        onChange={(e) =>
                          setNewAssign(e.target.value || null)
                        }
                        className="text-xs border rounded px-1.5 py-1 bg-background"
                      >
                        <option value="">Unassigned</option>
                        {PEOPLE.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        className="text-xs border rounded px-1.5 py-1 bg-background"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleAdd(col.key)}
                        disabled={!newTitle.trim()}
                        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                      >
                        <Check className="h-3 w-3" /> Add
                      </button>
                      <button
                        onClick={() => setShowAdd(null)}
                        className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-1 rounded hover:bg-muted"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Items */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {colItems.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        "group relative bg-background rounded-md border px-3 py-2.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm",
                        dragItem === item.id && "opacity-50"
                      )}
                    >
                      {/* Drag handle */}
                      <GripVertical className="absolute left-0.5 top-3 h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />

                      {/* Title */}
                      <p
                        className={cn(
                          "text-sm font-medium pl-3 pr-6",
                          item.status === "done" &&
                            "line-through text-muted-foreground"
                        )}
                      >
                        {item.title}
                      </p>

                      {/* Meta row */}
                      <div className="flex items-center gap-2 mt-1.5 pl-3">
                        {/* Category badge */}
                        <button
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          title={`Category: ${item.category}`}
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {item.category}
                        </button>

                        {/* Assignee */}
                        <button
                          onClick={() => toggleAssign(item)}
                          className={cn(
                            "inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors",
                            item.assigned_to
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                          title={
                            item.assigned_to
                              ? `Assigned to ${item.assigned_to} — click to change`
                              : "Click to assign"
                          }
                        >
                          <User className="h-2.5 w-2.5" />
                          {item.assigned_to ?? "—"}
                        </button>

                        {/* Status click-to-cycle */}
                        <button
                          onClick={() => cycleStatus(item)}
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors",
                            item.status === "todo" &&
                              "bg-slate-100 text-slate-600 hover:bg-slate-200",
                            item.status === "in_progress" &&
                              "bg-blue-50 text-blue-600 hover:bg-blue-100",
                            item.status === "done" &&
                              "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          )}
                          title="Click to cycle status"
                        >
                          {item.status.replace("_", " ")}
                        </button>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  {colItems.length === 0 && !showAdd && (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      Drop items here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
