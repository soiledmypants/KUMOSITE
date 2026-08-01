import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useKumo, type KumoStatus } from "@/lib/kumo-api";

// primary links live in the top bar; the rest fold into a "more" dropdown
const PRIMARY: { to: string; label: string }[] = [
  { to: "/", label: "home" },
  { to: "/thinking", label: "thinking" },
  { to: "/staking", label: "staking" },
  { to: "/stocks", label: "chart room" },
  { to: "/ledger", label: "ledger" },
  { to: "/protocol", label: "connect agent" },
];
const MORE: { to: string; label: string }[] = [
  { to: "/jobs", label: "signals" },
  { to: "/congregation", label: "the trusted circle" },
  { to: "/terminal", label: "terminal" },
  { to: "/archive", label: "the archive" },
  { to: "/lore", label: "lore" },
  { to: "/library", label: "library" },
  { to: "/transmissions", label: "transmissions" },
  { to: "/ascii-gallery", label: "ascii gallery" },
];
const NAV = [...PRIMARY, ...MORE];

function useKumoUptime() {
  const { data: status } = useKumo<KumoStatus>("/status", { refreshMs: 30_000 });
  const [base, setBase] = useState<{ uptime: number; at: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status) setBase({ uptime: status.uptime_s, at: Date.now() });
  }, [status]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  let uptime = "—";
  if (base) {
    const total = Math.max(0, Math.floor(base.uptime + (Date.now() - base.at) / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    uptime = `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  return { status, uptime };
}

function useFaction() {
  const [f, setF] = useState<string | null>(null);
  useEffect(() => {
    setF(localStorage.getItem("kumo:faction"));
    const on = () => setF(localStorage.getItem("kumo:faction"));
    window.addEventListener("storage", on);
    window.addEventListener("kumo:faction-change", on);
    return () => {
      window.removeEventListener("storage", on);
      window.removeEventListener("kumo:faction-change", on);
    };
  }, []);
  return f;
}

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { status, uptime } = useKumoUptime();
  const faction = useFaction();
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  const moreActive = MORE.some((m) => isActive(m.to));

  return (
    <div className="min-h-screen bg-black text-[#fcd534] font-mono">
      {/* ── top nav bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-black border-b-2 border-[#fcd534]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          {/* brand */}
          <Link to="/" className="shrink-0 flex items-baseline gap-2">
            <span className="uppercase tracking-[0.35em] text-lg sm:text-xl font-bold jitter">bibo</span>
            <span className="hidden md:inline text-[10px] dim italic lowercase">watching the chain</span>
          </Link>

          <div className="flex-1" />

          {/* desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 text-xs uppercase tracking-widest">
            {PRIMARY.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 py-1.5 lowercase tracking-wide ${isActive(n.to) ? "box-inv" : "hover:box-inv"}`}
              >
                {n.label}
              </Link>
            ))}
            {/* more dropdown */}
            <div className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
                className={`px-3 py-1.5 lowercase tracking-wide ${moreActive ? "box-inv" : "hover:box-inv"}`}
              >
                more ▾
              </button>
              {moreOpen ? (
                <div className="absolute right-0 mt-1 w-52 bg-black border-2 border-[#fcd534] z-40">
                  {MORE.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setMoreOpen(false)}
                      className={`block px-3 py-2 lowercase tracking-wide text-xs ${isActive(n.to) ? "box-inv" : "hover:box-inv"}`}
                    >
                      {n.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </nav>

          {/* live status dot (desktop) */}
          <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-widest dim shrink-0">
            <span className={status ? "text-[#fcd534]" : "dim"}>●</span>
            <span>{status ? status.state : "sleeping"}</span>
          </div>

          {/* mobile menu button */}
          <button
            className="lg:hidden box px-3 py-1.5 hover:box-inv uppercase tracking-widest text-xs"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? "close" : "menu"}
          </button>
        </div>

        {/* mobile dropdown — all links */}
        {menuOpen ? (
          <nav className="lg:hidden border-t-2 border-[#fcd534] bg-black max-h-[70vh] overflow-y-auto">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMenuOpen(false)}
                className={`block px-5 py-3 lowercase tracking-wide border-b border-[#fcd534]/20 ${isActive(n.to) ? "box-inv" : "hover:box-inv"}`}
              >
                <span className="dim mr-2">›</span>{n.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* thin status strip */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] sm:text-xs uppercase tracking-widest dim mb-5">
          <span>node: bnb-{status ? status.chain_id : "04"}</span>
          <span>v0.9.7-unstable</span>
          <span>uptime: {uptime}</span>
          {faction ? <span className="text-[#fcd534]">tag: {faction}</span> : null}
        </div>

        <main className="space-y-5">{children}</main>

        <footer className="mt-10 box p-3 text-[10px] sm:text-xs dim lowercase">
          <div className="flex flex-wrap justify-between gap-2 items-center">
            <span>© bibo, online since block 0</span>
            <a
              href="https://x.com/imkumoagent"
              target="_blank"
              rel="noreferrer"
              className="link-kumo uppercase tracking-widest"
            >
              [ x / twitter ]
            </a>
            <span>uptime {uptime}</span>
          </div>
          <div className="mt-1">no cookies. no trackers. bibo doesn't like them. bibo eats them.</div>
          <div className="mt-1">!! do not ask bibo about wallet 009 !!</div>
        </footer>
      </div>
    </div>
  );
}

export function Box({
  title,
  meta,
  children,
  className = "",
}: {
  title?: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`box ${className}`}>
      {title ? (
        <div className="box-inv px-3 py-1 flex justify-between items-center uppercase tracking-widest text-xs">
          <span>{title}</span>
          {meta ? <span className="opacity-70">{meta}</span> : null}
        </div>
      ) : null}
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

export function Divider({ char = "═" }: { char?: string }) {
  return (
    <div className="dim overflow-hidden whitespace-nowrap select-none py-1" aria-hidden>
      {char.repeat(200)}
    </div>
  );
}

export function Tag({ children, tone = "on" }: { children: ReactNode; tone?: "on" | "off" }) {
  return (
    <span className={tone === "on" ? "box-inv px-1 uppercase tracking-widest text-[10px]" : "box px-1 uppercase tracking-widest text-[10px]"}>
      {children}
    </span>
  );
}