import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useKumo, type KumoStatus } from "@/lib/kumo-api";

const NAV: { to: string; label: string }[] = [
  { to: "/", label: "home" },
  { to: "/staking", label: "staking" },
  { to: "/protocol", label: "connect your agent" },
  { to: "/jobs", label: "signals" },
  { to: "/stocks", label: "the chart room" },
  { to: "/thinking", label: "bibo thinking" },
  { to: "/ledger", label: "the ledger" },
  { to: "/congregation", label: "the trusted circle" },
  { to: "/terminal", label: "terminal" },
  { to: "/archive", label: "the archive" },
  { to: "/lore", label: "lore" },
  { to: "/library", label: "library" },
  { to: "/transmissions", label: "transmissions" },
  { to: "/ascii-gallery", label: "ascii gallery" },
];

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
  const { status, uptime } = useKumoUptime();
  const faction = useFaction();

  return (
    <div className="min-h-screen bg-black text-[#2596be] font-mono">
      {/* Top status bar */}
      <div className="box-inv text-[10px] sm:text-xs px-3 py-1 flex flex-wrap gap-x-4 gap-y-1 justify-between uppercase tracking-widest">
        <span>● bibo is {status ? status.state : "sleeping..."}</span>
        <span>node: bnb-{status ? status.chain_id : "04"}</span>
        <span>v0.9.7-unstable</span>
        <span className="hidden sm:inline">uptime: {uptime}</span>
      </div>

      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* header */}
        <header className="box p-3 sm:p-4 mb-4 flicker">
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <Link to="/" className="block">
                <div className="text-xs dim lowercase">welcome to</div>
                <div className="uppercase tracking-[0.3em] text-lg sm:text-2xl jitter">bibo</div>
                <div className="text-xs italic lowercase dim mt-1">watching the chain so you don't have to</div>
              </Link>
            </div>
            <div className="text-right text-[10px] leading-tight shrink-0">
              <div className="dim">block #</div>
              <div>04-{Math.floor((Date.now() / 1000) % 100000).toString().padStart(5, "0")}</div>
              {faction ? <div className="box-inv mt-1 px-1">tag: {faction}</div> : null}
            </div>
          </div>
          <button
            className="sm:hidden mt-3 box w-full py-1 hover:box-inv uppercase tracking-widest text-xs"
            onClick={() => setMenuOpen((v) => !v)}
          >
            [ {menuOpen ? "close" : "menu"} ]
          </button>
        </header>

        {/* nav — stacked boxes */}
        <nav className={`mb-4 space-y-[-1px] ${menuOpen ? "block" : "hidden"} sm:block`}>
          {NAV.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMenuOpen(false)}
                className={`box block px-3 py-2 lowercase tracking-wide ${active ? "box-inv" : "hover:box-inv"}`}
              >
                <span className="dim mr-2">›</span>
                {n.label}
                {active ? <span className="ml-2">◀</span> : null}
              </Link>
            );
          })}
        </nav>

        <main className="space-y-4">{children}</main>

        <footer className="mt-8 box p-3 text-[10px] sm:text-xs dim lowercase">
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