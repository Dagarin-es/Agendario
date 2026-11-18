import { useMemo, useState } from "react";

/** Emojis por categoría con palabras para buscar (en español). Además se puede escribir o pegar cualquiera. */
const CATS: { name: string; icon: string; items: [string, string][] }[] = [
  {
    name: "Celebraciones", icon: "🎉",
    items: [["🎂", "tarta cumpleaños pastel"], ["🎉", "fiesta celebrar confeti"], ["🎊", "confeti fiesta"], ["🎁", "regalo"], ["🎈", "globo fiesta"], ["🥳", "fiesta cara celebrar"], ["🍾", "champán botella brindis"], ["🥂", "brindis copas"], ["🍰", "pastel tarta"], ["🧁", "magdalena cupcake"], ["🎆", "fuegos artificiales"], ["🎇", "bengala"], ["✨", "brillo estrellas"], ["🎀", "lazo"], ["🪅", "piñata"], ["🕯️", "vela"], ["🎄", "navidad árbol"], ["🎃", "halloween calabaza"], ["🐣", "pascua pollito"], ["🎓", "graduación estudios"], ["🏆", "trofeo premio"], ["🥇", "medalla oro"], ["🎖️", "medalla"], ["👶", "bebé nacimiento"], ["🍼", "biberón bebé"], ["🤰", "embarazo"]],
  },
  {
    name: "Amor y familia", icon: "❤️",
    items: [["❤️", "corazón amor rojo"], ["🧡", "corazón naranja"], ["💛", "corazón amarillo"], ["💚", "corazón verde"], ["💙", "corazón azul"], ["💜", "corazón morado"], ["🖤", "corazón negro luto"], ["🤍", "corazón blanco"], ["💕", "corazones amor"], ["💖", "corazón brillo"], ["💘", "corazón flecha"], ["💍", "anillo boda compromiso"], ["💒", "boda iglesia"], ["👰", "novia boda"], ["🤵", "novio boda"], ["💐", "ramo flores"], ["🌹", "rosa flor"], ["🌷", "tulipán flor"], ["🌻", "girasol flor"], ["🌸", "flor cerezo"], ["💏", "beso pareja"], ["💑", "pareja"], ["👪", "familia"], ["👨‍👩‍👧", "familia hija"], ["👵", "abuela"], ["👴", "abuelo"], ["🤱", "madre bebé"], ["🫶", "manos corazón cariño"], ["🤗", "abrazo"], ["😘", "beso"]],
  },
  {
    name: "Recuerdos", icon: "🕊️",
    items: [["🕊️", "paloma paz recuerdo"], ["🙏", "rezar gracias oración"], ["⛪", "iglesia"], ["✝️", "cruz"], ["🪦", "tumba fallecimiento"], ["🥀", "flor marchita luto"], ["⭐", "estrella"], ["🌟", "estrella brillante"], ["🌙", "luna"], ["🌈", "arcoíris"], ["😇", "ángel santo"], ["📿", "rosario"], ["🕍", "sinagoga"], ["🕌", "mezquita"], ["☮️", "paz"]],
  },
  {
    name: "Trabajo y hitos", icon: "💼",
    items: [["💼", "trabajo maletín"], ["🏢", "oficina empresa"], ["🏠", "casa hogar"], ["🏡", "casa jardín mudanza"], ["🔑", "llave casa"], ["🚗", "coche"], ["🏍️", "moto"], ["✈️", "avión viaje"], ["🧳", "maleta viaje"], ["🏖️", "playa vacaciones"], ["⛰️", "montaña"], ["🗺️", "mapa viaje"], ["📅", "calendario fecha"], ["📌", "chincheta"], ["📝", "nota"], ["📚", "libros estudios"], ["💻", "ordenador portátil"], ["🖥️", "ordenador mac"], ["📱", "móvil teléfono"], ["🎮", "videojuego consola"], ["📷", "cámara foto"], ["🎵", "música"], ["🎸", "guitarra"], ["⚽", "fútbol"], ["🏀", "baloncesto"], ["🎾", "tenis"], ["🚴", "bici ciclismo"], ["🏃", "correr"], ["🏊", "nadar piscina"], ["🧘", "yoga"], ["🩺", "médico salud"], ["💉", "vacuna"], ["🏥", "hospital"], ["💶", "dinero euro"], ["📈", "subida gráfico"], ["🤝", "acuerdo trato"]],
  },
  {
    name: "Comida", icon: "🍽️",
    items: [["🍽️", "comida cena"], ["🍷", "vino"], ["🍺", "cerveza"], ["🍻", "cervezas brindis"], ["☕", "café"], ["🍕", "pizza"], ["🍔", "hamburguesa"], ["🥘", "paella"], ["🍣", "sushi"], ["🍝", "pasta"], ["🥗", "ensalada"], ["🍫", "chocolate"], ["🍦", "helado"], ["🍓", "fresa"], ["🍎", "manzana"], ["🥐", "cruasán"]],
  },
  {
    name: "Animales", icon: "🐶",
    items: [["🐶", "perro"], ["🐱", "gato"], ["🐰", "conejo"], ["🐹", "hámster"], ["🐦", "pájaro"], ["🐠", "pez"], ["🐴", "caballo"], ["🐢", "tortuga"], ["🦋", "mariposa"], ["🐾", "huellas mascota"]],
  },
  {
    name: "Caras", icon: "😀",
    items: [["😀", "sonrisa feliz"], ["😃", "alegre"], ["😄", "risa"], ["😂", "llorar de risa"], ["😊", "contento"], ["😍", "enamorado"], ["🥰", "amor cariño"], ["😎", "gafas guay"], ["🤩", "estrellas ilusión"], ["😴", "dormir"], ["🤓", "empollón"], ["😢", "triste llorar"], ["😮", "sorpresa"], ["🤔", "pensar"], ["😜", "broma"], ["🙃", "al revés"]],
  },
  {
    name: "Símbolos", icon: "🔔",
    items: [["🔔", "aviso campana"], ["⏰", "alarma reloj"], ["⚠️", "atención aviso"], ["✅", "hecho ok"], ["❗", "importante"], ["❓", "pregunta"], ["💡", "idea"], ["🔥", "fuego"], ["💯", "cien"], ["🍀", "suerte trébol"], ["🎯", "diana objetivo"], ["🚀", "cohete"], ["💎", "diamante"], ["👑", "corona rey reina"], ["🌍", "mundo tierra"], ["☀️", "sol verano"], ["❄️", "nieve invierno"], ["🍂", "otoño hoja"], ["🌱", "primavera planta"]],
  },
];

const RECENT_KEY = "agendario.emoji-recent";
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Selector de emoji: buscador, recientes, categorías y escribir/pegar cualquiera. */
export function EmojiPicker({ value, onPick, onClear }: { value?: string; onPick: (e: string) => void; onClear?: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(0);
  const recent = useMemo(loadRecent, []);
  const pick = (e: string) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...loadRecent().filter((x) => x !== e)].slice(0, 16)));
    } catch {
      /* nada */
    }
    onPick(e);
  };
  // Si lo escrito ya es un emoji (teclado de emojis o pegado), se ofrece tal cual
  const typedEmoji = /\p{Extended_Pictographic}/u.test(q) ? q.trim() : "";
  const results = q && !typedEmoji ? CATS.flatMap((c) => c.items).filter(([, k]) => norm(k).includes(norm(q))).map(([e]) => e) : null;
  const cell = (e: string) => (
    <button key={e} type="button" className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-slate-100 ${value === e ? "bg-indigo-100 ring-1 ring-indigo-300" : ""}`} onClick={() => pick(e)} title={e}>
      {e}
    </button>
  );
  return (
    <span className="block w-[17.5rem] max-w-full">
      <input className="input mb-2 py-1.5 text-sm" placeholder="Buscar (tarta, coche…) o escribir un emoji" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {typedEmoji ? (
        <button type="button" className="btn-primary mb-2 w-full" onClick={() => pick(typedEmoji)}>Usar {typedEmoji}</button>
      ) : results ? (
        <span className="grid max-h-52 grid-cols-7 gap-0.5 overflow-y-auto">{results.length ? results.map(cell) : <span className="col-span-7 py-3 text-center text-xs text-slate-400">Nada con «{q}». Escribe o pega el emoji directamente.</span>}</span>
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">Recientes</span>
              <span className="mb-2 grid grid-cols-7 gap-0.5">{recent.slice(0, 7).map(cell)}</span>
            </>
          )}
          <span className="mb-1 flex gap-0.5 overflow-x-auto border-b border-slate-100 pb-1">
            {CATS.map((c, i) => (
              <button key={c.name} type="button" title={c.name} onClick={() => setCat(i)} className={`shrink-0 rounded-lg px-1.5 py-1 text-lg ${cat === i ? "bg-indigo-100" : "opacity-60 hover:opacity-100"}`}>{c.icon}</button>
            ))}
          </span>
          <span className="mb-1 block text-[11px] font-medium text-slate-500">{CATS[cat]!.name}</span>
          <span className="grid max-h-48 grid-cols-7 gap-0.5 overflow-y-auto">{CATS[cat]!.items.map(([e]) => cell(e))}</span>
        </>
      )}
      {value && onClear && <button type="button" className="mt-2 text-xs text-slate-500 hover:underline" onClick={onClear}>Quitar emoji</button>}
    </span>
  );
}
