import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import type { DuplicateMode, ImportResult, Tag } from "@agendario/shared";
import { useTags } from "../components/Tags";
import { api } from "../lib/api";

type Loaded = { files: string[]; cards: string[]; bytes: number };

const MAX_CARDS_PER_BATCH = 200;
const MAX_CHARS_PER_BATCH = 8_000_000; // ~8 MB por petición (las fotos ocupan mucho)

/** Lee el fichero como UTF-8 y, si no lo es (Outlook antiguo…), como Windows-1252. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf);
  }
  return text.replace(/^﻿/, "");
}

const isVcf = (f: File) => /\.(vcf|vcard)$/i.test(f.name) || f.type === "text/vcard" || f.type === "text/x-vcard";

function batches(cards: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const c of cards) {
    if (cur.length && (cur.length >= MAX_CARDS_PER_BATCH || size + c.length > MAX_CHARS_PER_BATCH)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += c.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

const today = () => new Date().toLocaleDateString("es-ES");

export function ImportPage() {
  const qc = useQueryClient();
  const { data: tags } = useTags();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tagMode, setTagMode] = useState<"new" | "existing" | "none">("new");
  const [newTagName, setNewTagName] = useState(`Importado ${today()}`);
  const [existingTag, setExistingTag] = useState("");
  const [categoriesAsTags, setCategoriesAsTags] = useState(true);
  const [onDuplicate, setOnDuplicate] = useState<DuplicateMode>("skip");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(ImportResult & { tagId: string | null }) | null>(null);
  const [error, setError] = useState("");

  async function load(list: FileList | null) {
    setResult(null);
    setError("");
    const files = [...(list ?? [])].filter(isVcf);
    if (!files.length) {
      setLoaded(null);
      setError("No hay ningún fichero .vcf en lo que has elegido.");
      return;
    }
    const cards: string[] = [];
    let bytes = 0;
    for (const f of files) {
      bytes += f.size;
      const found = (await readText(f)).match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
      cards.push(...found);
    }
    setLoaded({ files: files.map((f) => f.webkitRelativePath || f.name), cards, bytes });
    if (filesRef.current) filesRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }

  async function run() {
    if (!loaded?.cards.length) return;
    setError("");
    setResult(null);
    try {
      let tagId: string | null = null;
      if (tagMode === "new" && newTagName.trim()) {
        const existing = tags?.find((t) => t.name.toLowerCase() === newTagName.trim().toLowerCase());
        tagId = existing?.id ?? (await api.post<Tag>("/tags", { name: newTagName.trim(), color: "amber" })).id;
      } else if (tagMode === "existing" && existingTag) tagId = existingTag;

      const total: ImportResult & { tagId: string | null } = { created: 0, updated: 0, skipped: 0, failed: [], tagId };
      const parts = batches(loaded.cards);
      setProgress({ done: 0, total: loaded.cards.length });
      let done = 0;
      for (const cards of parts) {
        const r = await api.post<ImportResult>("/import/vcard", {
          cards,
          tagIds: tagId ? [tagId] : [],
          categoriesAsTags,
          onDuplicate,
        });
        total.created += r.created;
        total.updated += r.updated;
        total.skipped += r.skipped;
        total.failed.push(...r.failed);
        done += cards.length;
        setProgress({ done, total: loaded.cards.length });
      }
      setResult(total);
      setLoaded(null);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const busy = !!progress;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1).replace(".", ",");

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Importar contactos</h1>
      <p className="text-sm text-slate-500">
        Admite ficheros .vcf (vCard 2.1, 3.0 y 4.0) exportados de Google Contacts, iCloud/Mac/iPhone, Android, Outlook, Nextcloud… con sus fotos.
      </p>

      {/* 1. Elegir ficheros */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">1. Elige qué importar</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn rounded-xl border-2 border-dashed border-slate-300 py-6 hover:border-indigo-500 hover:bg-indigo-50" disabled={busy} onClick={() => filesRef.current?.click()}>
            📄 Uno o varios ficheros .vcf
          </button>
          <button className="btn rounded-xl border-2 border-dashed border-slate-300 py-6 hover:border-indigo-500 hover:bg-indigo-50" disabled={busy} onClick={() => folderRef.current?.click()}>
            📁 Una carpeta entera
          </button>
        </div>
        <input ref={filesRef} type="file" multiple accept=".vcf,.vcard,text/vcard,text/x-vcard" hidden onChange={(e) => load(e.target.files)} />
        <input ref={folderRef} type="file" hidden onChange={(e) => load(e.target.files)} {...{ webkitdirectory: "", directory: "" }} />
        <p className="text-xs text-slate-400">Con «carpeta» se importan todos los .vcf que contenga, incluidas las subcarpetas. En el móvil, usa la opción de ficheros.</p>

        {loaded && (
          <div className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
            <strong>{loaded.cards.length} contactos</strong> en {loaded.files.length} {loaded.files.length === 1 ? "fichero" : "ficheros"} ({mb(loaded.bytes)} MB)
            {loaded.files.length <= 5 && <div className="mt-1 text-xs text-indigo-700">{loaded.files.join(" · ")}</div>}
          </div>
        )}
      </section>

      {/* 2. Opciones */}
      {loaded && loaded.cards.length > 0 && (
        <section className="card space-y-4">
          <h2 className="section-title mb-0">2. Opciones</h2>

          <div className="space-y-2">
            <label className="label">Etiqueta para todos los contactos importados</label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={tagMode === "new"} onChange={() => setTagMode("new")} />
              Nueva:
              <input className="input" value={newTagName} onChange={(e) => { setNewTagName(e.target.value); setTagMode("new"); }} />
            </label>
            {tags && tags.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={tagMode === "existing"} onChange={() => setTagMode("existing")} />
                Existente:
                <select className="input" value={existingTag} onChange={(e) => { setExistingTag(e.target.value); setTagMode("existing"); }}>
                  <option value="">Elegir…</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={tagMode === "none"} onChange={() => setTagMode("none")} />
              Sin etiqueta
            </label>
            <p className="text-xs text-slate-400">Consejo: con una etiqueta propia, si la prueba no te convence, puedes borrar de golpe todo lo importado desde «Etiquetas → Borrar con contactos».</p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={categoriesAsTags} onChange={(e) => setCategoriesAsTags(e.target.checked)} />
            <span>Convertir los grupos/categorías del fichero en etiquetas <span className="text-slate-400">(campo CATEGORIES, p. ej. los grupos de Google o iCloud)</span></span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Si un contacto ya existe</label>
              <select className="input" value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as DuplicateMode)}>
                <option value="skip">Saltarlo</option>
                <option value="update">Actualizarlo con los datos del fichero</option>
                <option value="duplicate">Importarlo igualmente (duplicado)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">Se considera el mismo si coincide el UID del vCard o, si no lo tiene, el nombre y un email o teléfono.</p>
            </div>
          </div>

          <button className="btn-primary w-full" disabled={busy || (tagMode === "existing" && !existingTag)} onClick={run}>
            {busy ? "Importando…" : `Importar ${loaded.cards.length} contactos`}
          </button>
        </section>
      )}

      {progress && (
        <div className="card">
          <div className="mb-2 text-sm">Importando {progress.done} de {progress.total}…</div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <section className="card space-y-3">
          <h2 className="section-title mb-0">Resultado</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 p-3"><div className="text-2xl font-semibold text-emerald-700">{result.created}</div><div className="text-xs text-emerald-800">nuevos</div></div>
            <div className="rounded-lg bg-sky-50 p-3"><div className="text-2xl font-semibold text-sky-700">{result.updated}</div><div className="text-xs text-sky-800">actualizados</div></div>
            <div className="rounded-lg bg-slate-100 p-3"><div className="text-2xl font-semibold text-slate-700">{result.skipped}</div><div className="text-xs text-slate-600">saltados</div></div>
          </div>
          {result.failed.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700">{result.failed.length} no se han podido importar</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {result.failed.map((f, i) => <li key={i}><strong>{f.name}</strong>: {f.error}</li>)}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to={result.tagId ? `/?tag=${result.tagId}` : "/"} className="btn-primary">Ver contactos importados</Link>
            <button className="btn-ghost" onClick={() => setResult(null)}>Importar más</button>
          </div>
        </section>
      )}
    </div>
  );
}
