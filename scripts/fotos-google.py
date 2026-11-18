#!/usr/bin/env python3
"""
Agendario · Traer las fotos de perfil de Google Contactos

Lee una exportación de Google Contactos (CSV «Google CSV» o vCard), descarga las fotos
y se las pone a los contactos de Agendario que coinciden (por email, teléfono o nombre).
Por defecto solo a los que NO tienen foto en Agendario.

Primero enseña lo que va a hacer; solo sube las fotos si respondes «s».
No necesita instalar nada (solo Python 3).

Uso:
  python3 fotos-google.py contacts.csv --url http://IP:3002 --email tu@correo
  Opciones:  --sobrescribir   (cambia también las fotos que ya tengan)
"""
import argparse
import csv
import getpass
import http.cookiejar
import io
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import uuid

# ---------------------------------------------------------------- utilidades


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(sorted(t for t in re.split(r"[^a-z0-9]+", s) if t))


def norm_phone(p: str):
    d = re.sub(r"\D", "", p or "")
    if d.startswith("00"):
        d = d[2:]
    if len(d) < 6:
        return None
    return d[-9:]


def unfold(text: str):
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def parse_vcards(text: str):
    """Devuelve [{uid, name, emails, phones, photo}] (photo: URL, 'embedded' o None)."""
    out, cur = [], None
    for line in unfold(text):
        if not line:
            continue
        up = line.upper()
        if up.startswith("BEGIN:VCARD"):
            cur = {"uid": None, "name": "", "emails": [], "phones": [], "photo": None}
            continue
        if up.startswith("END:VCARD"):
            if cur:
                out.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        left, value = line.split(":", 1)
        prop = left.split(";")[0].split(".")[-1].upper()
        if prop == "UID":
            cur["uid"] = value.strip()
        elif prop == "FN":
            cur["name"] = value.replace("\\,", ",").strip()
        elif prop == "EMAIL":
            cur["emails"].append(value.strip().lower())
        elif prop == "TEL":
            cur["phones"].append(value.strip())
        elif prop == "PHOTO":
            v = value.strip()
            if v.lower().startswith("http"):
                cur["photo"] = v
            elif v.lower().startswith("uri:http"):
                cur["photo"] = v[4:]
            elif v:
                cur["photo"] = "embedded"
    return out


def parse_google_csv(text: str):
    rows = list(csv.DictReader(io.StringIO(text)))
    out = []
    for r in rows:
        keys = {k.strip(): (v or "") for k, v in r.items() if k}
        name = keys.get("Name") or " ".join(
            x for x in [keys.get("First Name") or keys.get("Given Name"), keys.get("Middle Name") or keys.get("Additional Name"), keys.get("Last Name") or keys.get("Family Name")] if x
        ) or keys.get("File As", "") or keys.get("Organization Name") or keys.get("Organization 1 - Name", "")
        emails, phones = [], []
        for k, v in keys.items():
            if "Value" in k and ("E-mail" in k or "Email" in k):
                emails += [x.strip().lower() for x in v.split(":::") if x.strip()]
            if "Value" in k and "Phone" in k:
                phones += [x.strip() for x in v.split(":::") if x.strip()]
        photo = (keys.get("Photo") or "").strip()
        out.append({"uid": None, "name": name.strip(), "emails": emails, "phones": phones, "photo": photo if photo.startswith("http") else None})
    return out


# ---------------------------------------------------------------- Agendario


class Agendario:
    def __init__(self, base: str):
        self.base = base.rstrip("/") + "/api"
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, method, path, data=None, headers=None):
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        return self.op.open(r, timeout=120)

    def login(self, email, password):
        body = json.dumps({"email": email, "password": password}).encode()
        try:
            self.req("POST", "/auth/login", body, {"Content-Type": "application/json"})
        except urllib.error.HTTPError as e:
            sys.exit(f"No se ha podido entrar en Agendario ({e.code}). Revisa el email y la contraseña.")

    def contacts(self):
        text = self.req("GET", "/export/contacts.vcf").read().decode("utf-8", "replace")
        cards = parse_vcards(text)
        for c in cards:
            c["id"] = (c["uid"] or "").replace("urn:uuid:", "")
        return [c for c in cards if c["id"]]

    def upload_photo(self, contact_id, data: bytes):
        boundary = uuid.uuid4().hex
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"foto.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".encode()
            + data
            + f"\r\n--{boundary}--\r\n".encode()
        )
        self.req("PUT", f"/contacts/{contact_id}/photo", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})


def download(url: str):
    # Las fotos de Google se pueden pedir en tamaño grande cambiando el sufijo de tamaño
    big = re.sub(r"=s\d+(-[a-z]+)?$", "=s800", url) if "googleusercontent.com" in url else url
    for u in (big, url):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Agendario"}), timeout=60) as r:
                data = r.read()
                if len(data) > 500:
                    return data
        except Exception:
            continue
    return None


# ---------------------------------------------------------------- principal


def main():
    ap = argparse.ArgumentParser(description="Trae a Agendario las fotos de una exportación de Google Contactos.")
    ap.add_argument("fichero", help="Exportación de Google Contactos (.csv «Google CSV» o .vcf)")
    ap.add_argument("--url", required=True, help="Dirección de Agendario, p. ej. http://192.168.1.50:3002")
    ap.add_argument("--email", required=True, help="Tu usuario de Agendario")
    ap.add_argument("--sobrescribir", action="store_true", help="Cambiar también las fotos que ya existan")
    a = ap.parse_args()

    text = open(a.fichero, encoding="utf-8-sig", errors="replace").read()
    google = parse_vcards(text) if "BEGIN:VCARD" in text[:2000].upper() else parse_google_csv(text)
    with_photo = [g for g in google if g["photo"] and g["photo"] != "embedded"]
    print(f"En el fichero de Google hay {len(google)} contactos; {len(with_photo)} con foto.")
    if not with_photo:
        sys.exit("No hay enlaces de fotos en el fichero. Exporta desde contacts.google.com → Exportar → «Google CSV».")

    ag = Agendario(a.url)
    ag.login(a.email, getpass.getpass("Contraseña de Agendario: "))
    mine = ag.contacts()
    print(f"En Agendario hay {len(mine)} contactos.")

    by_email, by_phone, by_name = {}, {}, {}
    for c in mine:
        for e in c["emails"]:
            by_email.setdefault(e, c)
        for p in c["phones"]:
            n = norm_phone(p)
            if n:
                by_phone.setdefault(n, c)
        if c["name"]:
            by_name.setdefault(norm_name(c["name"]), c)

    plan, unmatched, skipped, used = [], [], 0, set()
    for g in with_photo:
        hit = next((by_email[e] for e in g["emails"] if e in by_email), None)
        hit = hit or next((by_phone[n] for n in (norm_phone(p) for p in g["phones"]) if n and n in by_phone), None)
        hit = hit or by_name.get(norm_name(g["name"]))
        if not hit:
            unmatched.append(g["name"] or (g["emails"] or g["phones"] or ["?"])[0])
            continue
        if hit["id"] in used:
            continue
        if hit["photo"] and not a.sobrescribir:
            skipped += 1
            continue
        used.add(hit["id"])
        plan.append((g, hit))

    print()
    print(f"Se pondrá foto a {len(plan)} contactos de Agendario.")
    print(f"Ya tienen foto (no se tocan): {skipped}" + ("" if not skipped else "  · usa --sobrescribir para cambiarlas"))
    print(f"Sin pareja en Agendario: {len(unmatched)}")
    for g, c in plan[:15]:
        print(f"   {g['name'] or '?'}  →  {c['name']}")
    if len(plan) > 15:
        print(f"   … y {len(plan) - 15} más")
    if unmatched:
        print("Sin pareja (primeros 15): " + ", ".join(unmatched[:15]))
    if not plan:
        return
    if input("\n¿Subir las fotos? (s/N): ").strip().lower() != "s":
        print("No se ha cambiado nada.")
        return

    ok = fail = 0
    for i, (g, c) in enumerate(plan, 1):
        data = download(g["photo"])
        if not data:
            fail += 1
            print(f"  [{i}/{len(plan)}] {c['name']}: no se ha podido descargar la foto")
            continue
        try:
            ag.upload_photo(c["id"], data)
            ok += 1
            print(f"  [{i}/{len(plan)}] {c['name']}: ✓")
        except urllib.error.HTTPError as e:
            fail += 1
            print(f"  [{i}/{len(plan)}] {c['name']}: error {e.code}")
    print(f"\nHecho: {ok} fotos puestas, {fail} con problemas.")
    print("Cada cambio queda en el Historial del contacto. Si sincronizas con Fastmail, las fotos se enviarán en la próxima sincronización.")


if __name__ == "__main__":
    main()
