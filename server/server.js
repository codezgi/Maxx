/* ============================================================
   MAXX GLOBAL — Site + Bayi Portalı sunucusu
   Bağımlılık YOK: yalnızca Node.js çekirdek modülleri.
   Çalıştırma: node server/server.js  (PORT env ile port seçilir)
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

/* ---------------- ayarlar ---------------- */

const ROOT = path.join(__dirname, "..");          // statik site kökü
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// .env dosyasını oku (varsa)
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const PORT = parseInt(process.env.PORT || "8000", 10);
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const ORDER_EMAIL = process.env.ORDER_EMAIL || "info@maxx-global.net";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "Maxx Global <onboarding@resend.dev>";
const IS_PROD = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production";

/* ---------------- ürün listesi ---------------- */

const PRODUCTS = [
  ["titanium-peek-knotless-pushlock", "Titanium Peek Knotless Pushlock"],
  ["ti-button-cl-system-continuous-loop", "TI-BUTTON CL System Continuous Loop"],
  ["ti-button-without-loop", "TI-BUTTON Without Loop"],
  ["surgical-suture-energybraid", "Surgical Suture Energybraid"],
  ["sensitiva-soft-anchor-all-suture", "Sensitiva Soft Anchor All Suture"],
  ["remissas-tightloop-device-syndesmosis-mini", "Remissas Tightloop Device Syndesmosis Mini"],
  ["remissas-tightloop-device-syndesmosis-repair", "Remissas Tightloop Device Syndesmosis Repair"],
  ["remissas-hanger-system-adjustable-button", "Remissas Hanger System Adjustable Button"],
  ["ligament-staple-titanium", "Ligament Staple Titanium"],
  ["helix-ti-screw-anchor", "Helix TI Screw Anchor"],
  ["helix-titanium-ti-screw", "Helix Titanium TI Screw"],
  ["helix-ti-screw-anchor-5mm-titanium", "Helix TI Screw Anchor 5mm Titanium"],
  ["helix-ti-screw-anchor-3-5mm-titanium", "Helix TI Screw Anchor 3.5mm Titanium"],
  ["helix-ti-screw-anchor-3-5mm-peek", "Helix TI Screw Anchor 3.5mm Peek"],
  ["helix-peek-screw-anchor-swlock-peek", "Helix Peek Screw Anchor SWLOCK Peek"],
  ["anchor-with-needles", "Anchor With Needles"],
  ["ac-double-implant-oval", "AC Double Implant Oval"],
];

/* ---------------- veri deposu (JSON, atomik yazım) ---------------- */

let store;
function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } else {
    store = { admin: null, dealers: [], orders: [], quotes: [], seq: { order: 1 } };
  }
  // eski kayıtlarla uyumluluk
  store.content = store.content || {};   // düzenlenen sayfa metinleri (key -> html)
  store.prodMeta = store.prodMeta || {}; // ürün ayarları (slug -> {fiyat})
  store.quotes = store.quotes || [];
}
function saveStore() {
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

/* ---------------- parola (scrypt) ---------------- */

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

/* ---------------- admin hesabını hazırla ---------------- */

function ensureAdmin() {
  if (store.admin) return null;
  const email = process.env.ADMIN_EMAIL || "info@maxx-global.net";
  let pw = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!pw) { pw = crypto.randomBytes(9).toString("base64url"); generated = true; }
  const { salt, hash } = hashPassword(pw);
  store.admin = { email, salt, hash };
  saveStore();
  return generated ? pw : null;
}

/* ---------------- oturum çerezleri (HMAC imzalı) ---------------- */

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}
function makeSession(payload, days) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 })).toString("base64url");
  return body + "." + sign(body);
}
function readSession(cookieHeader, name) {
  const m = (cookieHeader || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (IS_PROD) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie") || [];
  res.setHeader("Set-Cookie", [].concat(prev, parts.join("; ")));
}

/* ---------------- giriş denemesi sınırlama ---------------- */

const attempts = new Map(); // key -> {n, t}
function rateLimited(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.t > 15 * 60e3) attempts.delete(key);
  const r = attempts.get(key);
  return r && r.n >= 8;
}
function recordFail(key) {
  const r = attempts.get(key) || { n: 0, t: Date.now() };
  r.n++; r.t = Date.now();
  attempts.set(key, r);
}

/* ---------------- e-posta (Resend API, anahtar yoksa konsola yazar) ---------------- */

async function sendMail(to, subject, text) {
  if (!RESEND_KEY) {
    console.log(`[MAIL simülasyon] Kime: ${to} | Konu: ${subject}\n${text}\n`);
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
    });
    if (!r.ok) console.error("Mail gönderilemedi:", r.status, await r.text());
    return r.ok;
  } catch (e) { console.error("Mail hatası:", e.message); return false; }
}

/* ---------------- yardımcılar ---------------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 100_000) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
function parseForm(body) {
  const out = {};
  for (const pair of body.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " "));
  }
  return out;
}
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 190;
const clamp = (s, n) => String(s ?? "").trim().slice(0, n);

function orderNo() {
  const n = store.seq.order++;
  return `MG-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
}
const paraFmt = (n) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);

/* ---------------- düzenlenebilir içerik sistemi ----------------
   Statik HTML'lerdeki <!--edit:KEY--> ... <!--/edit:KEY--> bölgeleri
   admin panelinden değiştirilebilir; kayıt store.content'e yazılır ve
   sayfa sunulurken anında uygulanır. */

const PROSE_TR = [
  ["/kalite-politikamiz/", "Kalite Politikamız"], ["/surdurulebilirlik/", "Sürdürülebilirlik"],
  ["/gizlilik-politikamiz/", "Gizlilik Politikamız"], ["/ar-ge-global/", "Ar-Ge & Global"],
  ["/kalite-yonetim-politikasi/", "Kalite Yönetim Politikası"], ["/hasta-guvenligi-politikasi/", "Hasta Güvenliği Politikası"],
  ["/etik-ve-uyum-politikasi/", "Etik ve Uyum Politikası"], ["/veri-guvenligi-ve-gizlilik-politikasi/", "Veri Güvenliği ve Gizlilik"],
  ["/ar-ge-ve-inovasyon-politikasi/", "Ar-Ge ve İnovasyon Politikası"], ["/cevre-politikamiz/", "Çevre Politikamız"],
  ["/is-sagligi-ve-guvenligi-politikasi/", "İş Sağlığı ve Güvenliği"], ["/egitim-ve-yetkinlik-politikasi/", "Eğitim ve Yetkinlik"],
  ["/musteri-memnuniyeti-politikasi/", "Müşteri Memnuniyeti"],
];
const PROSE_EN = [
  ["/en/quality-policy/", "Quality Policy (EN)"], ["/en/sustainability/", "Sustainability (EN)"],
  ["/en/privacy-policy/", "Privacy Policy (EN)"], ["/en/rd-global/", "R&D & Global (EN)"],
  ["/en/quality-management-policy/", "Quality Management (EN)"], ["/en/patient-safety-policy/", "Patient Safety (EN)"],
  ["/en/ethics-and-compliance-policy/", "Ethics & Compliance (EN)"], ["/en/data-security-and-privacy-policy/", "Data Security (EN)"],
  ["/en/rd-and-innovation-policy/", "R&D and Innovation (EN)"], ["/en/environmental-policy/", "Environmental (EN)"],
  ["/en/occupational-health-and-safety-policy/", "Occupational H&S (EN)"], ["/en/training-and-competency-policy/", "Training (EN)"],
  ["/en/customer-satisfaction-policy/", "Customer Satisfaction (EN)"],
];

// key -> {file, label}
function editableIndex() {
  const idx = {};
  for (const [k, lbl, f] of [
    ["ana:badge:tr", "Ana Sayfa — Üst Rozet (TR)", "index.html"],
    ["ana:baslik:tr", "Ana Sayfa — Büyük Başlık (TR)", "index.html"],
    ["ana:aciklama:tr", "Ana Sayfa — Açıklama (TR)", "index.html"],
    ["ana:badge:en", "Ana Sayfa — Üst Rozet (EN)", "en/index.html"],
    ["ana:baslik:en", "Ana Sayfa — Büyük Başlık (EN)", "en/index.html"],
    ["ana:aciklama:en", "Ana Sayfa — Açıklama (EN)", "en/index.html"],
  ]) idx[k] = { file: f, label: lbl };
  for (const [p, lbl] of PROSE_TR) idx["sayfa:" + p] = { file: p.slice(1) + "index.html", label: lbl };
  for (const [p, lbl] of PROSE_EN) idx["sayfa:" + p] = { file: p.slice(1) + "index.html", label: lbl };
  for (const [slug, name] of PRODUCTS) {
    idx[`urun:${slug}:tr`] = { file: slug + "/index.html", label: name + " — Açıklama (TR)" };
    idx[`urun:${slug}:en`] = { file: slug + "-en/index.html", label: name + " — Açıklama (EN)" };
  }
  return idx;
}
const EDITABLE = editableIndex();

function regionOf(key) {
  const meta = EDITABLE[key];
  if (!meta) return null;
  const file = path.join(ROOT, meta.file);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  const a = `<!--edit:${key}-->`, b = `<!--/edit:${key}-->`;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i === -1 || j === -1) return null;
  return { original: html.substring(i + a.length, j).trim(), meta };
}

// HTML bölge -> düzenlenebilir düz metin (paragraflar boş satırla, maddeler "- " ile)
function htmlToText(h) {
  let t = h;
  t = t.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  t = t.replace(/<\/(p|ul)>/gi, "\n\n").replace(/<(p|ul)[^>]*>/gi, "");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// düz metin -> güvenli HTML
function textToHtml(t, inline) {
  if (inline) return esc(t.replace(/\s+/g, " ").trim());
  const blocks = t.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith("- ")))
      return "<ul>\n" + lines.map((l) => "  <li>" + esc(l.slice(2)) + "</li>").join("\n") + "\n</ul>";
    return "<p>" + esc(lines.join(" ")) + "</p>";
  }).join("\n");
}
const isInlineKey = (k) => k.startsWith("ana:");

// sunulurken içerik düzeltmelerini uygula
function applyOverrides(html) {
  for (const key of Object.keys(store.content)) {
    const a = `<!--edit:${key}-->`, b = `<!--/edit:${key}-->`;
    const i = html.indexOf(a);
    if (i === -1) continue;
    const j = html.indexOf(b, i);
    if (j === -1) continue;
    html = html.slice(0, i + a.length) + "\n" + store.content[key] + "\n" + html.slice(j);
  }
  return html;
}

/* ---------------- HTML iskeleti (site stiliyle) ---------------- */

function pageShell(title, body, opts = {}) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | Maxx Global Medikal</title>
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<link rel="stylesheet" href="/assets/css/style.css">
${opts.leaflet ? '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">\n<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' : ""}
<style>
  .portal-header { background: var(--primary-dark); padding: 14px 0; position: static; }
  .portal-header .container { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 0; }
  .portal-header img { width: 170px; height: 38px; object-fit: contain; }
  .portal-header nav { display: flex; gap: 18px; align-items: center; }
  .portal-header a { color: rgba(255,255,255,.85); font-weight: 600; font-size: .92rem; }
  .portal-header a:hover { color: var(--accent); }
  .portal-main { padding: clamp(32px, 5vw, 56px) 0; min-height: 60vh; }
  .portal-title { margin-bottom: 6px; }
  .portal-sub { margin-bottom: 28px; }
  .msg { padding: 14px 18px; border-radius: 10px; margin-bottom: 20px; font-weight: 600; }
  .msg-ok { background: #e5f7ee; color: #14734a; }
  .msg-err { background: #fdeaea; color: #b23333; }
  .msg-info { background: var(--soft); color: var(--primary); }
  #harita { height: 380px; border-radius: 14px; border: 1px solid var(--line); z-index: 0; }
  table.liste { width: 100%; border-collapse: collapse; font-size: .93rem; }
  table.liste th, table.liste td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  table.liste th { color: var(--heading); font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
  .durum { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: .78rem; font-weight: 700; }
  .durum-beklemede { background: #fff3d6; color: #8a6100; }
  .durum-onayli { background: #e5f7ee; color: #14734a; }
  .durum-reddedildi { background: #fdeaea; color: #b23333; }
  .u-kart { display: flex; align-items: center; gap: 14px; }
  .u-kart img { width: 64px; height: 48px; object-fit: cover; border-radius: 8px; background: var(--soft); }
  .u-kart strong { color: var(--heading); font-size: .95rem; }
  .adet { width: 90px; border: 1.5px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  .btn-sm { padding: 8px 18px; font-size: .85rem; }
  .kod { font-family: ui-monospace, monospace; background: var(--soft); padding: 2px 8px; border-radius: 6px; font-size: .85rem; word-break: break-all; }
  .kutu { background: var(--white); border: 1px solid var(--line); border-radius: 14px; padding: 24px; margin-bottom: 24px; }
  .ozet-kart { cursor: pointer; width: 100%; font: inherit; }
  .ozet-kart small { color: var(--accent); font-weight: 600; }
  dialog.dlg { border: 0; border-radius: 16px; padding: 0; width: min(760px, 94vw); box-shadow: var(--shadow-lg); }
  dialog.dlg::backdrop { background: rgba(5, 34, 38, .55); }
  .dlg-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 24px; border-bottom: 1px solid var(--line); }
  .dlg-head h2 { font-size: 1.15rem; margin: 0; }
  .dlg-kapat { font-size: 1.05rem; padding: 4px 10px; color: var(--text); border-radius: 8px; }
  .dlg-kapat:hover { background: var(--soft); color: var(--primary); }
  .dlg-govde { padding: 18px 24px; max-height: 62vh; overflow: auto; }
  .dlg-alt { display: flex; gap: 10px; justify-content: flex-end; padding: 14px 24px; border-top: 1px solid var(--line); }
  .kutu h2 { font-size: 1.15rem; margin-bottom: 16px; }
</style>
</head>
<body>
<header class="portal-header">
  <div class="container">
    <a href="/"><img src="/assets/img/logo-maxx.png" alt="Maxx Global Medikal"></a>
    <nav>${opts.nav || '<a href="/">← Siteye Dön</a>'}</nav>
  </div>
</header>
<main class="portal-main">
  <div class="container">
${body}
  </div>
</main>
${opts.script || ""}
</body>
</html>`;
}

/* ---------------- sayfalar: BAYİ ---------------- */

function bayilikAlPage(msg) {
  const body = `
  <span class="eyebrow">Bayi Ağı</span>
  <h1 class="portal-title" style="font-size:2rem">Bayilik Başvurusu</h1>
  <p class="portal-sub">Formu doldurun; başvurunuz ekibimiz tarafından incelenip onaylandığında
  e-posta adresinize aktivasyon bağlantısı gönderilecektir.
  Zaten bayimiz misiniz? <a href="/bayi/giris/">Bayi girişi yapın →</a></p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayilik-al/" style="max-width:860px" onsubmit="return kontrol()">
    <div class="form-grid">
      <p class="form-field"><label for="firma">Firma Adı *</label><input id="firma" name="firma" required maxlength="120"></p>
      <p class="form-field"><label for="yetkili">Yetkili Ad Soyad *</label><input id="yetkili" name="yetkili" required maxlength="120"></p>
      <p class="form-field"><label for="eposta">E-posta *</label><input id="eposta" name="eposta" type="email" required maxlength="180"></p>
      <p class="form-field"><label for="telefon">Telefon *</label><input id="telefon" name="telefon" type="tel" required maxlength="40"></p>
      <p class="form-field full"><label for="adres">Açık Adres *</label>
        <span style="display:flex;gap:10px">
          <input id="adres" name="adres" required maxlength="300" style="flex:1" placeholder="Mahalle, cadde, no, ilçe, il">
          <button type="button" class="btn btn-outline btn-sm" onclick="adresBul()">Haritada Bul</button>
        </span>
        <small id="adresDurum"></small>
      </p>
      <p class="form-field full">
        <label>Haritada Konumunuz * <small>(adresi yazınca otomatik işaretlenir; gerekirse iğneyi sürükleyin ya da haritaya tıklayın)</small></label>
        <span id="harita"></span>
        <input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng">
      </p>
      <p class="hp-field" aria-hidden="true"><label for="web_site">Boş bırakın</label><input id="web_site" name="web_site" tabindex="-1" autocomplete="off"></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">Başvuruyu Gönder</button></p>
    <p class="form-note text-center">Başvurunuz onaylanana kadar hesabınız etkinleşmez. Bilgileriniz üçüncü kişilerle paylaşılmaz.</p>
  </form>`;
  const script = `<script>
    var marker, map = L.map('harita').setView([39.0, 35.2], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

    function isaretle(lat, lng, zoomla) {
      if (marker) marker.remove();
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', function () {
        var ll = marker.getLatLng();
        document.getElementById('lat').value = ll.lat.toFixed(6);
        document.getElementById('lng').value = ll.lng.toFixed(6);
      });
      document.getElementById('lat').value = (+lat).toFixed(6);
      document.getElementById('lng').value = (+lng).toFixed(6);
      if (zoomla) map.setView([lat, lng], 15);
    }

    map.on('click', function (e) { isaretle(e.latlng.lat, e.latlng.lng, false); });

    var aramaZamani = 0;
    function adresBul() {
      var adres = document.getElementById('adres').value.trim();
      var durum = document.getElementById('adresDurum');
      if (adres.length < 5) { durum.textContent = 'Önce adresinizi yazın.'; return; }
      // Nominatim kullanım kuralı: saniyede en fazla 1 istek
      var simdi = Date.now();
      if (simdi - aramaZamani < 1100) return;
      aramaZamani = simdi;
      durum.textContent = 'Adres aranıyor…';
      // Tam adres bulunamazsa kademeli olarak sadeleştirip (mahalle/ilçe/il) tekrar dene
      var kelimeler = adres.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
      var denemeler = [adres, kelimeler.slice(-3).join(' '), kelimeler.slice(-2).join(' ')];
      function dene(i) {
        if (i >= denemeler.length) {
          durum.textContent = 'Adres bulunamadı. Haritaya tıklayarak konumunuzu elle işaretleyebilirsiniz.';
          return;
        }
        fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tr&q=' + encodeURIComponent(denemeler[i]))
          .then(function (r) { return r.json(); })
          .then(function (sonuc) {
            if (sonuc && sonuc.length) {
              isaretle(parseFloat(sonuc[0].lat), parseFloat(sonuc[0].lon), false);
              map.setView([sonuc[0].lat, sonuc[0].lon], i === 0 ? 16 : 12);
              durum.textContent = i === 0
                ? 'Konum işaretlendi — doğruluğunu kontrol edin, gerekirse iğneyi sürükleyin.'
                : 'Bölge bulundu; iğneyi tam konumunuza sürükleyin ya da haritaya tıklayın.';
            } else {
              setTimeout(function () { dene(i + 1); }, 1100);
            }
          })
          .catch(function () { durum.textContent = 'Arama yapılamadı. Haritaya tıklayarak işaretleyin.'; });
      }
      dene(0);
    }
    document.getElementById('adres').addEventListener('change', adresBul);
    document.getElementById('adres').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); adresBul(); }
    });

    function kontrol() {
      if (!document.getElementById('lat').value) { alert('Lütfen adresinizi haritada bulun ya da haritaya tıklayarak işaretleyin.'); return false; }
      return true;
    }
  </script>`;
  return pageShell("Bayilik Başvurusu", body, { leaflet: true, script });
}

function bayiGirisPage(msg) {
  const body = `
  <span class="eyebrow">Bayi Portalı</span>
  <h1 class="portal-title" style="font-size:2rem">Bayi Girişi</h1>
  <p class="portal-sub">Henüz bayimiz değil misiniz? <a href="/bayilik-al/">Bayilik başvurusu yapın →</a></p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayi/giris/" style="max-width:480px">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="eposta">E-posta</label><input id="eposta" name="eposta" type="email" required></p>
      <p class="form-field"><label for="parola">Parola</label><input id="parola" name="parola" type="password" required></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">Giriş Yap</button></p>
  </form>`;
  return pageShell("Bayi Girişi", body);
}

function aktivasyonPage(token, msg) {
  const body = `
  <span class="eyebrow">Bayi Portalı</span>
  <h1 class="portal-title" style="font-size:2rem">Hesap Aktivasyonu</h1>
  <p class="portal-sub">Başvurunuz onaylandı! Portala giriş için bir parola belirleyin.</p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayi/aktivasyon/" style="max-width:480px">
    <input type="hidden" name="token" value="${esc(token)}">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="p1">Parola (en az 8 karakter)</label><input id="p1" name="p1" type="password" minlength="8" required></p>
      <p class="form-field"><label for="p2">Parola (tekrar)</label><input id="p2" name="p2" type="password" minlength="8" required></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">Hesabı Etkinleştir</button></p>
  </form>`;
  return pageShell("Hesap Aktivasyonu", body);
}

function bayiPortalPage(dealer, msg) {
  const rows = PRODUCTS.map(([slug, name]) => {
    const fiyat = (store.prodMeta[slug] || {}).fiyat;
    return `
    <tr data-fiyat="${fiyat || 0}">
      <td><span class="u-kart"><img src="/assets/img/products/${slug}.webp" alt="${esc(name)}" loading="lazy"><strong>${esc(name)}</strong></span></td>
      <td style="width:140px;white-space:nowrap">${fiyat ? paraFmt(fiyat) : "<small>Fiyat için arayınız</small>"}</td>
      <td style="width:120px"><input class="adet" type="number" min="0" max="99999" value="0" name="adet_${slug}" form="siparisForm" oninput="toplamHesapla()"></td>
    </tr>`;
  }).join("");
  const myOrders = store.orders.filter((o) => o.dealerId === dealer.id).slice().reverse();
  const orderRows = myOrders.map((o) => `
    <tr><td><strong>${esc(o.no)}</strong></td><td>${new Date(o.tarih).toLocaleString("tr-TR")}</td>
    <td>${o.kalemler.map((k) => esc(k.ad) + " × " + k.adet + (k.fiyat ? " <small>(" + paraFmt(k.fiyat * k.adet) + ")</small>" : "")).join("<br>")}</td>
    <td>${o.toplam ? "<strong>" + paraFmt(o.toplam) + "</strong>" : "—"}</td></tr>`).join("");
  const body = `
  <span class="eyebrow">Bayi Portalı</span>
  <h1 class="portal-title" style="font-size:2rem">Hoş geldiniz, ${esc(dealer.firma)}</h1>
  <p class="portal-sub">Aşağıdan sipariş oluşturabilirsiniz. Siparişiniz bize ulaştığında ekibimiz sizi arayacaktır.</p>
  ${msg || ""}
  <div class="kutu">
    <h2>Sipariş Oluştur</h2>
    <form id="siparisForm" method="post" action="/bayi/siparis/">
      <table class="liste">
        <thead><tr><th>Ürün</th><th>Bayi Fiyatı</th><th>Adet</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="mt-2" style="text-align:right;font-size:1.05rem">Ara Toplam: <strong id="toplam">₺0,00</strong> <small>(KDV hariç)</small></p>
      <p class="form-field mt-4"><label for="not">Sipariş Notu (isteğe bağlı)</label>
      <textarea id="not" name="not" rows="2" maxlength="1000" style="border:1.5px solid var(--line);border-radius:10px;padding:10px"></textarea></p>
      <p class="mt-4"><button class="btn btn-accent" type="submit">Siparişi Oluştur</button></p>
    </form>
  </div>
  <div class="kutu">
    <h2>Geçmiş Siparişlerim</h2>
    ${myOrders.length ? `<table class="liste"><thead><tr><th>Sipariş No</th><th>Tarih</th><th>Ürünler</th><th>Tutar</th></tr></thead><tbody>${orderRows}</tbody></table>` : "<p>Henüz siparişiniz yok.</p>"}
  </div>`;
  const script = `<script>
    function toplamHesapla() {
      var t = 0;
      document.querySelectorAll('tr[data-fiyat]').forEach(function (tr) {
        var f = parseFloat(tr.getAttribute('data-fiyat')) || 0;
        var n = parseInt(tr.querySelector('input.adet').value || '0', 10);
        t += f * n;
      });
      document.getElementById('toplam').textContent =
        new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(t);
    }
  </script>`;
  return pageShell("Bayi Portalı", body, { nav: '<a href="/">← Siteye Dön</a><a href="/bayi/cikis/">Çıkış Yap</a>', script });
}

/* ---------------- sayfalar: ADMIN ---------------- */

function adminGirisPage(msg) {
  const body = `
  <span class="eyebrow">Yönetim</span>
  <h1 class="portal-title" style="font-size:2rem">Yönetici Girişi</h1>
  <p class="portal-sub">Bu alan yalnızca Maxx Global yetkilileri içindir.</p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/admin/giris/" style="max-width:480px">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="eposta">E-posta</label><input id="eposta" name="eposta" type="email" required></p>
      <p class="form-field"><label for="parola">Parola</label><input id="parola" name="parola" type="password" required></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">Giriş Yap</button></p>
  </form>`;
  return pageShell("Yönetici Girişi", body);
}

/* ---------------- admin sayfa takımı (menülü) ---------------- */

function adminNav(active) {
  const items = [
    ["/admin/", "Özet"],
    ["/admin/onaylar/", "Bayilik Onayları"],
    ["/admin/fiyatlar/", "Fiyat Güncelleme"],
    ["/admin/aciklamalar/", "Açıklama & Metinler"],
    ["/admin/siparisler/", "Siparişler"],
  ];
  return items.map(([u, l]) =>
    `<a href="${u}"${u === active ? ' style="color:var(--accent)"' : ""}>${l}</a>`).join("") +
    '<a href="/admin/cikis/">Çıkış</a>';
}

/* Panel açıkken 30 sn'de bir yeni başvuru/sipariş kontrol eder,
   tarayıcı bildirimi gösterir (sekme arka planda olsa da çalışır). */
const BILDIRIM_JS = `<script>
(function () {
  var btn = document.getElementById('bildirimAc');
  function btnGuncelle() {
    if (!('Notification' in window)) { if (btn) btn.style.display = 'none'; return; }
    if (Notification.permission === 'granted' && btn) {
      btn.textContent = 'Bildirimler Açık ✓';
      btn.disabled = true;
    }
  }
  if (btn) btn.addEventListener('click', function () {
    Notification.requestPermission().then(btnGuncelle);
  });
  btnGuncelle();

  var son = parseInt(localStorage.getItem('mgSonKontrol') || Date.now(), 10);
  function kontrol() {
    fetch('/admin/api/yeni/?since=' + son)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        son = d.now;
        localStorage.setItem('mgSonKontrol', son);
        var olaylar = [];
        d.basvurular.forEach(function (b) { olaylar.push({ baslik: 'Yeni bayilik başvurusu', metin: b.firma, url: '/admin/onaylar/' }); });
        d.siparisler.forEach(function (o) { olaylar.push({ baslik: 'Yeni sipariş: ' + o.no, metin: o.firma, url: '/admin/siparisler/' }); });
        if (olaylar.length) {
          document.title = '(' + olaylar.length + ') ' + document.title.replace(/^\\(\\d+\\) /, '');
          if ('Notification' in window && Notification.permission === 'granted') {
            olaylar.forEach(function (o) {
              var n = new Notification(o.baslik, { body: o.metin, icon: '/assets/img/favicon.png', tag: o.baslik + o.metin });
              n.onclick = function () { window.focus(); location.href = o.url; };
            });
          }
        }
      }).catch(function () {});
  }
  setInterval(kontrol, 30000);
  setTimeout(kontrol, 1500);
})();
</script>`;

function adminLayout(active, title, content, opts = {}) {
  return pageShell(title, content, {
    leaflet: opts.leaflet,
    nav: adminNav(active),
    script: (opts.script || "") + BILDIRIM_JS,
  });
}

function haritaScript() {
  const mapData = store.dealers
    .filter((d) => d.lat && d.lng && d.durum !== "reddedildi")
    .map((d) => ({ lat: d.lat, lng: d.lng, firma: d.firma, adres: d.adres, durum: d.durum }));
  return `<script>
    var data = ${JSON.stringify(mapData)};
    var map = L.map('harita').setView([39.0, 35.2], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    data.forEach(function (d) {
      var renk = d.durum === 'onayli' ? '#14b866' : '#f2a516';
      L.circleMarker([d.lat, d.lng], { radius: 10, color: renk, fillColor: renk, fillOpacity: .85 })
        .addTo(map).bindPopup('<b>' + d.firma + '</b><br>' + d.adres);
    });
  </script>`;
}

function adminOzetPage() {
  const dealers = store.dealers;
  const pending = dealers.filter((d) => d.durum === "beklemede");
  const onayli = dealers.filter((d) => d.durum === "onayli");
  const fmtT = (ts) => new Date(ts).toLocaleString("tr-TR");

  const dlg = (id, baslik, icerik, gitUrl, gitEtiket) => `
  <dialog class="dlg" id="dlg-${id}">
    <div class="dlg-head"><h2>${baslik}</h2>
      <button type="button" class="dlg-kapat" onclick="this.closest('dialog').close()" aria-label="Kapat">✕</button></div>
    <div class="dlg-govde">${icerik}</div>
    <div class="dlg-alt">
      <button type="button" class="btn btn-outline btn-sm" onclick="this.closest('dialog').close()">Kapat</button>
      <a class="btn btn-accent btn-sm" href="${gitUrl}">${gitEtiket} →</a>
    </div>
  </dialog>`;

  const bekleyenIcerik = pending.length ? `<table class="liste"><thead><tr><th>Firma</th><th>İletişim</th><th>Başvuru</th></tr></thead><tbody>${
    pending.map((d) => `<tr><td><strong>${esc(d.firma)}</strong><br><small>${esc(d.yetkili)} · ${esc(d.adres)}</small></td>
      <td>${esc(d.eposta)}<br><small>${esc(d.telefon)}</small></td><td>${fmtT(d.kayitTarihi)}</td></tr>`).join("")
  }</tbody></table>` : "<p>Onay bekleyen başvuru yok.</p>";

  const onayliIcerik = onayli.length ? `<table class="liste"><thead><tr><th>Firma</th><th>İletişim</th><th>Durum</th></tr></thead><tbody>${
    onayli.map((d) => `<tr><td><strong>${esc(d.firma)}</strong><br><small>${esc(d.yetkili)} · ${esc(d.adres)}</small></td>
      <td>${esc(d.eposta)}<br><small>${esc(d.telefon)}</small></td>
      <td><span class="durum durum-onayli">${d.salt ? "Aktif" : "Aktivasyon Bekliyor"}</span></td></tr>`).join("")
  }</tbody></table>` : "<p>Henüz onaylı bayi yok.</p>";

  const siparisIcerik = store.orders.length ? `<table class="liste"><thead><tr><th>No</th><th>Bayi</th><th>Ürünler</th><th>Tutar</th></tr></thead><tbody>${
    store.orders.slice().reverse().map((o) => {
      const d = dealers.find((x) => x.id === o.dealerId);
      return `<tr><td><strong>${esc(o.no)}</strong><br><small>${fmtT(o.tarih)}</small></td>
        <td>${esc(d ? d.firma : "?")}</td>
        <td>${o.kalemler.map((k) => esc(k.ad) + " × " + k.adet).join("<br>")}${o.not ? `<br><small>Not: ${esc(o.not)}</small>` : ""}</td>
        <td>${o.toplam ? "<strong>" + paraFmt(o.toplam) + "</strong>" : "—"}</td></tr>`;
    }).join("")
  }</tbody></table>` : "<p>Henüz sipariş yok.</p>";

  const teklifIcerik = (store.quotes || []).length ? `<table class="liste"><thead><tr><th>Tarih</th><th>Ad / Firma</th><th>Ürün</th><th>Mesaj</th></tr></thead><tbody>${
    store.quotes.slice().reverse().map((q) => `<tr><td>${fmtT(q.tarih)}</td>
      <td>${esc(q.ad)}<br><small>${esc(q.firma || "")} · ${esc(q.eposta)} · ${esc(q.telefon)}</small></td>
      <td>${esc(q.urun)}</td><td>${esc(q.mesaj || "")}</td></tr>`).join("")
  }</tbody></table>` : "<p>Henüz teklif talebi yok.</p>";

  const kart = (id, sayi, etiket) => `
    <button type="button" class="card text-center ozet-kart" onclick="document.getElementById('dlg-${id}').showModal()">
      <h3 style="font-size:2rem;color:var(--accent)">${sayi}</h3><p>${etiket}</p>
      <small>Detay için tıklayın</small>
    </button>`;

  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Özet</h1>
  <p class="portal-sub">Hoş geldiniz. Kartlara tıklayarak detayları görüntüleyebilirsiniz.</p>
  <div class="grid grid-4" style="margin-bottom:24px">
    ${kart("bekleyen", pending.length, "Onay Bekleyen")}
    ${kart("onayli", onayli.length, "Onaylı Bayi")}
    ${kart("siparis", store.orders.length, "Toplam Sipariş")}
    ${kart("teklif", (store.quotes || []).length, "Teklif Talebi")}
  </div>
  ${dlg("bekleyen", "Onay Bekleyen Başvurular", bekleyenIcerik, "/admin/onaylar/", "Bayilik Onayları'na Git")}
  ${dlg("onayli", "Onaylı Bayiler", onayliIcerik, "/admin/onaylar/", "Bayilik Onayları'na Git")}
  ${dlg("siparis", "Tüm Siparişler", siparisIcerik, "/admin/siparisler/", "Siparişlere Git")}
  ${dlg("teklif", "Teklif Talepleri", teklifIcerik, "/admin/siparisler/", "Siparişlere Git")}
  <div class="kutu">
    <h2>Tarayıcı Bildirimleri</h2>
    <p style="margin-bottom:12px">Bu panel herhangi bir sekmede açıkken yeni bayilik başvurusu ve siparişlerde tarayıcı bildirimi alırsınız (sekme arka planda olsa bile).</p>
    <button id="bildirimAc" class="btn btn-accent btn-sm" type="button">Bildirimleri Aç</button>
  </div>
  <div class="kutu">
    <h2>Bayi Haritası <small style="font-weight:400">(yeşil: onaylı · turuncu: onay bekliyor)</small></h2>
    <div id="harita"></div>
  </div>`;
  return adminLayout("/admin/", "Yönetim Paneli", body, { leaflet: true, script: haritaScript() });
}

function adminOnaylarPage(msg) {
  const dealers = store.dealers;
  const pending = dealers.filter((d) => d.durum === "beklemede");
  const pendingRows = pending.map((d) => `
    <tr>
      <td><strong>${esc(d.firma)}</strong><br><small>${esc(d.yetkili)}</small></td>
      <td>${esc(d.eposta)}<br><small>${esc(d.telefon)}</small></td>
      <td>${esc(d.adres)}</td>
      <td style="white-space:nowrap">
        <form method="post" action="/admin/onayla/" style="display:inline"><input type="hidden" name="id" value="${d.id}"><button class="btn btn-accent btn-sm">Onayla</button></form>
        <form method="post" action="/admin/reddet/" style="display:inline" onsubmit="return confirm('Başvuru reddedilsin mi?')"><input type="hidden" name="id" value="${d.id}"><button class="btn btn-outline btn-sm">Reddet</button></form>
      </td>
    </tr>`).join("");
  const dealerRows = dealers.slice().reverse().map((d) => `
    <tr>
      <td><strong>${esc(d.firma)}</strong><br><small>${esc(d.yetkili)}</small></td>
      <td>${esc(d.eposta)}<br><small>${esc(d.telefon)}</small></td>
      <td>${esc(d.adres)}</td>
      <td><span class="durum durum-${d.durum}">${{ beklemede: "Onay Bekliyor", onayli: d.salt ? "Aktif" : "Aktivasyon Bekliyor", reddedildi: "Reddedildi" }[d.durum]}</span></td>
      <td>${d.durum === "onayli" && !d.salt ? `<span class="kod">/bayi/aktivasyon/?token=${esc(d.token)}</span>` : ""}</td>
    </tr>`).join("");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Bayilik Onayları</h1>
  <p class="portal-sub">Başvuruları inceleyin; onaylanan bayiye aktivasyon bağlantısı e-postayla gider (bağlantı aşağıdaki tabloda da görünür).</p>
  ${msg || ""}
  <div class="kutu">
    <h2>Onay Bekleyen Başvurular</h2>
    ${pending.length ? `<table class="liste"><thead><tr><th>Firma</th><th>İletişim</th><th>Adres</th><th></th></tr></thead><tbody>${pendingRows}</tbody></table>` : "<p>Bekleyen başvuru yok.</p>"}
  </div>
  <div class="kutu">
    <h2>Bayi Haritası <small style="font-weight:400">(yeşil: onaylı · turuncu: onay bekliyor)</small></h2>
    <div id="harita"></div>
  </div>
  <div class="kutu">
    <h2>Tüm Bayiler</h2>
    ${dealers.length ? `<table class="liste"><thead><tr><th>Firma</th><th>İletişim</th><th>Adres</th><th>Durum</th><th>Aktivasyon Bağlantısı</th></tr></thead><tbody>${dealerRows}</tbody></table>` : "<p>Kayıtlı bayi yok.</p>"}
  </div>`;
  return adminLayout("/admin/onaylar/", "Bayilik Onayları", body, { leaflet: true, script: haritaScript() });
}

function adminFiyatlarPage(msg) {
  const rows = PRODUCTS.map(([slug, name]) => {
    const fiyat = (store.prodMeta[slug] || {}).fiyat;
    return `
    <tr>
      <td><span class="u-kart"><img src="/assets/img/products/${slug}.webp" alt="" loading="lazy"><strong>${esc(name)}</strong></span></td>
      <td style="width:200px"><input class="adet" style="width:170px" type="number" step="0.01" min="0" name="fiyat_${slug}" value="${fiyat || ""}" placeholder="₺ bayi fiyatı"></td>
    </tr>`;
  }).join("");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Fiyat Güncelleme</h1>
  <p class="portal-sub">Fiyatlar yalnızca giriş yapmış bayilere gösterilir; herkese açık sitede görünmez. Boş bırakılan üründe bayi "Fiyat için arayınız" görür.</p>
  ${msg || ""}
  <form class="kutu" method="post" action="/admin/fiyatlar/">
    <table class="liste">
      <thead><tr><th>Ürün</th><th>Bayi Fiyatı (₺, KDV hariç)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="mt-4"><button class="btn btn-accent">Fiyatları Kaydet</button></p>
  </form>`;
  return adminLayout("/admin/fiyatlar/", "Fiyat Güncelleme", body);
}

function adminAciklamalarPage() {
  const prodRows = PRODUCTS.map(([slug, name]) => {
    const trDegisik = store.content[`urun:${slug}:tr`] !== undefined;
    const enDegisik = store.content[`urun:${slug}:en`] !== undefined;
    return `
    <tr>
      <td><span class="u-kart"><img src="/assets/img/products/${slug}.webp" alt="" loading="lazy"><strong>${esc(name)}</strong></span></td>
      <td style="white-space:nowrap">
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=urun:${slug}:tr">Türkçe${trDegisik ? " •" : ""}</a>
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=urun:${slug}:en">İngilizce${enDegisik ? " •" : ""}</a>
      </td>
    </tr>`;
  }).join("");
  const anaLinkler = [
    ["ana:badge:tr", "Rozet (TR)"], ["ana:baslik:tr", "Büyük Başlık (TR)"], ["ana:aciklama:tr", "Açıklama (TR)"],
    ["ana:badge:en", "Rozet (EN)"], ["ana:baslik:en", "Büyük Başlık (EN)"], ["ana:aciklama:en", "Açıklama (EN)"],
  ].map(([k, l]) => `<a class="btn btn-outline btn-sm" style="margin:3px 2px" href="/admin/icerik/?key=${encodeURIComponent(k)}">${l}${store.content[k] !== undefined ? " •" : ""}</a>`).join(" ");
  const proseLinkler = PROSE_TR.concat(PROSE_EN).map(([p, lbl]) =>
    `<a class="btn btn-outline btn-sm" style="margin:3px 2px" href="/admin/icerik/?key=${encodeURIComponent("sayfa:" + p)}">${esc(lbl)}${store.content["sayfa:" + p] !== undefined ? " •" : ""}</a>`).join(" ");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Açıklama &amp; Metin Güncelleme</h1>
  <p class="portal-sub">Tıklayın, metni düzenleyin, kaydedin — web sitesi anında güncellenir. Yanında <strong>•</strong> olanlar daha önce düzenlenmiştir.</p>
  <div class="kutu">
    <h2>Ürün Açıklamaları</h2>
    <table class="liste">
      <thead><tr><th>Ürün</th><th>Sitedeki Açıklama</th></tr></thead>
      <tbody>${prodRows}</tbody>
    </table>
  </div>
  <div class="kutu">
    <h2>Ana Sayfa Metinleri</h2>
    <p>${anaLinkler}</p>
  </div>
  <div class="kutu">
    <h2>Kurumsal / Politika Sayfaları</h2>
    <p>${proseLinkler}</p>
  </div>`;
  return adminLayout("/admin/aciklamalar/", "Açıklama Güncelleme", body);
}

function adminSiparislerPage() {
  const orderRows = store.orders.slice().reverse().map((o) => {
    const d = store.dealers.find((x) => x.id === o.dealerId);
    return `<tr><td><strong>${esc(o.no)}</strong></td><td>${esc(d ? d.firma : "?")}</td>
      <td>${new Date(o.tarih).toLocaleString("tr-TR")}</td>
      <td>${o.kalemler.map((k) => esc(k.ad) + " × " + k.adet).join("<br>")}</td>
      <td>${o.toplam ? paraFmt(o.toplam) : "—"}</td>
      <td>${esc(o.not || "")}</td></tr>`;
  }).join("");
  const quoteRows = (store.quotes || []).slice().reverse().slice(0, 30).map((q) => `
    <tr><td>${new Date(q.tarih).toLocaleString("tr-TR")}</td><td>${esc(q.ad)}<br><small>${esc(q.firma || "")}</small></td>
    <td>${esc(q.eposta)}<br><small>${esc(q.telefon)}</small></td><td>${esc(q.urun)}</td><td>${esc(q.mesaj || "")}</td></tr>`).join("");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Siparişler</h1>
  <p class="portal-sub">Bayi siparişleri ve web sitesi teklif talepleri.</p>
  <div class="kutu">
    <h2>Bayi Siparişleri</h2>
    ${store.orders.length ? `<table class="liste"><thead><tr><th>No</th><th>Bayi</th><th>Tarih</th><th>Ürünler</th><th>Tutar</th><th>Not</th></tr></thead><tbody>${orderRows}</tbody></table>` : "<p>Henüz sipariş yok.</p>"}
  </div>
  <div class="kutu">
    <h2>Web Sitesi Teklif Talepleri <small style="font-weight:400">(son 30)</small></h2>
    ${(store.quotes || []).length ? `<table class="liste"><thead><tr><th>Tarih</th><th>Ad / Firma</th><th>İletişim</th><th>Ürün</th><th>Mesaj</th></tr></thead><tbody>${quoteRows}</tbody></table>` : "<p>Henüz talep yok.</p>"}
  </div>`;
  return adminLayout("/admin/siparisler/", "Siparişler", body);
}

function icerikDuzenlePage(key, msg) {
  const region = regionOf(key);
  if (!region) return null;
  const current = store.content[key] !== undefined ? store.content[key] : region.original;
  const text = htmlToText(current);
  const degisik = store.content[key] !== undefined;
  const body = `
  <p><a href="/admin/aciklamalar/">← Açıklama &amp; Metinler</a></p>
  <span class="eyebrow">İçerik Düzenle</span>
  <h1 class="portal-title" style="font-size:1.6rem">${esc(region.meta.label)}</h1>
  <p class="portal-sub">Paragrafları boş satırla ayırın; madde işareti için satıra <span class="kod">- </span> ile başlayın.
  ${degisik ? ' <span class="durum durum-onayli">Düzenlenmiş</span>' : ' <span class="durum durum-beklemede">Orijinal</span>'}</p>
  ${msg || ""}
  <form class="kutu" method="post" action="/admin/icerik/" style="max-width:860px">
    <input type="hidden" name="key" value="${esc(key)}">
    <textarea name="metin" rows="${isInlineKey(key) ? 3 : 16}" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:14px;font:inherit;line-height:1.6">${esc(text)}</textarea>
    <p class="mt-2">
      <button class="btn btn-accent" name="islem" value="kaydet">Değişikliği Kaydet</button>
      ${degisik ? '<button class="btn btn-outline" name="islem" value="sifirla" onclick="return confirm(\'Orijinal metne dönülsün mü?\')">Orijinale Döndür</button>' : ""}
    </p>
    <p><small>Kaydettiğiniz anda web sitesinde yayına girer.</small></p>
  </form>`;
  return pageShell("İçerik Düzenle", body, { nav: adminNav("/admin/aciklamalar/") });
}

/* ---------------- statik dosya sunumu ---------------- */

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon", ".pdf": "application/pdf",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt"]);

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.normalize(path.join(ROOT, p));
  if (!resolved.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  let file = resolved;
  try {
    let st = fs.statSync(file);
    if (st.isDirectory()) { file = path.join(file, "index.html"); st = fs.statSync(file); }
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    return res.end('<meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Sayfa bulunamadı — <a href="/">Ana sayfa</a></p>');
  }
  if (path.basename(file).startsWith(".") || file.includes(path.join("server", "data"))) { res.writeHead(404); return res.end(); }
  const ext = path.extname(file).toLowerCase();
  const size = fs.statSync(file).size;
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff" };
  headers["Cache-Control"] = p.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  // Video/büyük dosyalar için Range (kısmi içerik) desteği — Safari video için bunu şart koşar
  headers["Accept-Ranges"] = "bytes";
  const range = (req.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  if (range && !COMPRESSIBLE.has(ext)) {
    let start = range[1] ? parseInt(range[1], 10) : 0;
    let end = range[2] ? parseInt(range[2], 10) : size - 1;
    if (isNaN(start) || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = end - start + 1;
    res.writeHead(206, headers);
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.has(ext)) {
    headers["Vary"] = "Accept-Encoding"; // ara önbellekler gzip'li/gzipsiz kopyayı karıştırmasın
    if (ext === ".html") {
      headers["X-Frame-Options"] = "SAMEORIGIN";
      headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    }
    let raw = fs.readFileSync(file);
    if (ext === ".html") raw = Buffer.from(applyOverrides(raw.toString("utf8"))); // admin içerik düzeltmeleri
    if (acceptsGzip) {
      headers["Content-Encoding"] = "gzip";
      res.writeHead(200, headers);
      return res.end(zlib.gzipSync(raw));
    }
    headers["Content-Length"] = raw.length;
    res.writeHead(200, headers);
    return res.end(raw);
  }
  headers["Content-Length"] = size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

/* ---------------- yönlendirici ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/\/+$/, "/") === "/" ? "/" : url.pathname.replace(/\/$/, "") + "/";
  const cookies = req.headers.cookie;
  const bayiSes = readSession(cookies, "bayi");
  const adminSes = readSession(cookies, "yonetim");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  const send = (html, code = 200) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" }); res.end(html); };
  const redirect = (loc) => { res.writeHead(303, { Location: loc }); res.end(); };

  try {
    /* ---- Bayilik başvurusu ---- */
    if (p === "/bayilik-al/") {
      if (req.method === "GET") return send(bayilikAlPage(url.searchParams.get("ok") ? '<p class="msg msg-ok">Başvurunuz alındı! Onaylandığında e-posta adresinize aktivasyon bağlantısı göndereceğiz.</p>' : ""));
      const f = parseForm(await readBody(req));
      if (f.web_site) return redirect("/bayilik-al/?ok=1");
      const firma = clamp(f.firma, 120), yetkili = clamp(f.yetkili, 120), eposta = clamp(f.eposta, 180).toLowerCase(),
        telefon = clamp(f.telefon, 40), adres = clamp(f.adres, 300),
        lat = parseFloat(f.lat), lng = parseFloat(f.lng);
      if (!firma || !yetkili || !telefon || !adres || !emailOk(eposta) || !isFinite(lat) || !isFinite(lng))
        return send(bayilikAlPage('<p class="msg msg-err">Lütfen tüm zorunlu alanları doldurun ve haritada konum işaretleyin.</p>'));
      if (store.dealers.some((d) => d.eposta === eposta && d.durum !== "reddedildi"))
        return send(bayilikAlPage('<p class="msg msg-err">Bu e-posta ile daha önce başvuru yapılmış.</p>'));
      store.dealers.push({
        id: crypto.randomUUID(), firma, yetkili, eposta, telefon, adres,
        lat, lng, durum: "beklemede", kayitTarihi: Date.now(),
      });
      saveStore();
      sendMail(ORDER_EMAIL, "Yeni bayilik başvurusu: " + firma,
        `Firma: ${firma}\nYetkili: ${yetkili}\nE-posta: ${eposta}\nTelefon: ${telefon}\nAdres: ${adres}\n\nOnaylamak için yönetim paneline girin.`);
      return redirect("/bayilik-al/?ok=1");
    }

    /* ---- Bayi girişi ---- */
    if (p === "/bayi/giris/") {
      if (req.method === "GET") return send(bayiGirisPage());
      const f = parseForm(await readBody(req));
      const eposta = clamp(f.eposta, 180).toLowerCase();
      const key = "b:" + ip + ":" + eposta;
      if (rateLimited(key)) return send(bayiGirisPage('<p class="msg msg-err">Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.</p>'), 429);
      const d = store.dealers.find((x) => x.eposta === eposta);
      if (!d || !verifyPassword(f.parola || "", d.salt, d.hash)) {
        recordFail(key);
        if (d && d.durum === "beklemede") return send(bayiGirisPage('<p class="msg msg-info">Başvurunuz henüz onaylanmadı. Onaylandığında e-posta alacaksınız.</p>'));
        if (d && d.durum === "onayli" && !d.salt) return send(bayiGirisPage('<p class="msg msg-info">Hesabınız onaylandı ancak henüz etkinleştirilmedi. E-postanızdaki aktivasyon bağlantısını kullanın.</p>'));
        return send(bayiGirisPage('<p class="msg msg-err">E-posta veya parola hatalı.</p>'));
      }
      if (d.durum !== "onayli") return send(bayiGirisPage('<p class="msg msg-err">Hesabınız aktif değil.</p>'));
      setCookie(res, "bayi", makeSession({ t: "bayi", id: d.id }, 7), 7 * 86400);
      return redirect("/bayi/");
    }

    /* ---- Aktivasyon ---- */
    if (p === "/bayi/aktivasyon/") {
      const token = req.method === "GET" ? url.searchParams.get("token") : null;
      if (req.method === "GET") {
        const d = store.dealers.find((x) => x.token && x.token === token && x.durum === "onayli");
        if (!d) return send(pageShell("Aktivasyon", '<p class="msg msg-err">Aktivasyon bağlantısı geçersiz ya da kullanılmış.</p>'), 400);
        return send(aktivasyonPage(token));
      }
      const f = parseForm(await readBody(req));
      const d = store.dealers.find((x) => x.token && x.token === f.token && x.durum === "onayli");
      if (!d) return send(pageShell("Aktivasyon", '<p class="msg msg-err">Aktivasyon bağlantısı geçersiz.</p>'), 400);
      if ((f.p1 || "").length < 8 || f.p1 !== f.p2)
        return send(aktivasyonPage(f.token, '<p class="msg msg-err">Parolalar eşleşmeli ve en az 8 karakter olmalı.</p>'));
      Object.assign(d, hashPassword(f.p1));
      delete d.token;
      saveStore();
      setCookie(res, "bayi", makeSession({ t: "bayi", id: d.id }, 7), 7 * 86400);
      return redirect("/bayi/");
    }

    /* ---- Bayi portalı ---- */
    if (p === "/bayi/") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      return send(bayiPortalPage(d, url.searchParams.get("no") ? `<p class="msg msg-ok">Siparişiniz oluşturuldu! Sipariş numaranız: <strong>${esc(url.searchParams.get("no"))}</strong>. Ekibimiz en kısa sürede sizi arayacak.</p>` : ""));
    }

    /* ---- Sipariş oluştur ---- */
    if (p === "/bayi/siparis/" && req.method === "POST") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const f = parseForm(await readBody(req));
      const kalemler = [];
      let toplam = 0;
      for (const [slug, name] of PRODUCTS) {
        const n = parseInt(f["adet_" + slug] || "0", 10);
        if (n > 0) {
          const fiyat = (store.prodMeta[slug] || {}).fiyat || 0;
          kalemler.push({ slug, ad: name, adet: Math.min(n, 99999), fiyat });
          toplam += fiyat * Math.min(n, 99999);
        }
      }
      if (!kalemler.length) return send(bayiPortalPage(d, '<p class="msg msg-err">Sipariş için en az bir üründe adet girin.</p>'));
      const no = orderNo();
      store.orders.push({ id: crypto.randomUUID(), no, dealerId: d.id, tarih: Date.now(), kalemler, toplam, not: clamp(f.not, 1000) });
      saveStore();
      sendMail(ORDER_EMAIL, `Yeni bayi siparişi ${no} — ${d.firma}`,
        `Bayi: ${d.firma} (${d.yetkili})\nE-posta: ${d.eposta}\nTelefon: ${d.telefon}\n\nSipariş No: ${no}\n\n` +
        kalemler.map((k) => `- ${k.ad} × ${k.adet}` + (k.fiyat ? ` (birim ${paraFmt(k.fiyat)}, tutar ${paraFmt(k.fiyat * k.adet)})` : "")).join("\n") +
        (toplam ? `\n\nAra Toplam: ${paraFmt(toplam)} (KDV hariç)` : "") +
        (f.not ? `\n\nNot: ${clamp(f.not, 1000)}` : ""));
      return redirect("/bayi/?no=" + encodeURIComponent(no));
    }

    if (p === "/bayi/cikis/") { setCookie(res, "bayi", "x", 0); return redirect("/"); }

    /* ---- Admin ---- */
    if (p === "/admin/" || p === "/admin/giris/") {
      if (!adminSes) {
        if (req.method === "GET") return send(adminGirisPage());
        const f = parseForm(await readBody(req));
        const key = "a:" + ip;
        if (rateLimited(key)) return send(adminGirisPage('<p class="msg msg-err">Çok fazla deneme. 15 dakika sonra tekrar deneyin.</p>'), 429);
        const okEmail = clamp(f.eposta, 180).toLowerCase() === store.admin.email.toLowerCase();
        const okPw = verifyPassword(f.parola || "", store.admin.salt, store.admin.hash);
        if (!okEmail || !okPw) { recordFail(key); return send(adminGirisPage('<p class="msg msg-err">E-posta veya parola hatalı.</p>')); }
        setCookie(res, "yonetim", makeSession({ t: "admin" }, 1), 86400);
        return redirect("/admin/");
      }
      return send(adminOzetPage());
    }

    if ((p === "/admin/onayla/" || p === "/admin/reddet/") && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      const d = store.dealers.find((x) => x.id === f.id);
      if (d && p === "/admin/onayla/") {
        d.durum = "onayli";
        d.onayTarihi = Date.now();
        d.token = crypto.randomBytes(24).toString("base64url");
        saveStore();
        const base = (IS_PROD ? "https://" : "http://") + (req.headers.host || "localhost");
        sendMail(d.eposta, "Maxx Global bayilik başvurunuz onaylandı",
          `Sayın ${d.yetkili},\n\n${d.firma} adına yaptığınız bayilik başvurusu onaylanmıştır.\n` +
          `Hesabınızı etkinleştirmek için: ${base}/bayi/aktivasyon/?token=${d.token}\n\nMaxx Global Medikal`);
      } else if (d) {
        d.durum = "reddedildi";
        saveStore();
      }
      return redirect("/admin/onaylar/");
    }

    /* ---- Admin: menü sayfaları ---- */
    if (p === "/admin/onaylar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminOnaylarPage());
    }
    if (p === "/admin/fiyatlar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminFiyatlarPage(url.searchParams.get("ok") ? '<p class="msg msg-ok">Fiyatlar kaydedildi — bayi portalında şu anda geçerli.</p>' : ""));
    }
    if (p === "/admin/aciklamalar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminAciklamalarPage());
    }
    if (p === "/admin/siparisler/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminSiparislerPage());
    }
    if (p === "/admin/api/yeni/") {
      if (!adminSes) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end("{}"); }
      const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
      const basvurular = store.dealers.filter((d) => d.kayitTarihi > since).map((d) => ({ firma: d.firma }));
      const siparisler = store.orders.filter((o) => o.tarih > since).map((o) => {
        const d = store.dealers.find((x) => x.id === o.dealerId);
        return { no: o.no, firma: d ? d.firma : "" };
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ now: Date.now(), basvurular, siparisler }));
    }

    /* ---- Admin: içerik düzenleme ---- */
    if (p === "/admin/icerik/") {
      if (!adminSes) return redirect("/admin/");
      if (req.method === "GET") {
        const html = icerikDuzenlePage(url.searchParams.get("key") || "");
        return html ? send(html) : send(pageShell("Hata", '<p class="msg msg-err">Düzenlenebilir bölge bulunamadı. <a href="/admin/aciklamalar/">Geri dön</a></p>'), 404);
      }
      const f = parseForm(await readBody(req));
      const key = f.key || "";
      if (!EDITABLE[key]) return redirect("/admin/");
      if (f.islem === "sifirla") {
        delete store.content[key];
        saveStore();
        return send(icerikDuzenlePage(key, '<p class="msg msg-ok">Orijinal metne dönüldü ve yayına alındı.</p>'));
      }
      const metin = String(f.metin || "").slice(0, 20000).trim();
      if (!metin) return send(icerikDuzenlePage(key, '<p class="msg msg-err">Metin boş olamaz.</p>'));
      store.content[key] = textToHtml(metin, isInlineKey(key));
      saveStore();
      return send(icerikDuzenlePage(key, '<p class="msg msg-ok">Kaydedildi — web sitesinde şu anda yayında.</p>'));
    }

    /* ---- Admin: bayi fiyatları ---- */
    if (p === "/admin/fiyatlar/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      for (const [slug] of PRODUCTS) {
        const v = parseFloat(String(f["fiyat_" + slug] || "").replace(",", "."));
        if (isFinite(v) && v > 0) store.prodMeta[slug] = { ...(store.prodMeta[slug] || {}), fiyat: Math.round(v * 100) / 100 };
        else if (store.prodMeta[slug]) delete store.prodMeta[slug].fiyat;
      }
      saveStore();
      return redirect("/admin/fiyatlar/?ok=1");
    }

    if (p === "/admin/cikis/") { setCookie(res, "yonetim", "x", 0); return redirect("/"); }

    /* ---- Statik sitedeki teklif formu (PHP yerine) ---- */
    if (url.pathname === "/form-handler.php" && req.method === "POST") {
      const f = parseForm(await readBody(req));
      const thanks = f.lang === "en" ? "/en/thank-you/" : "/tesekkurler/";
      if (!f.web_site && f.ad_soyad && emailOk(f.eposta || "")) {
        store.quotes.push({
          tarih: Date.now(), ad: clamp(f.ad_soyad, 120), firma: clamp(f.firma, 120),
          eposta: clamp(f.eposta, 180), telefon: clamp(f.telefon, 40),
          urun: clamp(f.urun, 120), mesaj: clamp(f.mesaj, 3000),
        });
        saveStore();
        sendMail(ORDER_EMAIL, "Web sitesi teklif talebi: " + clamp(f.urun, 120),
          `Ad: ${clamp(f.ad_soyad, 120)}\nFirma: ${clamp(f.firma, 120)}\nE-posta: ${clamp(f.eposta, 180)}\nTelefon: ${clamp(f.telefon, 40)}\nÜrün: ${clamp(f.urun, 120)}\n\n${clamp(f.mesaj, 3000)}`);
      }
      return redirect(thanks);
    }

    /* ---- Statik site ---- */
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Sunucu hatası");
  }
});

loadStore();
const generatedPw = ensureAdmin();
server.listen(PORT, () => {
  console.log(`Maxx Global sitesi + bayi portalı: http://localhost:${PORT}`);
  console.log(`Yönetim paneli: http://localhost:${PORT}/admin/  (${store.admin.email})`);
  if (generatedPw) console.log(`İlk kurulum yönetici parolası: ${generatedPw}  ← .env dosyasına da yazıldı sanmayın; kaydedin!`);
  if (!RESEND_KEY) console.log("Not: RESEND_API_KEY tanımlı değil — e-postalar konsola yazılır.");
});
