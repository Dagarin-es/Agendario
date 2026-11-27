import { useState } from "react";
import type { GiftIdea, GiftReceived } from "@agendario/shared";
import { MiniTabs } from "./GiftExtras";
import { GiftIdeas, GivenGifts } from "./Gifts";
import { GiftsReceived } from "./GiftsReceived";

type Tab = "ideas" | "regalados" | "recibidos";

/** Recuadro «Regalos» de la ficha: tres pestañas (Ideas · Regalados · Recibidos). Todo es personal de cada usuario. */
export function GiftsBox({ contactId, contactName, ideas, received }: { contactId: string; contactName: string; ideas: GiftIdea[]; received: GiftReceived[] }) {
  const [tab, setTab] = useState<Tab>("ideas");
  const open = ideas.filter((i) => i.status !== "given").length;
  const given = ideas.length - open;
  return (
    <section className="card">
      <h2 className="section-title">🎁 Regalos</h2>
      <MiniTabs<Tab>
        label="Regalos"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "ideas", emoji: "💡", label: "Ideas", count: open },
          { id: "regalados", emoji: "✅", label: "Regalados", count: given },
          { id: "recibidos", emoji: "🎀", label: "Recibidos", count: received.length },
        ]}
      />
      <div className="mt-3">
        {tab === "ideas" && <GiftIdeas contactId={contactId} ideas={ideas} />}
        {tab === "regalados" && <GivenGifts contactId={contactId} ideas={ideas} />}
        {tab === "recibidos" && <GiftsReceived contactId={contactId} contactName={contactName} gifts={received} />}
      </div>
    </section>
  );
}
