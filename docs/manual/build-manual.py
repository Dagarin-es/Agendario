"""
Manual en PDF: no hay fuente del manual original (1.1.0). Este script toma ese PDF (commit 79ae2e6,
`git show 79ae2e6:apps/web/public/manual/Agendario-Manual.pdf > base-1.1.pdf`), cambia la versión de la
portada y de los pies de página, corrige «20m» → «30m» (Nginx Proxy Manager) y le añade los capítulos 9 a 14
(capitulo9.html … capitulo14.html, hechos con Chromium).
Uso:  python3 docs/manual/build-manual.py base-1.1.pdf apps/web/public/manual/Agendario-Manual.pdf
Necesita playwright (Chromium), pypdf y la fuente Inter Display. Al cambiar de versión, edita la versión aquí (VERSION) y en los pies de capitulo9…14.html.
"""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
BASE, OUT = sys.argv[1], sys.argv[2]
TMP = tempfile.mkdtemp()
VERSION = "1.4.1"
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME") or None); pg = b.new_page()
    for ch in ("capitulo9", "capitulo10", "capitulo11", "capitulo12", "capitulo13", "capitulo14"):
        pg.goto("file://" + os.path.join(HERE, ch + ".html")); pg.wait_for_timeout(500)
        pg.pdf(path=os.path.join(TMP, ch + ".pdf"), width="8.2767in", height="11.7067in", print_background=True, margin={"top":"0","bottom":"0","left":"0","right":"0"})
    # «client_max_body_size 20m;» → «30m;» (capítulo 2, página 8, bloque oscuro; y tabla de problemas, página 40)
    mono = "font-family:'DejaVu Sans Mono';position:absolute;white-space:pre"
    pg.set_content(f'''<html><body style="margin:0"><div style="position:absolute;left:191pt;top:593.5pt;width:22pt;height:11.5pt;background:rgb(30,27,58)"></div>
    <div style="{mono};left:191.68pt;top:593.3pt;font-size:8.4pt;line-height:12pt;color:rgb(241,242,255)">30m;</div></body></html>''')
    pg.pdf(path=os.path.join(TMP, "fix8.pdf"), width="8.2767in", height="11.7067in", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
    pg.set_content(f'''<html><body style="margin:0"><div style="position:absolute;left:264.3pt;top:341.6pt;width:21.6pt;height:10.2pt;background:rgb(242,243,248)"></div>
    <div style="{mono};left:264.77pt;top:340.9pt;font-size:8.6pt;line-height:12.3pt;color:rgb(30,27,58)">30m;</div></body></html>''')
    pg.pdf(path=os.path.join(TMP, "fix40.pdf"), width="8.2767in", height="11.7067in", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
    # Parches: portada y pies de página «1.1.0» → «1.2.0»
    pg.set_content(f'''<html><body style="margin:0"><div style="position:absolute;left:132.3pt;top:728.6pt;width:118pt;height:15pt;background:linear-gradient(90deg,rgb(255,252,242),rgb(255,251,240) 60%,rgb(253,249,238))"></div>
    <div style="position:absolute;left:132.8pt;top:727.2pt;font-family:'Inter Display';font-size:11.25pt;line-height:17.9pt;color:rgb(91,95,119);letter-spacing:.1pt">{VERSION} · Noviembre de 2026</div></body></html>''')
    pg.pdf(path=os.path.join(TMP, "cover.pdf"), width="8.2767in", height="11.7067in", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
    pg.set_content(f'''<html><body style="margin:0"><div style="position:absolute;left:118pt;top:816pt;width:18pt;height:15pt;background:#fff"></div>
    <div style="position:absolute;left:119.2pt;top:817.9pt;font-family:'Inter Display';font-size:8.1pt;line-height:12.8pt;color:rgb(91,95,119);letter-spacing:.1pt">{VERSION}</div></body></html>''')
    pg.pdf(path=os.path.join(TMP, "foot.pdf"), width="8.2767in", height="11.7067in", margin={"top":"0","bottom":"0","left":"0","right":"0"}, print_background=True)
    b.close()
from pypdf import PdfReader, PdfWriter
src = PdfReader(BASE)
cover = PdfReader(os.path.join(TMP, "cover.pdf")).pages[0]; foot = PdfReader(os.path.join(TMP, "foot.pdf")).pages[0]
w = PdfWriter()
fixes = {7: PdfReader(os.path.join(TMP, "fix8.pdf")).pages[0], 39: PdfReader(os.path.join(TMP, "fix40.pdf")).pages[0]}
for i, page in enumerate(src.pages):
    page.merge_page(cover if i == 0 else foot)
    if i in fixes: page.merge_page(fixes[i])
    w.add_page(page)
for pg_ in w.pages: pg_.compress_content_streams()
for ch in ("capitulo9", "capitulo10", "capitulo11", "capitulo12", "capitulo13", "capitulo14"):
    for page in PdfReader(os.path.join(TMP, ch + ".pdf")).pages: w.add_page(page)
w.add_metadata({"/Title": f"Agendario · Manual de instalación y uso {VERSION}", "/Author": "Agendario"})
w.compress_identical_objects(remove_identicals=True, remove_orphans=True)
w.write(OUT)
print(len(w.pages))
