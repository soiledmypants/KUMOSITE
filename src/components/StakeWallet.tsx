import { useState } from "react";

// Single swap-in point for real wallet logic (wagmi/viem) once kumo's staking
// pool contract is live — the staking page only renders <StakeWallet />.
export function StakeWallet() {
  const [status, setStatus] = useState<string | null>(null);

  function connect() {
    setStatus("kumo's staking pool isn't deployed yet. kumo is still building it. soon.");
  }

  return (
    <div>
      <button onClick={connect} className="box px-4 py-2 lowercase tracking-widest hover:box-inv">
        [ connect wallet ]
      </button>
      {status ? (
        <div role="status" className="mt-2 text-xs lowercase dim">
          {status}
        </div>
      ) : null}
    </div>
  );
}
