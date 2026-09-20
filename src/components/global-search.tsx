import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { User, Users, GraduationCap, Search } from "lucide-react";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const results = useQuery(api.search.globalSearch, { query: term }) ?? [];
  const loading = term.trim().length >= 2 && results === undefined;

  const grouped = {
    students: results.filter((r) => r.type === "student"),
    guardians: results.filter((r) => r.type === "guardian"),
    staff: results.filter((r) => r.type === "staff"),
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search school…</span>
        <kbd className="rounded border bg-background px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
      </button>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border md:hidden"
      >
        <Search className="size-4" />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search students, guardians, staff…"
        />
        <CommandList>
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>}
          {!loading && term.trim().length >= 2 && results.length === 0 && (
            <CommandEmpty>No matches found.</CommandEmpty>
          )}
          {term.trim().length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </div>
          )}
          {grouped.students.length > 0 && (
            <CommandGroup heading="Students">
              {grouped.students.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`student-${r.title}-${r.id}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(r.href);
                  }}
                >
                  <GraduationCap className="mr-2 size-4 text-muted-foreground" />
                  <span>{r.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {grouped.guardians.length > 0 && (
            <CommandGroup heading="Guardians">
              {grouped.guardians.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`guardian-${r.title}-${r.id}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(r.href);
                  }}
                >
                  <Users className="mr-2 size-4 text-muted-foreground" />
                  <span>{r.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {grouped.staff.length > 0 && (
            <CommandGroup heading="Staff">
              {grouped.staff.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`staff-${r.title}-${r.id}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(r.href);
                  }}
                >
                  <User className="mr-2 size-4 text-muted-foreground" />
                  <span>{r.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{r.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
