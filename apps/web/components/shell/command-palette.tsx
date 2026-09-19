'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Input, cn } from '@engloop/ui';
import { NAVIGATION } from '@/lib/navigation';
import { useUiStore } from '@/lib/ui-store';
import { useTasks } from '@/lib/queries';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
}

/** ⌘K / Ctrl-K palette over navigation and the currently loaded tasks. */
export const CommandPalette = (): React.JSX.Element => {
  const open = useUiStore((state) => state.commandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPalette);
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);

  const { data: tasks } = useTasks({ pageSize: 50 });

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  const entries = React.useMemo<Entry[]>(() => {
    const navEntries = NAVIGATION.flatMap((section) =>
      section.items.map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        href: item.href,
        group: section.label ?? 'Navigate',
      })),
    );
    const taskEntries = (tasks?.items ?? []).map((task) => ({
      id: `task:${task.id}`,
      label: `${task.key} · ${task.title}`,
      hint: task.status,
      href: `/engineering/tasks/${task.id}`,
      group: 'Tasks',
    }));
    return [...navEntries, ...taskEntries];
  }, [tasks]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries.slice(0, 12);
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle)).slice(0, 20);
  }, [entries, query]);

  React.useEffect(() => setHighlight(0), [query]);

  const go = (entry: Entry | undefined): void => {
    if (!entry) return;
    setOpen(false);
    setQuery('');
    router.push(entry.href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[15%] max-w-lg translate-y-0 gap-0 p-0" hideClose>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search screens and tasks, then press Enter to open.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a screen or task…"
            className="h-11 border-0 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(filtered[highlight]);
              }
            }}
          />
        </div>

        <ul className="max-h-[320px] overflow-y-auto p-1.5 scrollbar-thin">
          {filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-xs text-muted-foreground">No matches.</li>
          ) : (
            filtered.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => go(entry)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm',
                    index === highlight ? 'bg-muted text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wide">
                    {entry.hint ? <span>{entry.hint}</span> : null}
                    <span className="text-muted-foreground/70">{entry.group}</span>
                    {index === highlight ? <CornerDownLeft className="h-3 w-3" /> : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
};
