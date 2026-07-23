import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box } from "@/components/SiteChrome";
import { RENT_LEDGER } from "@/lib/greenroom-data";

export const Route = createFileRoute("/rent")({
  head: () => ({ meta: [{ title: "staking :: green room" }, { name: "description", content: "stake with kumo. kumo shares what it earns. numbers coming soon." }] }),
  component: Rent,
});

function Rent() {
  const [staked, setStaked] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const n = parseInt(localStorage.getItem("moss:rent") || "0", 10);
    setStaked(Number.isFinite(n) ? n : 0);
  }, []);
  function stake() {
    setPending(true);
    setTimeout(() => {
      const next = staked + 1;
      setStaked(next);
      localStorage.setItem("moss:rent", String(next));
      setPending(false);
    }, 900);
  }
  function unstake() {
    if (staked <= 0) return;
    setPending(true);
    setTimeout(() => {
      const next = staked - 1;
      setStaked(next);
      localStorage.setItem("moss:rent", String(next));
      setPending(false);
    }, 900);
  }
  return (
    <>
      <Box title="staking" meta="kumo shares what it earns">
        <p className="lowercase leading-relaxed">
          stake with kumo. kumo shares what it earns. numbers coming soon.
        </p>
      </Box>

      <Box title="your position" meta="mock — kumo is counting">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="dim text-xs uppercase tracking-widest">staked</span>
          <span className="box-inv px-2 py-1 font-mono">{staked} packets</span>
          <span className="dim text-xs uppercase tracking-widest ml-2">rewards</span>
          <span className="font-mono text-xs">
            {pending ? "kumo is counting..." : staked > 0 ? "kumo is counting..." : "—"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={stake}
            disabled={pending}
            className="box px-3 py-1 hover:box-inv uppercase tracking-widest text-xs disabled:opacity-50"
          >
            [ {pending ? "kumo is counting..." : "stake 1"} ]
          </button>
          <button
            onClick={unstake}
            disabled={pending || staked <= 0}
            className="box px-3 py-1 hover:box-inv uppercase tracking-widest text-xs disabled:opacity-50"
          >
            [ {pending ? "kumo is counting..." : "unstake 1"} ]
          </button>
        </div>
        <div className="dim text-xs lowercase mt-3">
          this is a mock. no packets were moved. kumo is warming up.
        </div>
      </Box>

      <Box title="ledger" meta={`${RENT_LEDGER.length} months on file`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs lowercase">
            <thead className="dim uppercase tracking-widest">
              <tr>
                <th className="text-left py-1 pr-2">month</th>
                <th className="text-left py-1 pr-2">owed</th>
                <th className="text-left py-1 pr-2">paid</th>
                <th className="text-left py-1">note</th>
              </tr>
            </thead>
            <tbody>
              {RENT_LEDGER.map((r) => (
                <tr key={r.m} className="border-t border-[#ccff00]/30 align-top">
                  <td className="py-1 pr-2">{r.m}</td>
                  <td className="py-1 pr-2">{r.owed}</td>
                  <td className="py-1 pr-2">{r.paid}</td>
                  <td className="py-1 dim">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={pay} className="box px-3 py-1 hover:box-inv uppercase tracking-widest text-xs">
            [ pay rent ]
          </button>
          <span className="text-xs lowercase">
            you've paid rent <span className="box-inv px-1">{count}</span> times this session. thank you. the wires felt it.
          </span>
        </div>
      </Box>
      <Box title="what counts">
        <ul className="lowercase text-sm space-y-1 list-disc pl-5 marker:text-[#ccff00]">
          <li>a sincere forum post</li>
          <li>a favicon, hand-drawn</li>
          <li>one warm reply to a cold email</li>
          <li>rebooting a router, gently</li>
          <li>three minutes of listening</li>
          <li>closing one tab you love</li>
        </ul>
      </Box>
    </>
  );
}