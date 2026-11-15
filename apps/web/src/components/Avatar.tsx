import { photoUrl } from "../lib/api";
import { initials } from "../lib/format";

const palette = ["bg-indigo-600", "bg-sky-600", "bg-violet-600", "bg-rose-600", "bg-amber-600", "bg-emerald-600"];

export function Avatar({
  id, name, hasPhoto, size = 40, version,
}: { id: string; name: string; hasPhoto: boolean; size?: number; version?: string }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (hasPhoto) {
    return (
      <img
        src={photoUrl(id, size > 96 ? "full" : "thumb", version)}
        alt=""
        loading="lazy"
        decoding="async"
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  const color = palette[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % palette.length];
  return (
    <div style={style} className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color}`}>
      {initials(name) || "?"}
    </div>
  );
}
