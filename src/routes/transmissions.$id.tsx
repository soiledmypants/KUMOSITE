import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Box, Tag } from "@/components/SiteChrome";
import { TRANSMISSIONS } from "@/lib/greenroom-data";

export const Route = createFileRoute("/transmissions/$id")({
  loader: ({ params }) => {
    const t = TRANSMISSIONS.find((x) => x.id === params.id);
    if (!t) throw notFound();
    return t;
  },
  head: ({ loaderData }) =>
    loaderData
      ? { meta: [{ title: `${loaderData.type} ${loaderData.n} — ${loaderData.title}` }, { name: "description", content: loaderData.teaser }] }
      : { meta: [{ title: "transmission not found" }, { name: "robots", content: "noindex" }] },
  component: Detail,
  notFoundComponent: NotFoundTx,
});

function NotFoundTx() {
  return (
    <Box title="not filed" meta="404">
      <p className="lowercase">this transmission fell off the shelf. it may return.</p>
      <Link to="/transmissions" className="box inline-block px-2 py-1 mt-2 hover:box-inv">[ back ]</Link>
    </Box>
  );
}

function Typewriter({ text }: { text: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= text.length) return;
    const id = setTimeout(() => setI((v) => v + 1), 14);
    return () => clearTimeout(id);
  }, [i, text]);
  return (
    <span>
      {text.slice(0, i)}
      {i < text.length ? <span className="cursor-blink">█</span> : null}
    </span>
  );
}

function Detail() {
  const t = Route.useLoaderData();
  const parts: string[] = t.body.split("\n\n");
  const first = parts[0] ?? "";
  const rest = parts.slice(1);
  return (
    <>
      <Box title={`${t.type} ${t.n}`} meta={t.date}>
        <div className="uppercase tracking-widest">{t.title}</div>
        <div className="mt-1 text-xs dim lowercase">{t.teaser}</div>
      </Box>
      <div className="box p-4">
        <div className="box-inv px-2 py-1 text-[10px] uppercase tracking-widest mb-3 flex justify-between">
          <span>moss@greenroom:~$ cat {t.id}.log</span>
          <span>● live</span>
        </div>
        <p className="lowercase leading-relaxed whitespace-pre-line"><Typewriter text={first} /></p>
        {rest.map((p: string, i: number) => (
          <p key={i} className="lowercase leading-relaxed whitespace-pre-line mt-3">{p}</p>
        ))}
      </div>
      <div className="text-center">
        <Link to="/transmissions" className="box inline-block px-3 py-1 hover:box-inv">[ back to transmissions ]</Link>
      </div>
      <div className="text-xs dim text-center lowercase"><Tag>{t.type}</Tag> filed by moss, delivered by the wire</div>
    </>
  );
}