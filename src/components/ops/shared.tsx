import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Plus } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Stat card                                                           */
/* ------------------------------------------------------------------ */

export function StatCard({
  label, value, hint, tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    tone === "bad" ? "text-rose-600 dark:text-rose-400" : "";
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Status pill                                                         */
/* ------------------------------------------------------------------ */

const TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  slate: "bg-muted text-muted-foreground",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function Pill({ tone = "slate", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof TONES {
  switch (status) {
    case "active": case "approved": case "published": case "paid": case "returned": case "available": case "free": case "received": case "present":
      return "green";
    case "pending": case "submitted": case "review": case "draft": case "maintenance": case "on_leave": case "issued": case "ordered":
      return "amber";
    case "rejected": case "overdue": case "lost": case "terminated": case "poor": case "absent": case "occupied": case "expired":
      return "red";
    default:
      return "slate";
  }
}

/* ------------------------------------------------------------------ */
/* Dialog form shell                                                   */
/* ------------------------------------------------------------------ */

export function FormDialog({
  trigger, title, children, onSubmit, submitting, wide,
}: {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode | ((set: (name: string, value: string) => void) => React.ReactNode);
  onSubmit: (data: Record<string, string>) => Promise<void> | void;
  submitting?: boolean;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});
  const set = (name: string, value: string) => setData((d) => ({ ...d, [name]: value }));
  const reset = () => setData({});
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "sm:max-w-xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onSubmit(data);
              reset();
              setOpen(false);
            } catch (err) {
              if (err instanceof Error) console.error(err.message);
            }
          }}
          className="space-y-3"
        >
          {typeof children === "function" ? children(set) : children}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Searchable picker                                                   */
/* ------------------------------------------------------------------ */

export interface PickerOption { id: string; label: string; sub?: string }

export function EntityPicker({
  options, value, onChange, placeholder = "Search…",
}: {
  options: PickerOption[];
  value: PickerOption | null;
  onChange: (o: PickerOption | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const filtered = query
    ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);
  return (
    <div className="relative" ref={ref}>
      {value ? (
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span>{value.label}{value.sub ? <span className="ml-1 text-muted-foreground">{value.sub}</span> : null}</span>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="pl-8"
            />
          </div>
          {open && filtered.length > 0 ? (
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popshadow">
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => { onChange(o); setQuery(""); setOpen(false); }}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.sub ? <span className="ml-1 text-xs text-muted-foreground">{o.sub}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
      <Icon className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
