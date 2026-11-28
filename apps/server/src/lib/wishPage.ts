/**
 * Página pública de las listas de deseos (la que abren los invitados con su enlace personal).
 * Una sola página, sin recursos de terceros (ni fuentes de Google ni analíticas) y sin cookies.
 * El código del enlace va detrás de «#» y se manda en la cabecera X-Lista-Token.
 * Todo lo que escriben los invitados se pinta como texto (textContent), nunca como HTML.
 */

const ICON = `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="22" fill="#4338CA"/><rect x="22" y="16" width="44" height="64" rx="6" fill="#fff"/><rect x="66" y="20" width="12" height="14" rx="3" fill="#FCD34D"/><rect x="66" y="38" width="12" height="14" rx="3" fill="#A5B4FC"/><rect x="66" y="56" width="12" height="14" rx="3" fill="#F9A8D4"/><circle cx="44" cy="36" r="8" fill="#4338CA"/><path d="M30 60 Q44 44 58 60 Z" fill="#4338CA"/></svg>`;

export const WISH_FAVICON = ICON.replace('aria-hidden="true"', 'xmlns="http://www.w3.org/2000/svg"');

const CSS = String.raw`
:root{--ind:#4338ca;--ind-d:#312e81;--ind-l:#eef0ff;--ink:#1e1b3a;--mut:#5b5f77;--line:#e4e6f0;--green:#047857;--green-l:#e7f8ef;--amber:#92400e;--amber-l:#fff4d6}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:linear-gradient(180deg,#eef0ff 0,#fafbff 260px) no-repeat,#fafbff;line-height:1.45;font-size:16px;-webkit-font-smoothing:antialiased;min-height:100vh}
.wrap{max-width:640px;margin:0 auto;padding:18px 14px 40px}
.brand{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--ind)}
.brand svg{width:20px;height:20px}
h1{font-size:clamp(23px,6vw,30px);font-weight:800;letter-spacing:-.02em;margin:10px 0 4px;line-height:1.15}
.sub{color:var(--mut);font-size:14.5px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-top:12px}
.hi{display:flex;gap:10px;align-items:flex-start;font-size:14.5px}
.hi .e{font-size:22px;line-height:1}
.alert{background:#fff7e0;border:1px solid #fde68a;border-radius:16px;padding:12px 14px;margin-top:12px;font-size:14.5px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.item{background:#fff;border:1px solid var(--line);border-radius:16px;margin-top:10px;padding:12px;display:flex;gap:12px}
.item.taken{opacity:.78}
.thumb{width:64px;height:64px;border-radius:14px;flex-shrink:0;background:linear-gradient(135deg,#e0e7ff,#fbcfe8);display:grid;place-items:center;font-size:28px;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover}
.grow{flex:1;min-width:0}
.t{font-weight:700;overflow-wrap:anywhere}
.m{font-size:13.5px;color:var(--mut);overflow-wrap:anywhere}
.m a{color:var(--ind);font-weight:600;text-decoration:none}
.note{font-size:13.5px;color:var(--mut);margin-top:3px;font-style:italic;overflow-wrap:anywhere}
.st{margin-top:8px;font-size:13.5px;font-weight:700;border-radius:10px;padding:7px 10px;display:inline-flex;align-items:center;gap:6px}
.st.done{background:var(--green-l);color:var(--green)}
.st.multi{background:var(--amber-l);color:var(--amber)}
.st.mine{background:var(--ind-l);color:var(--ind)}
.st.gray{background:#f1f2f6;color:var(--mut)}
button{font:inherit;cursor:pointer;border:0;border-radius:12px;padding:9px 13px;font-weight:700;font-size:14.5px}
.b-p{background:var(--ind);color:#fff}
.b-g{background:#fff;border:1px solid var(--line);color:var(--ink)}
.b-link{background:none;color:var(--ind);padding:4px 0;font-weight:600;font-size:13.5px}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.foot{margin-top:22px}
.app{background:linear-gradient(150deg,var(--ind),#6d28d9);color:#fff;border-radius:20px;padding:16px;margin-top:16px}
.app h2{font-size:18px;font-weight:800;margin:6px 0 4px}
.app p{font-size:14.5px;opacity:.92}
.app .b-w{background:#fff;color:var(--ind);margin-top:12px;width:100%;padding:13px;font-size:15.5px}
.app a{color:#fff;font-size:13.5px;font-weight:600;display:inline-block;margin-top:10px}
.back{position:fixed;inset:0;background:rgba(15,13,40,.45);display:flex;align-items:flex-end;justify-content:center;z-index:10}
.sheet{background:#fff;border-radius:22px 22px 0 0;width:100%;max-width:640px;max-height:88vh;overflow:auto;padding:10px 18px calc(20px + env(safe-area-inset-bottom))}
.grab{width:40px;height:5px;border-radius:3px;background:#d4d6e2;margin:0 auto 12px}
.sheet h3{font-size:19px;font-weight:800;overflow-wrap:anywhere}
.opt{border:2px solid var(--line);border-radius:14px;padding:11px 13px;margin-top:10px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;width:100%;text-align:left;background:#fff;font-weight:400}
.opt.on{border-color:var(--ind);background:var(--ind-l)}
.radio{width:20px;height:20px;border-radius:50%;border:2px solid #b9bccf;flex-shrink:0;margin-top:1px}
.opt.on .radio{border:6px solid var(--ind)}
.opt b{display:block}.opt small{color:var(--mut);font-size:13px}
.opt.grp{border-radius:14px 14px 0 0}
.box2{border:2px solid var(--ind);border-top:0;border-radius:0 0 14px 14px;margin-top:-6px;padding:6px 13px 10px 43px;background:var(--ind-l)}
.ppl label{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:15px}
.ppl input{width:20px;height:20px;accent-color:var(--ind)}
.ppl small{color:var(--mut)}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;margin-top:8px;background:#fff;color:var(--ink)}
textarea{min-height:80px;resize:vertical}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip{background:var(--ind-l);color:var(--ind);border-radius:999px;padding:4px 10px;font-size:13.5px;font-weight:600;display:inline-flex;gap:6px;align-items:center}
.chip button{background:none;padding:0;color:var(--ind);font-size:15px;line-height:1}
.full{width:100%;margin-top:14px;padding:13px;font-size:15.5px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;z-index:20;max-width:90vw}
.gate{text-align:center;padding:40px 10px}
.gate .big{font-size:46px}
.empty{text-align:center;color:var(--mut);padding:30px 10px}
.small{font-size:13px;color:var(--mut)}
@media (prefers-color-scheme:dark){
 :root{--ink:#eceefe;--mut:#a7abc8;--line:#2e2c4a;--ind-l:#27255a;--green-l:#0f3a2c;--green:#6ee7b7;--amber-l:#3b2d0c;--amber:#fcd34d}
 body{background:linear-gradient(180deg,#1d1b3f 0,#14132b 260px) no-repeat,#14132b}
 .card,.item,.sheet,.opt,.b-g,input[type=text],textarea{background:#1e1c3a}
 .alert{background:#3b2d0c;border-color:#6b5414}
 .st.gray{background:#2a2846}
 .brand,.m a,.b-link{color:#a5b4fc}
 .st.mine,.chip,.chip button{color:#c7d2fe}
}
`;

const JS = String.raw`
(function(){
"use strict";
var token = (location.hash.match(/[#&]l=([A-Za-z0-9_-]{40,64})/) || [])[1] || "";
var root = document.getElementById("app");
var state = null, sheetEl = null;
var imgCache = {};
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(text, cls, fn){ var b = el("button", cls, text); b.type = "button"; b.addEventListener("click", fn); return b; }
function toast(t){ var d = el("div", "toast", t); document.body.appendChild(d); setTimeout(function(){ d.remove(); }, 3500); }
function euros(c){ return (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 }); }
function host(u){ try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
function fdate(d){ if (!d) return ""; var p = d.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("es-ES", { day: "numeric", month: "long" }); }
function names(list){ if (list.length < 2) return list.join(""); return list.slice(0, -1).join(", ") + " y " + list[list.length - 1]; }
function api(method, path, body){
  return fetch("/api/l" + path, { method: method, headers: Object.assign({ "X-Lista-Token": token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined, cache: "no-store", referrerPolicy: "no-referrer" })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) throw new Error(j.error || "Algo ha fallado. Vuelve a probar."); return j; }); });
}
function act(method, path, body, ok){
  return api(method, path, body).then(function(s){ if (s && s.items) state = s; closeSheet(); render(); if (ok) toast(ok); }).catch(function(e){ toast(e.message); });
}
function load(){ return api("GET", "/state").then(function(s){ state = s; render(); }).catch(function(e){ fail(e.message); }); }
function fail(msg){ root.textContent = ""; var g = el("div", "gate"); g.appendChild(el("div", "big", "🔗")); g.appendChild(el("h1", null, "Este enlace no funciona")); g.appendChild(el("p", "sub", msg)); root.appendChild(g); }

function image(item, box){
  if (!item.hasImage) { box.textContent = "🎁"; return; }
  if (imgCache[item.id]) { var i0 = el("img"); i0.alt = ""; i0.src = imgCache[item.id]; box.appendChild(i0); return; }
  fetch("/api/l/images/" + item.id, { headers: { "X-Lista-Token": token }, referrerPolicy: "no-referrer" }).then(function(r){ if (!r.ok) throw 0; return r.blob(); })
    .then(function(b){ imgCache[item.id] = URL.createObjectURL(b); var i = el("img"); i.alt = ""; i.src = imgCache[item.id]; box.textContent = ""; box.appendChild(i); })
    .catch(function(){ box.textContent = "🎁"; });
}

function closeSheet(){ if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
function sheet(title, build){
  closeSheet();
  var back = el("div", "back"); var s = el("div", "sheet"); s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true");
  s.appendChild(el("div", "grab")); s.appendChild(el("h3", null, title));
  back.addEventListener("click", function(e){ if (e.target === back) closeSheet(); });
  build(s); back.appendChild(s); document.body.appendChild(back); sheetEl = back;
}

function myOtherClaims(exceptId){ return state.items.filter(function(it){ return it.claim && it.claim.id !== exceptId && it.claim.people.some(function(p){ return p.me; }); }); }

/** ¿Quién lo regala?: yo solo o entre varios (eligiendo invitados y añadiendo nombres a mano). */
function claimSheet(item){
  var editing = item.claim && item.claim.createdByMe ? item.claim : null;
  var kind = editing ? editing.kind : "solo";
  var picked = {}; var free = [];
  if (editing) editing.people.forEach(function(p){ if (p.guestId && !p.me) picked[p.guestId] = true; if (!p.guestId) free.push(p.name); });
  sheet(item.title, function(s){
    s.appendChild(el("p", "sub", "¿Quién lo regala?"));
    var o1 = el("div", "opt"); var o2 = el("div", "opt");
    [o1, o2].forEach(function(o){ o.setAttribute("role", "radio"); o.tabIndex = 0; o.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.click(); } }); });
    function fill(o, t, d){ o.appendChild(el("span", "radio")); var x = el("div"); x.appendChild(el("b", null, t)); x.appendChild(el("small", null, d)); o.appendChild(x); return x; }
    fill(o1, "Lo regalo yo", "Solo tú.");
    fill(o2, "Lo regalamos entre varios", "Marca con quién.");
    var ppl = el("div", "ppl box2");
    var others = state.guests.filter(function(g){ return g.id !== state.me.id; });
    if (!others.length) ppl.appendChild(el("p", "small", "No hay más invitados. Puedes añadir a alguien a mano."));
    others.forEach(function(g){
      var l = el("label"); var cb = el("input"); cb.type = "checkbox"; cb.checked = !!picked[g.id];
      cb.addEventListener("change", function(){ picked[g.id] = cb.checked; });
      l.appendChild(cb); var tx = el("span", null, g.name + " ");
      var busy = g.busy.filter(function(b){ return b && b !== item.title; });
      tx.appendChild(el("small", null, busy.length ? "· ya regala " + names(busy) : "· libre"));
      l.appendChild(tx); ppl.appendChild(l);
    });
    var chips = el("div", "chips");
    function drawChips(){ chips.textContent = ""; free.forEach(function(n, i){ var c = el("span", "chip", n); c.appendChild(btn("×", "", function(e){ e.stopPropagation(); free.splice(i, 1); drawChips(); })); chips.appendChild(c); }); }
    drawChips();
    var inp = el("input"); inp.type = "text"; inp.maxLength = 40; inp.placeholder = "Otra persona sin enlace (p. ej. Marta)";
    inp.addEventListener("keydown", function(e){ if (e.key === "Enter") { e.preventDefault(); add(); } });
    function add(){ var v = inp.value.trim().replace(/\s+/g, " "); if (v && free.indexOf(v) < 0 && free.length < 10) free.push(v); inp.value = ""; drawChips(); }
    var addB = btn("Añadir nombre", "b-link", function(){ add(); });
    ppl.appendChild(chips); ppl.appendChild(inp); ppl.appendChild(addB);
    function sel(k){ kind = k; o1.classList.toggle("on", k === "solo"); o2.classList.toggle("on", k === "group"); o2.classList.toggle("grp", k === "group"); o1.setAttribute("aria-checked", String(k === "solo")); o2.setAttribute("aria-checked", String(k === "group")); ppl.style.display = k === "group" ? "" : "none"; }
    o1.addEventListener("click", function(){ sel("solo"); }); o2.addEventListener("click", function(){ sel("group"); });
    sel(kind); s.appendChild(o1); s.appendChild(o2); s.appendChild(ppl);
    s.appendChild(btn(editing ? "Guardar" : "Guardar", "b-p full", function(){
      add();
      var ids = kind === "group" ? Object.keys(picked).filter(function(k){ return picked[k]; }) : [];
      var fr = kind === "group" ? free.slice() : [];
      var chosen = state.guests.filter(function(g){ return ids.indexOf(g.id) >= 0; }).map(function(g){ return g.name; });
      var after = function(){ if (chosen.length) whatsappSheet(item, chosen); };
      if (editing) api("PATCH", "/claims/" + editing.id, { guestIds: ids, freeNames: fr }).then(function(st){ state = st; closeSheet(); render(); toast("Guardado"); after(); }).catch(function(e){ toast(e.message); });
      else api("POST", "/claims", { wishId: item.id, kind: kind, guestIds: ids, freeNames: fr }).then(function(st){ state = st; closeSheet(); render(); toast("¡Apuntado! Nadie más lo elegirá."); after(); }).catch(function(e){ toast(e.message); load(); });
    }));
  });
}

/** Avisar a los apuntados por WhatsApp (sin su enlace: cada uno usa el suyo). */
function whatsappSheet(item, chosen){
  sheet("¿Les avisas?", function(s){
    s.appendChild(el("p", "sub", "Has apuntado a " + names(chosen) + ". Lo verán al abrir su enlace; si quieres, avísales tú por WhatsApp."));
    var text = "¡Hola! Te he apuntado conmigo a «" + item.title + "» en la lista de " + state.list.ownerName + ". Ábrela con el enlace que te mandó " + state.list.ownerName + " para aceptarlo 🎁";
    var a = el("a"); a.href = "https://wa.me/?text=" + encodeURIComponent(text); a.target = "_blank"; a.rel = "noopener noreferrer";
    var b = el("button", "b-p full", "Avisar por WhatsApp"); b.type = "button"; b.style.background = "#25d366"; a.appendChild(b); s.appendChild(a);
    s.appendChild(btn("Ahora no", "b-g full", closeSheet));
  });
}

function acceptFlow(item){
  var mine = myOtherClaims(item.claim.id);
  if (!mine.length) return act("POST", "/claims/" + item.claim.id + "/accept", { releaseOthers: false }, "¡Hecho!");
  sheet("Ya regalas " + names(mine.map(function(m){ return "«" + m.title + "»"; })), function(s){
    s.appendChild(el("p", "sub", "¿Lo dejas libre para que lo elija otra persona, o haces los dos?"));
    s.appendChild(btn("Dejar libre lo mío", "b-p full", function(){ act("POST", "/claims/" + item.claim.id + "/accept", { releaseOthers: true }, "¡Hecho! Lo tuyo vuelve a estar libre."); }));
    s.appendChild(btn("Hacer los dos", "b-g full", function(){ act("POST", "/claims/" + item.claim.id + "/accept", { releaseOthers: false }, "¡Hecho!"); }));
  });
}

function suggestSheet(){
  sheet("¿Falta alguien?", function(s){
    s.appendChild(el("p", "sub", "Dile a " + state.list.ownerName + " a quién más debería invitar. No verá nada de lo que habéis elegido."));
    var n = el("input"); n.type = "text"; n.maxLength = 60; n.placeholder = "Nombre"; s.appendChild(n);
    var t = el("textarea"); t.maxLength = 300; t.placeholder = "Nota (opcional): «Falta Marta, la pareja de Ana»"; s.appendChild(t);
    s.appendChild(btn("Mandar sugerencia", "b-p full", function(){
      if (!n.value.trim()) return toast("Escribe el nombre");
      api("POST", "/suggestions", { name: n.value.trim(), note: t.value.trim() }).then(function(){ closeSheet(); toast("¡Gracias! Se lo hemos dicho a " + state.list.ownerName + "."); }).catch(function(e){ toast(e.message); });
    }));
  });
}

/** «Añadir a mi Agendario»: en Android abre la app (o lleva a conseguirla); en el resto, copiar el enlace. */
function addToApp(){
  var link = location.href;
  if (/Android/i.test(navigator.userAgent)) {
    location.href = "intent://lista?u=" + encodeURIComponent(link) + "#Intent;scheme=agendario;package=es.dagarin.agendario;S.browser_fallback_url=" + encodeURIComponent("https://dagarin.es/regalario") + ";end";
    return;
  }
  sheet("Añadir a mi Agendario", function(s){
    s.appendChild(el("p", "sub", "Copia este enlace y pégalo en tu Agendario (Regalos › Mis deseos › «Lista de otra persona»). Lo que regales se apuntará solo en su ficha."));
    s.appendChild(btn("Copiar el enlace", "b-p full", function(){ (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function(){ toast("Enlace copiado"); }, function(){ toast("No se ha podido copiar: cópialo de la barra del navegador"); }); }));
    var a = el("a", null, "¿Qué es Agendario?"); a.href = "https://dagarin.es/regalario"; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "b-link"; a.style.display = "inline-block"; a.style.marginTop = "12px";
    s.appendChild(a);
  });
}

function status(item, box){
  var cl = item.claim;
  if (item.takenElsewhere) { box.appendChild(el("span", "st gray", "✓ Ya está elegido")); return; }
  if (!cl) { box.appendChild(btn("🎁 Lo regalo yo", "b-p", function(){ claimSheet(item); })).style.marginTop = "8px"; return; }
  var me = cl.people.filter(function(p){ return p.me; })[0];
  var label = cl.people.map(function(p){ return (p.me ? "tú" : p.name) + (p.status === "pending" ? " (pendiente)" : ""); });
  if (cl.kind === "solo") box.appendChild(el("span", me ? "st mine" : "st done", me ? "✓ Lo regalas tú" : "✓ Lo regala " + cl.people[0].name));
  else box.appendChild(el("span", me ? "st mine" : "st multi", "👥 " + names(label)));
  var acts = el("div", "acts");
  if (me && me.status === "accepted") {
    if (cl.createdByMe) acts.appendChild(btn(cl.kind === "group" ? "Cambiar con quién" : "Regalarlo entre varios", "b-link", function(){ claimSheet(item); }));
    acts.appendChild(btn("Ya no lo regalo", "b-link", function(){ act("POST", "/claims/" + cl.id + "/leave", null, "Hecho: vuelve a estar libre si no queda nadie."); }));
  } else if (!me && cl.kind === "group") {
    acts.appendChild(btn("Me apunto", "b-link", function(){ act("POST", "/claims/" + cl.id + "/join", null, "¡Apuntado!"); }));
  }
  if (acts.childNodes.length) box.appendChild(acts);
}

function render(){
  if (!state) return;
  root.textContent = "";
  var L = state.list;
  var key = "lista-ok-" + token.slice(0, 12);
  var seen = false; try { seen = localStorage.getItem(key) === "1"; } catch (e) {}
  document.title = L.emoji + " " + L.title + " de " + L.ownerName;
  var hd = el("div", "brand"); hd.innerHTML = ICON_SVG; hd.appendChild(document.createTextNode(" Lista de deseos")); root.appendChild(hd);
  root.appendChild(el("h1", null, L.emoji + " " + L.title + " de " + L.ownerName));
  if (!seen) {
    var g = el("div", "card");
    g.appendChild(el("p", null, "Hola, " + state.me.name + ". Este enlace es personal: es solo para ti."));
    var w = el("p", "sub", "Si eres " + L.ownerName + ", no sigas: verías lo que te van a regalar. 🤫"); w.style.marginTop = "6px"; g.appendChild(w);
    g.appendChild(btn("Soy " + state.me.name + ", continuar", "b-p full", function(){ try { localStorage.setItem(key, "1"); } catch (e) {} render(); }));
    root.appendChild(g); return;
  }
  var chosen = state.items.filter(function(i){ return i.claim || i.takenElsewhere; }).length;
  root.appendChild(el("p", "sub", [L.eventDate ? fdate(L.eventDate) : "Lista siempre abierta", state.items.length + (state.items.length === 1 ? " deseo" : " deseos"), chosen + (chosen === 1 ? " ya elegido" : " ya elegidos")].join(" · ")));
  var hi = el("div", "card hi"); hi.appendChild(el("span", "e", "👋")); var ht = el("span"); var hb = el("b", null, "Hola, " + state.me.name + ". "); ht.appendChild(hb);
  ht.appendChild(document.createTextNode("Marca lo que vayas a regalarle para que nadie lo repita. Los demás invitados lo verán; ")); ht.appendChild(el("b", null, L.ownerName + " no")); ht.appendChild(document.createTextNode("."));
  hi.appendChild(ht); root.appendChild(hi);
  state.items.forEach(function(it){
    var me = it.claim && it.claim.people.filter(function(p){ return p.me && p.status === "pending"; })[0];
    if (!me) return;
    var who = it.claim.people.filter(function(p){ return !p.me; }).map(function(p){ return p.name; });
    var a = el("div", "alert"); var b = el("b", null, "🙋 Te han apuntado"); a.appendChild(b);
    a.appendChild(document.createTextNode(" a «" + it.title + "»" + (who.length ? ", con " + names(who) : "") + "."));
    var r = el("div", "row"); r.appendChild(btn("👍 De acuerdo", "b-p", function(){ acceptFlow(it); })); r.appendChild(btn("No participo", "b-g", function(){ act("POST", "/claims/" + it.claim.id + "/leave", null, "Hecho"); }));
    a.appendChild(r); root.appendChild(a);
  });
  if (!state.items.length) root.appendChild(el("p", "empty", "Esta lista aún no tiene deseos."));
  state.items.forEach(function(it){
    var card = el("div", "item" + ((it.claim && !it.claim.people.some(function(p){ return p.me; })) || it.takenElsewhere ? " taken" : ""));
    var th = el("div", "thumb"); image(it, th); card.appendChild(th);
    var g2 = el("div", "grow"); g2.appendChild(el("div", "t", it.title));
    var m = el("div", "m"); var parts = [];
    if (it.priceCents != null) parts.push(euros(it.priceCents));
    m.textContent = parts.join(" · ");
    if (it.url && /^https?:/i.test(it.url)) { if (parts.length) m.appendChild(document.createTextNode(" · ")); var a2 = el("a", null, "Ver en " + (host(it.url) || "la tienda") + " ↗"); a2.href = it.url; a2.target = "_blank"; a2.rel = "noopener noreferrer nofollow"; m.appendChild(a2); }
    g2.appendChild(m);
    if (it.notes) g2.appendChild(el("div", "note", "«" + it.notes + "»"));
    status(it, g2); card.appendChild(g2); root.appendChild(card);
  });
  var f = el("div", "foot"); f.appendChild(btn("🙋 ¿Falta alguien? Díselo a " + L.ownerName, "b-g", suggestSheet)); root.appendChild(f);
  var app = el("div", "app");
  var ah = el("div", "brand"); ah.style.color = "#fff"; ah.innerHTML = ICON_SVG; ah.appendChild(document.createTextNode(" Agendario")); app.appendChild(ah);
  app.appendChild(el("h2", null, "Tu agenda, con memoria"));
  app.appendChild(el("p", null, "Las listas de deseos son cosa de Agendario: la agenda que recuerda cumpleaños, ideas de regalo y lo que regalaste a cada persona. Si ya lo usas, guarda aquí esta lista y lo que regales se apuntará solo."));
  app.appendChild(btn("📲 Añadir a mi Agendario", "b-w", addToApp));
  var more = el("a", null, "¿Qué es Agendario? Descúbrelo →"); more.href = "https://dagarin.es/regalario"; more.target = "_blank"; more.rel = "noopener noreferrer"; app.appendChild(more);
  root.appendChild(app);
}

if (!token) fail("Falta el código del enlace. Ábrelo tal cual te lo mandaron.");
else load();
document.addEventListener("visibilitychange", function(){ if (document.visibilityState === "visible" && token && state && !sheetEl) load(); });
})();
`;

export function wishPageHtml(nonce: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#4338ca">
<meta property="og:title" content="Lista de deseos">
<meta property="og:description" content="Una lista de deseos de Agendario">
<title>Lista de deseos</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main class="wrap" id="app"><p class="empty">Cargando…</p></main>
<script nonce="${nonce}">var ICON_SVG = ${JSON.stringify(ICON)};${JS}</script>
</body>
</html>`;
}

/** Cabeceras de seguridad de la página pública: nada de terceros, ni marcos, ni referer. */
export function wishPageHeaders(nonce: string) {
  return {
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}
