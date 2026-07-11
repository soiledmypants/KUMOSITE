import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box } from "@/components/SiteChrome";
import { RENT_LEDGER } from "@/lib/greenroom-data";

export const Route = createFileRoute("/rent")({
  head: () => ({ meta: [{ title: "the rent :: green room" }, { name: "description", content: "what the green room owes the internet, monthly." }] }),
  component: Rent,
});

function Rent() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const n = parseInt(localStorage.getItem("moss:rent") || "0", 10);
    setCount(Number.isFinite(n) ? n : 0);
  }, []);
  function pay() {
    const next = count + 1;
    setCount(next);
    localStorage.setItem("moss:rent", String(next));
  }
  return (
    <>
      <Box title="the rent" meta="ledger">
        <p className="lowercase leading-relaxed">
          the green room owes the internet, quietly, every month. we pay in offerings. cash is not accepted. cash never
          was.
        </p>
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