import type { User } from "@agendario/shared";
import { apiUrl } from "../lib/api";
import { initials } from "../lib/format";

/** Foto de perfil del usuario (la suya o la de «mi ficha»); si no hay, sus iniciales. */
export function UserAvatar({ me, size = 32, className = "" }: { me: User | null | undefined; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (me?.avatar) {
    return <img src={apiUrl(`/auth/avatar?size=${size > 96 ? "full" : "thumb"}&v=${me.avatar}`)} alt="" style={{ ...style, background: "#f1f5f9" }} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <span style={style} className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-700 font-semibold text-white ${className}`} aria-hidden="true">
      {initials(me?.name ?? "") || "?"}
    </span>
  );
}
