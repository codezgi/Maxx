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
  store.settings = store.settings || { fiyatGoster: false }; // bayilere fiyat gösterimi anahtarı
  store.thanks = store.thanks || [];     // bayi teşekkür mesajları
  store.customProducts = store.customProducts || []; // admin'in eklediği ürünler
  for (const o of store.orders) {        // eski siparişleri yeni akışa taşı
    if (!o.durum) { o.durum = "teslim"; o.fiyat = o.toplam || null; o.adminOnay = true; o.bayiOnay = true; }
  }
  for (const d of store.dealers) {       // şehir alanı olmayan eski kayıtlar
    if (!d.sehir) {
      const p = (d.adres || "").replace(/\//g, " ").trim().split(/[\s,]+/);
      d.sehir = p.length ? p[p.length - 1] : "Bilinmiyor";
    }
    if (!d.lang) d.lang = "tr";
  }
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
   if (process.env.ADMIN_PASSWORD) { const _h = hashPassword(process.env.ADMIN_PASSWORD); store.admin = { email: process.env.ADMIN_EMAIL || "info@maxx-global.net", salt: _h.salt, hash: _h.hash }; saveStore(); return null; }
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

function readBody(req, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > maxBytes) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
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
const PARA_BIRIMLERI = {
  TRY: { ad: "TL", simge: "₺" },
  USD: { ad: "Dolar", simge: "$" },
  EUR: { ad: "Euro", simge: "€" },
};
const paraBirimi = (kod) => PARA_BIRIMLERI[kod] ? kod : "TRY";
const paraFmt = (n, kod = "TRY") =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: paraBirimi(kod) }).format(n);
const siparisParaFmt = (o, n) => paraFmt(n, o && o.paraBirimi);

/* Sipariş akışı: fiyat_bekliyor → fiyat_verildi → (çift onay) hazirlaniyor → kargoda → teslim */
const DURUM_TR = { fiyat_bekliyor: "Fiyat Bekleniyor", fiyat_verildi: "Onay Bekleniyor",
  hazirlaniyor: "Hazırlanıyor", kargoda: "Kargoya Verildi", teslim: "Teslim Edildi" };
const DURUM_EN = { fiyat_bekliyor: "Awaiting Price", fiyat_verildi: "Awaiting Approval",
  hazirlaniyor: "Preparing", kargoda: "Shipped", teslim: "Delivered" };
const DURUM_RENK = { fiyat_bekliyor: "beklemede", fiyat_verildi: "beklemede",
  hazirlaniyor: "onayli", kargoda: "onayli", teslim: "onayli" };

/* İndirim %'lik ya da sabit tutar (₺) olabilir; eski kayıtlarla geriye uyumlu */
function indirimTutarOf(o) {
  if (o.indirimTutar != null) return o.indirimTutar;
  if (o.indirim && o.araToplam) return Math.round(o.araToplam * o.indirim) / 100;
  return 0;
}
function indirimEtiketi(o) {
  if (o.indirimTip === "tutar") return siparisParaFmt(o, o.indirimDeger || o.indirimTutar || 0);
  return "%" + (o.indirimDeger ?? o.indirim ?? 0);
}

function kargoStepper(durum, lang) {
  const adimlar = lang === "en"
    ? [["hazirlaniyor", "Preparing"], ["kargoda", "Shipped"], ["teslim", "Delivered"]]
    : [["hazirlaniyor", "Hazırlanıyor"], ["kargoda", "Kargoya Verildi"], ["teslim", "Teslim Edildi"]];
  const sira = ["hazirlaniyor", "kargoda", "teslim"].indexOf(durum);
  const sonIndex = adimlar.length - 1;
  return '<div class="stepper">' + adimlar.map(([k, ad], i) => {
    // "teslim" son adımdır; o duruma ulaşıldığında sonraki bir adım olmadığı için
    // kendisi de tamamlanmış sayılıp diğerleri gibi ✓ almalı.
    const tamam = i < sira || (i === sira && i === sonIndex);
    const cls = tamam ? "tamam" : (i === sira ? "aktif" : "");
    return `<div class="adim ${cls}"><span class="nokta">${tamam ? "✓" : i + 1}</span><small>${ad}</small></div>`;
  }).join('<div class="cizgi"></div>') + "</div>";
}

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
    ["hakkimizda:tr", "Hakkımızda — Sayfa Metni (TR)", "hakkimizda/index.html"],
    ["hakkimizda:en", "About Us — Sayfa Metni (EN)", "en/about-us/index.html"],
    ["vm:vizyon:tr", "Vizyonumuz (TR)", "vizyon-misyon/index.html"],
    ["vm:misyon:tr", "Misyonumuz (TR)", "vizyon-misyon/index.html"],
    ["vm:vizyon:en", "Our Vision (EN)", "en/vision-mission/index.html"],
    ["vm:misyon:en", "Our Mission (EN)", "en/vision-mission/index.html"],
  ]) idx[k] = { file: f, label: lbl };
  const degerAdlari = ["Kalite Odaklılık", "Güvenilirlik", "Yenilikçilik", "Müşteri Memnuniyeti", "Sürdürülebilirlik", "Etik ve Şeffaflık"];
  for (let n = 1; n <= 6; n++) {
    idx[`deger:${n}:tr`] = { file: "degerlerimiz/index.html", label: `Değerlerimiz — ${degerAdlari[n-1]} (TR)` };
    idx[`deger:${n}:en`] = { file: "en/our-values/index.html", label: `Our Values — ${degerAdlari[n-1]} (EN)` };
  }
  for (const [p, lbl] of PROSE_TR) idx["sayfa:" + p] = { file: p.slice(1) + "index.html", label: lbl };
  for (const [p, lbl] of PROSE_EN) idx["sayfa:" + p] = { file: p.slice(1) + "index.html", label: lbl };
  for (const [slug, name] of PRODUCTS) {
    idx[`urun:${slug}:tr`] = { file: slug + "/index.html", label: name + " — Açıklama (TR)" };
    idx[`urun:${slug}:en`] = { file: slug + "-en/index.html", label: name + " — Açıklama (EN)" };
    idx[`spec:${slug}:tr`] = { file: slug + "/index.html", label: name + " — Teknik Tablo (TR)" };
    idx[`spec:${slug}:en`] = { file: slug + "-en/index.html", label: name + " — Teknik Tablo (EN)" };
    idx[`sss:${slug}:tr`] = { file: slug + "/index.html", label: name + " — SSS (TR)" };
    idx[`sss:${slug}:en`] = { file: slug + "-en/index.html", label: name + " — SSS (EN)" };
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
const unesc = (x) => String(x).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/* Teknik tablo: her satır "Başlık | Değer" */
function specToText(html) {
  return [...html.matchAll(/<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)]
    .map((r) => unesc(r[1]).replace(/\s+/g, " ").trim() + " | " + unesc(r[2]).replace(/\s+/g, " ").trim())
    .join("\n");
}
function textToSpec(t) {
  return t.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    const k = (i === -1 ? l : l.slice(0, i)).trim();
    const v = (i === -1 ? "" : l.slice(i + 1)).trim();
    return `          <tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  }).join("\n");
}

/* SSS: soru + altına cevap; çiftler boş satırla ayrılır */
function sssToText(html) {
  return [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((b) => unesc(b[1]).replace(/\s+/g, " ").trim() + "\n" + unesc(b[2]).replace(/\s+/g, " ").trim())
    .join("\n\n");
}
function sssParse(t) {
  return t.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    return { q: lines[0] || "", a: lines.slice(1).join(" ") };
  }).filter((x) => x.q && x.a);
}
function textToSss(t) {
  return sssParse(t).map((x) => `        <details>
          <summary>${esc(x.q)}</summary>
          <p>${esc(x.a)}</p>
        </details>`).join("\n");
}
function sssLdScript(t) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": sssParse(t).map((x) => ({
      "@type": "Question", "name": x.q,
      "acceptedAnswer": { "@type": "Answer", "text": x.a },
    })),
  };
  return '<script type="application/ld+json">' + JSON.stringify(ld) + "<" + "/script>";
}

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
  // Yeni ürünleri ürün listesine ekle
  if (store.customProducts.length && html.includes("<!--custom:urunler:")) {
    for (const lang of ["tr", "en"]) {
      const marker = `<!--custom:urunler:${lang}-->`;
      if (html.includes(marker)) {
        const cards = store.customProducts.map((cp) => customProductCard(cp, lang)).join("\n");
        html = html.replace(marker, cards);
      }
    }
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
  .stepper { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; }
  .stepper .adim { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 84px; }
  .stepper .nokta { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
    background: #eef2f3; color: var(--text); font-weight: 700; font-size: .82rem; border: 2px solid var(--line); }
  .stepper .adim.aktif .nokta { background: var(--accent); border-color: var(--accent); color: #fff; box-shadow: 0 0 0 4px rgba(0,168,188,.18); }
  .stepper .adim.tamam .nokta { background: #14b866; border-color: #14b866; color: #fff; }
  .stepper .adim small { font-size: .72rem; font-weight: 600; color: var(--text); text-align: center; }
  .stepper .adim.aktif small, .stepper .adim.tamam small { color: var(--heading); }
  .stepper .cizgi { flex: 1; height: 2px; background: var(--line); min-width: 18px; margin-bottom: 18px; }
  .urun-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; }
  .urun-kart { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--white);
    display: flex; flex-direction: column; transition: box-shadow .25s, transform .25s; }
  .urun-kart:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
  .urun-kart img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: var(--soft); }
  .urun-kart .uk-govde { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .urun-kart strong { font-size: .88rem; color: var(--heading); line-height: 1.35; }
  .urun-kart .uk-fiyat { font-size: .85rem; color: var(--accent-dark, #008a9b); font-weight: 700; }
  .uk-adet { display: flex; gap: 8px; margin-top: auto; }
  .uk-adet input { width: 64px; border: 1.5px solid var(--line); border-radius: 8px; padding: 7px 8px; text-align: center; }
  .uk-adet button { flex: 1; }
  .sepet-bar { position: sticky; top: 12px; z-index: 50; }
  .sepet-kutu { background: var(--primary); color: rgba(255,255,255,.85); border-radius: 14px; padding: 18px 22px; }
  .sepet-kutu h2 { color: #fff; font-size: 1.05rem; margin-bottom: 10px; }
  .sepet-kutu table { width: 100%; font-size: .88rem; border-collapse: collapse; }
  .sepet-kutu td { padding: 5px 4px; border-bottom: 1px solid rgba(255,255,255,.12); }
  .sepet-kutu .cikar { color: #ff9d9d; font-weight: 700; padding: 2px 8px; }
  .sepet-bos { opacity: .7; font-size: .9rem; }
  .ara-kutu { width: 100%; max-width: 420px; border: 1.5px solid var(--line); border-radius: 10px; padding: 11px 14px; margin-bottom: 18px; }
  .onay-cizelge { display: flex; gap: 18px; font-size: .82rem; margin-top: 6px; }
  .onay-cizelge .ok { color: #14734a; font-weight: 700; }
  .alt-sekmeler { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
  .alt-sekme { padding: 9px 16px; border: 1px solid var(--line); border-radius: 999px;
    font-weight: 600; font-size: .88rem; color: var(--primary); background: var(--white); }
  .alt-sekme:hover { border-color: var(--accent); color: var(--accent); }
  .alt-sekme.aktif { background: var(--primary); color: #fff; border-color: var(--primary); }
  .alt-sayi { background: var(--soft); color: var(--primary); border-radius: 999px; padding: 1px 8px; font-size: .75rem; margin-left: 4px; }
  .alt-sekme.aktif .alt-sayi { background: rgba(255,255,255,.22); color: #fff; }
  .onay-cizelge .bekliyor { color: #8a6100; font-weight: 700; }
  .sepet-fab { position: fixed; right: 22px; bottom: 22px; z-index: 300;
    background: linear-gradient(135deg, #00b9ce, #008a9b); color: #fff; border: 0;
    border-radius: 999px; padding: 15px 24px; font-weight: 700; font-size: 1rem;
    box-shadow: 0 12px 30px -8px rgba(0, 138, 155, .65); display: flex; gap: 10px; align-items: center;
    cursor: pointer; transition: transform .2s; }
  .sepet-fab:hover { transform: translateY(-2px); }
  .fab-badge { background: #fff; color: var(--primary); border-radius: 999px; min-width: 26px; height: 26px;
    display: grid; place-items: center; font-size: .85rem; font-weight: 800; padding: 0 7px; }
  .ikon-sepet { width: 18px; height: 18px; flex: none; vertical-align: -3px; }
  .sepet-fab.zipla { animation: fabzip .45s ease; }
  @keyframes fabzip { 30% { transform: scale(1.18); } 60% { transform: scale(.94); } }
  .ucan-img { position: fixed; z-index: 500; object-fit: cover; border-radius: 12px;
    pointer-events: none; transition: all .7s cubic-bezier(.3, .7, .4, 1);
    box-shadow: 0 10px 24px rgba(0, 0, 0, .25); }
  .sepet-satir { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .sepet-satir img { width: 56px; height: 42px; object-fit: cover; border-radius: 8px; background: var(--soft); }
  .sepet-satir strong { flex: 1; font-size: .9rem; color: var(--heading); }
  .adet-step { display: flex; align-items: center; gap: 8px; }
  .adet-step button { width: 30px; height: 30px; border-radius: 8px; background: var(--soft); font-weight: 800; color: var(--primary); }
  .adet-step button:hover { background: var(--accent); color: #fff; }
  .sepet-kaldir { color: #b23333; font-weight: 700; padding: 4px 8px; }
  .fiyat-tablo td, .fiyat-tablo th { padding: 8px 10px; }
  .fiyat-tablo input.birim { width: 110px; border: 1.5px solid var(--line); border-radius: 8px; padding: 7px 9px; }
  .fiyat-ozet { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; margin-top: 12px; font-size: .95rem; }
  .fiyat-ozet .genel { font-size: 1.2rem; font-weight: 800; color: var(--heading); }
  .doviz-sec { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 14px; }
  .doviz-sec input { position: absolute; opacity: 0; pointer-events: none; }
  .doviz-sec span { display: flex; align-items: center; gap: 7px; min-width: 92px; justify-content: center;
    border: 1.5px solid var(--line); border-radius: 10px; padding: 9px 12px; font-weight: 800;
    color: var(--heading); background: #fff; cursor: pointer; }
  .doviz-sec input:checked + span { border-color: var(--accent); background: rgba(0, 168, 188, .1); color: var(--accent-dark, #008a9b); }
  @media print {
    .portal-header, .yazdirma-gizle, .sepet-fab { display: none !important; }
    body { background: #fff; } .kutu { border: 0; box-shadow: none; padding: 0; }
  }
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

/* ---------------- sayfalar: BAYİ (TR/EN) ---------------- */

const BL = {
tr: {
  code: "tr", basvuru: "Bayilik Başvurusu", giris: "Bayi Girişi", portal: "Bayi Portalı",
  basvuru_alt: 'Formu doldurun; başvurunuz onaylandığında e-posta adresinize aktivasyon bağlantısı gönderilecektir.',
  basvuru_btn: "Zaten bayimiz misiniz? Giriş Yapın", giris_btn: "Bayilik Başvurusu Yapın",
  giris_alt: 'Bayi portalına hoş geldiniz.',
  firma: "Firma Adı *", yetkili: "Yetkili Ad Soyad *", eposta: "E-posta *", telefon: "Telefon *",
  sehir: "Şehir *", adres: "Açık Adres *", adres_ph: "Mahalle, cadde, no, ilçe, il",
  harita_bul: "Haritada Bul", harita_lbl: "Haritada Konumunuz *",
  harita_ip: "(adresi yazınca otomatik işaretlenir; gerekirse iğneyi sürükleyin ya da haritaya tıklayın)",
  bos_birak: "Boş bırakın", gonder: "Başvuruyu Gönder",
  form_not: "Başvurunuz onaylanana kadar hesabınız etkinleşmez. Bilgileriniz üçüncü kişilerle paylaşılmaz.",
  parola: "Parola", giris_yap: "Giriş Yap", siteye_don: "← Siteye Dön", cikis: "Çıkış Yap",
  hosgeldin: "Hoş geldiniz", portal_alt: "Ürünlerden sepetinize ekleyip sipariş isteği oluşturun; ekibimiz fiyat teklifiyle dönüş yapacaktır.",
  urunler: "Ürünler", sepet: "Sepetim", sepet_bos: "Sepetiniz boş. Ürünlerden adet belirleyip ekleyin.",
  sepete_ekle: "Sepete Ekle", cikar: "✕", adet: "adet", not_lbl: "Sipariş Notu (isteğe bağlı)",
  istek_olustur: "Sipariş İsteği Oluştur", siparislerim: "Siparişlerim", siparis_yok: "Henüz siparişiniz yok.",
  fiyat_teklif: "Fiyat Teklifi", teklif_msg: "siparişiniz için fiyat teklifimiz:", onayla: "Onayla",
  onay_bekle_admin: "Firma onayı bekleniyor", onay_sen: "Onayınız alındı",
  fiyat_bekliyor_msg: "Ekibimiz fiyat çalışması yapıyor; teklif hazır olduğunda burada göreceksiniz.",
  tesekkur_baslik: "Teşekkür Mesajı Gönder", tesekkur_ph: "Deneyiminizi bizimle paylaşın…",
  tesekkur_gonder: "Gönder", tesekkur_alindi: "Teşekkür mesajınız için minnettarız!",
  istek_alindi: "Sipariş isteğiniz alındı! Sipariş numaranız:", istek_alindi2: "Fiyat teklifimiz hazır olduğunda bu sayfada göreceksiniz.",
  toplam: "Tutar", durum: "Durum", tarih: "Tarih", urun_col: "Ürünler", no_col: "Sipariş No",
  fiyat_arayin: "", en_az_bir: "Sepetiniz boş — en az bir ürün ekleyin.",
  aktivasyon: "Hesap Aktivasyonu", akt_alt: "Başvurunuz onaylandı! Portala giriş için bir parola belirleyin.",
  p1: "Parola (en az 8 karakter)", p2: "Parola (tekrar)", etkinlestir: "Hesabı Etkinleştir",
  sifremi_unuttum: "Şifremi Unuttum", sifre_sifirla: "Parola Sıfırlama",
  sifre_sifirla_alt: "E-posta adresinizi girin; hesabınız kayıtlıysa parola sıfırlama bağlantısı gönderilecektir.",
  sifre_sifirla_akt_alt: "Yeni parolanızı belirleyin.",
  sifirlama_gonder: "Sıfırlama Bağlantısı Gönder", parola_guncelle: "Parolayı Güncelle",
  sifirlama_gonderildi_msg: "E-posta adresiniz sistemde kayıtlıysa, parola sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.",
  sepet_bak: "Sepeti İncele", sepet_onayla: "Sipariş İsteğini Onayla ve Gönder", kaldir: "Kaldır",
  teklif_dokum: "Teklif Dökümünü Görüntüle", pdf_indir: "PDF Olarak Kaydet / Yazdır",
  siparis_takip: "Sipariş Takibi",
  takip_alt: "Fiyat teklifleriniz, onaylarınız ve kargo durumunuz bu sayfada.",
  teklif_var: "fiyat teklifi onayınızı bekliyor",
  ara_toplam: "Ara Toplam", indirim_lbl: "İndirim", genel_toplam: "Genel Toplam",
  birim_lbl: "Birim Fiyat", satir_lbl: "Tutar", teklif_baslik: "Fiyat Teklifi", kapat: "Kapat",
  indirim_uygulandi: "indirim uygulandı",
},
en: {
  code: "en", basvuru: "Dealer Application", giris: "Dealer Login", portal: "Dealer Portal",
  basvuru_alt: 'Fill out the form; when approved, an activation link will be sent to your e-mail.',
  basvuru_btn: "Already a dealer? Log In", giris_btn: "Apply for Dealership",
  giris_alt: 'Welcome to the dealer portal.',
  firma: "Company Name *", yetkili: "Contact Person *", eposta: "E-mail *", telefon: "Phone *",
  sehir: "City *", adres: "Full Address *", adres_ph: "Street, number, district, city, country",
  harita_bul: "Find on Map", harita_lbl: "Your Location on the Map *",
  harita_ip: "(marked automatically from your address; drag the pin or click the map to adjust)",
  bos_birak: "Leave empty", gonder: "Submit Application",
  form_not: "Your account stays inactive until approved. Your information is never shared with third parties.",
  parola: "Password", giris_yap: "Log In", siteye_don: "← Back to Site", cikis: "Log Out",
  hosgeldin: "Welcome", portal_alt: "Add products to your cart and create an order request; our team will respond with a price quote.",
  urunler: "Products", sepet: "My Cart", sepet_bos: "Your cart is empty. Set quantities and add products.",
  sepete_ekle: "Add to Cart", cikar: "✕", adet: "pcs", not_lbl: "Order Note (optional)",
  istek_olustur: "Create Order Request", siparislerim: "My Orders", siparis_yok: "No orders yet.",
  fiyat_teklif: "Price Quote", teklif_msg: "our price quote for your order:", onayla: "Approve",
  onay_bekle_admin: "Awaiting company approval", onay_sen: "Your approval received",
  fiyat_bekliyor_msg: "Our team is preparing a quote; you will see it here once ready.",
  tesekkur_baslik: "Send a Thank-You Message", tesekkur_ph: "Share your experience with us…",
  tesekkur_gonder: "Send", tesekkur_alindi: "We are grateful for your message!",
  istek_alindi: "Your order request has been received! Order number:", istek_alindi2: "You will see our price quote on this page once ready.",
  toplam: "Amount", durum: "Status", tarih: "Date", urun_col: "Products", no_col: "Order No",
  fiyat_arayin: "", en_az_bir: "Your cart is empty — add at least one product.",
  aktivasyon: "Account Activation", akt_alt: "Your application is approved! Set a password to log in.",
  p1: "Password (min. 8 characters)", p2: "Password (repeat)", etkinlestir: "Activate Account",
  sifremi_unuttum: "Forgot Password?", sifre_sifirla: "Reset Password",
  sifre_sifirla_alt: "Enter your e-mail; if your account exists, a reset link will be sent.",
  sifre_sifirla_akt_alt: "Set your new password.",
  sifirlama_gonder: "Send Reset Link", parola_guncelle: "Update Password",
  sifirlama_gonderildi_msg: "If your e-mail is registered, a password reset link has been sent. Check your inbox.",
  sepet_bak: "Review Cart", sepet_onayla: "Confirm & Send Order Request", kaldir: "Remove",
  teklif_dokum: "View Quote Breakdown", pdf_indir: "Save as PDF / Print",
  siparis_takip: "Order Tracking",
  takip_alt: "Your price quotes, approvals and shipping status live here.",
  teklif_var: "price quote awaiting your approval",
  ara_toplam: "Subtotal", indirim_lbl: "Discount", genel_toplam: "Grand Total",
  birim_lbl: "Unit Price", satir_lbl: "Amount", teklif_baslik: "Price Quote", kapat: "Close",
  indirim_uygulandi: "discount applied",
},
};

function bayiDil(req, url, dealer) {
  if (url && url.searchParams.get("lang") === "en") return "en";
  if (url && url.searchParams.get("lang") === "tr") return "tr";
  if (dealer && dealer.lang) return dealer.lang;
  const m = (req.headers.cookie || "").match(/blang=(en|tr)/);
  return m ? m[1] : "tr";
}

function dilSec(lang, path) {
  return `<span style="font-weight:700"><a href="${path}?lang=en" ${lang==="en"?'style="color:var(--accent)"':""}>EN</a> / <a href="${path}?lang=tr" ${lang==="tr"?'style="color:var(--accent)"':""}>TR</a></span>`;
}

function bayilikAlPage(lang, msg) {
  const T = BL[lang];
  const body = `
  <span class="eyebrow">Maxx Global</span>
  <h1 class="portal-title" style="font-size:2rem">${T.basvuru}</h1>
  <p class="portal-sub">${T.basvuru_alt}</p>
  <p style="margin:-10px 0 26px"><a class="btn btn-outline btn-sm" href="/bayi/giris/${lang === "en" ? "?lang=en" : ""}">${T.basvuru_btn} →</a></p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayilik-al/" style="max-width:860px" onsubmit="return kontrol()">
    <input type="hidden" name="lang" value="${lang}">
    <div class="form-grid">
      <p class="form-field"><label for="firma">${T.firma}</label><input id="firma" name="firma" required maxlength="120"></p>
      <p class="form-field"><label for="yetkili">${T.yetkili}</label><input id="yetkili" name="yetkili" required maxlength="120"></p>
      <p class="form-field"><label for="eposta">${T.eposta}</label><input id="eposta" name="eposta" type="email" required maxlength="180"></p>
      <p class="form-field"><label for="telefon">${T.telefon}</label><input id="telefon" name="telefon" type="tel" required maxlength="40"></p>
      <p class="form-field"><label for="sehir">${T.sehir}</label><input id="sehir" name="sehir" required maxlength="80"></p>
      <p class="form-field"><label for="adres">${T.adres}</label>
        <span style="display:flex;gap:10px">
          <input id="adres" name="adres" required maxlength="300" style="flex:1" placeholder="${T.adres_ph}">
          <button type="button" class="btn btn-outline btn-sm" onclick="adresBul()">${T.harita_bul}</button>
        </span>
        <small id="adresDurum"></small>
      </p>
      <p class="form-field full">
        <label>${T.harita_lbl} <small>${T.harita_ip}</small></label>
        <span id="harita"></span>
        <input type="hidden" name="lat" id="lat"><input type="hidden" name="lng" id="lng">
      </p>
      <p class="hp-field" aria-hidden="true"><label for="web_site">${T.bos_birak}</label><input id="web_site" name="web_site" tabindex="-1" autocomplete="off"></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">${T.gonder}</button></p>
    <p class="form-note text-center">${T.form_not}</p>
  </form>`;
  const script = `<script>
    var marker, map = L.map('harita').setView([39.0, 35.2], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    function isaretle(lat, lng) {
      if (marker) marker.remove();
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', function () {
        var ll = marker.getLatLng();
        document.getElementById('lat').value = ll.lat.toFixed(6);
        document.getElementById('lng').value = ll.lng.toFixed(6);
      });
      document.getElementById('lat').value = (+lat).toFixed(6);
      document.getElementById('lng').value = (+lng).toFixed(6);
    }
    map.on('click', function (e) { isaretle(e.latlng.lat, e.latlng.lng); });
    var sonArama = 0;
    function adresBul() {
      var adres = document.getElementById('adres').value.trim();
      var sehir = document.getElementById('sehir').value.trim();
      var durum = document.getElementById('adresDurum');
      if (adres.length < 5 && sehir.length < 2) return;
      var simdi = Date.now(); if (simdi - sonArama < 1100) return; sonArama = simdi;
      durum.textContent = '…';
      var denemeler = [adres + ' ' + sehir, sehir].filter(Boolean);
      (function dene(i) {
        if (i >= denemeler.length) { durum.textContent = '${lang==="en"?"Not found — click the map to mark your location.":"Bulunamadı — haritaya tıklayarak işaretleyin."}'; return; }
        fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(denemeler[i]))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.length) {
              isaretle(parseFloat(d[0].lat), parseFloat(d[0].lon));
              map.setView([d[0].lat, d[0].lon], i === 0 ? 15 : 11);
              durum.textContent = '${lang==="en"?"Marked — verify and drag the pin if needed.":"İşaretlendi — doğrulayın, gerekirse iğneyi sürükleyin."}';
            } else setTimeout(function () { dene(i + 1); }, 1100);
          }).catch(function () { durum.textContent = '!'; });
      })(0);
    }
    document.getElementById('adres').addEventListener('change', adresBul);
    document.getElementById('sehir').addEventListener('change', adresBul);
    function kontrol() {
      if (!document.getElementById('lat').value) { alert('${lang==="en"?"Please mark your location on the map.":"Lütfen haritada konumunuzu işaretleyin."}'); return false; }
      return true;
    }
  </script>`;
  return pageShell(T.basvuru, body, { leaflet: true, script,
    nav: dilSec(lang, "/bayilik-al/") + `<a href="/">${T.siteye_don}</a>` });
}

function bayiGirisPage(lang, msg) {
  const T = BL[lang];
  const body = `
  <span class="eyebrow">${T.portal}</span>
  <h1 class="portal-title" style="font-size:2rem">${T.giris}</h1>
  <p class="portal-sub">${T.giris_alt}</p>
  <p style="margin:-10px 0 26px"><a class="btn btn-outline btn-sm" href="/bayilik-al/${lang === "en" ? "?lang=en" : ""}">${T.giris_btn} →</a></p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayi/giris/" style="max-width:480px">
    <input type="hidden" name="lang" value="${lang}">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="eposta">${T.eposta.replace(" *","")}</label><input id="eposta" name="eposta" type="email" required></p>
      <p class="form-field"><label for="parola">${T.parola}</label><input id="parola" name="parola" type="password" required></p>
    </div>
    <p style="text-align:right;margin-top:-10px"><a href="/bayi/sifremi-unuttum/${lang === "en" ? "?lang=en" : ""}" style="font-size:.9rem">${T.sifremi_unuttum}</a></p>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">${T.giris_yap}</button></p>
  </form>`;
  return pageShell(T.giris, body, { nav: dilSec(lang, "/bayi/giris/") + `<a href="/">${T.siteye_don}</a>` });
}

function sifremiUnuttumPage(lang, msg) {
  const T = BL[lang];
  const body = `
  <span class="eyebrow">${T.portal}</span>
  <h1 class="portal-title" style="font-size:2rem">${T.sifre_sifirla}</h1>
  <p class="portal-sub">${T.sifre_sifirla_alt}</p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayi/sifremi-unuttum/" style="max-width:480px">
    <input type="hidden" name="lang" value="${lang}">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="eposta">${T.eposta.replace(" *", "")}</label><input id="eposta" name="eposta" type="email" required></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">${T.sifirlama_gonder}</button></p>
  </form>
  <p class="mt-4 text-center"><a href="/bayi/giris/${lang === "en" ? "?lang=en" : ""}">← ${T.giris}</a></p>`;
  return pageShell(T.sifre_sifirla, body, { nav: dilSec(lang, "/bayi/sifremi-unuttum/") + `<a href="/">${T.siteye_don}</a>` });
}

function aktivasyonPage(lang, token, msg, isReset) {
  const T = BL[lang];
  const baslik = isReset ? T.sifre_sifirla : T.aktivasyon;
  const altYazi = isReset ? T.sifre_sifirla_akt_alt : T.akt_alt;
  const body = `
  <span class="eyebrow">${T.portal}</span>
  <h1 class="portal-title" style="font-size:2rem">${baslik}</h1>
  <p class="portal-sub">${altYazi}</p>
  ${msg || ""}
  <form class="form-wrap" method="post" action="/bayi/aktivasyon/" style="max-width:480px">
    <input type="hidden" name="token" value="${esc(token)}">
    <div class="form-grid" style="grid-template-columns:1fr">
      <p class="form-field"><label for="p1">${T.p1}</label><input id="p1" name="p1" type="password" minlength="8" required></p>
      <p class="form-field"><label for="p2">${T.p2}</label><input id="p2" name="p2" type="password" minlength="8" required></p>
    </div>
    <p class="mt-4 text-center"><button class="btn btn-accent" type="submit">${isReset ? T.parola_guncelle : T.etkinlestir}</button></p>
  </form>`;
  return pageShell(baslik, body);
}

const SEPET_SVG = '<svg class="ikon-sepet" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

function bayiPortalPage(dealer, lang, msg) {
  const T = BL[lang];
  const D = lang === "en" ? DURUM_EN : DURUM_TR;
  const fiyatAcik = store.settings.fiyatGoster;
  const myOrders = store.orders.filter((o) => o.dealerId === dealer.id);
  const bekleyenTeklif = myOrders.filter((o) => o.durum === "fiyat_verildi" && !o.bayiOnay).length;

  const urunKartlari = allDealerProducts().map(([slug, name]) => {
    const meta = store.prodMeta[slug] || {};
    const fiyat = fiyatAcik ? meta.fiyat : null;
    return `
      <div class="urun-kart">
        <img src="${prodImg(slug)}" alt="${esc(name)}" loading="lazy">
        <div class="uk-govde">
          <strong>${esc(name)}</strong>
          ${fiyat ? `<span class="uk-fiyat">${paraFmt(fiyat, meta.paraBirimi)}</span>` : ""}
          <div class="uk-adet">
            <input type="number" min="1" max="99999" value="1" id="adet-${slug}" aria-label="adet">
            <button type="button" class="btn btn-accent btn-sm" onclick="sepeteEkle('${slug}', this)">${SEPET_SVG} ${T.sepete_ekle}</button>
          </div>
        </div>
      </div>`;
  }).join("");

  const body = `
  <span class="eyebrow">${T.portal}</span>
  <h1 class="portal-title" style="font-size:2rem">${T.hosgeldin}, ${esc(dealer.firma)}</h1>
  <p class="portal-sub">${T.portal_alt}</p>
  ${msg || ""}
  ${bekleyenTeklif ? `<div class="msg msg-info">💰 <strong>${bekleyenTeklif}</strong> ${T.teklif_var} — <a href="/bayi/siparisler/">${T.siparis_takip} →</a></div>` : ""}
  <div class="kutu">
    <h2>${T.urunler}</h2>
    <div class="urun-grid">${urunKartlari}</div>
  </div>
  <button type="button" id="sepetFab" class="sepet-fab" onclick="sepetAc()" aria-label="${T.sepet}">
    ${SEPET_SVG} ${T.sepet} <span id="sepetSayi" class="fab-badge">0</span>
  </button>

  <dialog class="dlg" id="dlg-sepet">
    <div class="dlg-head"><h2>${SEPET_SVG} ${T.sepet}</h2>
      <button type="button" class="dlg-kapat" onclick="this.closest('dialog').close()" aria-label="${T.kapat}">✕</button></div>
    <div class="dlg-govde">
      <div id="sepetListe"><p class="sepet-bos" style="color:var(--text)">${T.sepet_bos}</p></div>
      <form id="siparisForm" method="post" action="/bayi/siparis/" class="mt-2">
        <input type="hidden" name="sepet" id="sepetJson">
        <p class="form-field mt-2"><label for="not">${T.not_lbl}</label>
        <textarea id="not" name="not" rows="2" maxlength="1000" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px"></textarea></p>
      </form>
    </div>
    <div class="dlg-alt">
      <button type="button" class="btn btn-outline btn-sm" onclick="this.closest('dialog').close()">${T.kapat}</button>
      <button type="submit" form="siparisForm" class="btn btn-accent">${T.sepet_onayla} →</button>
    </div>
  </dialog>`;

  const adlar = {};
  for (const [slug, name] of allDealerProducts()) adlar[slug] = name;
  const script = `<script>
    var URUNLER = ${JSON.stringify(adlar)};
    var sepet = {};

    function sepeteEkle(slug, btn) {
      var n = parseInt(document.getElementById('adet-' + slug).value || '1', 10);
      if (!(n > 0)) return;
      sepet[slug] = Math.min((sepet[slug] || 0) + n, 99999);
      // görsel sepete uçsun
      var img = btn.closest('.urun-kart').querySelector('img');
      var fab = document.getElementById('sepetFab');
      var r1 = img.getBoundingClientRect(), r2 = fab.getBoundingClientRect();
      var kopya = img.cloneNode();
      kopya.className = 'ucan-img';
      kopya.style.cssText += 'left:' + r1.left + 'px;top:' + r1.top + 'px;width:' + r1.width + 'px;height:' + r1.height + 'px;';
      document.body.appendChild(kopya);
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        kopya.style.left = (r2.left + r2.width / 2 - 22) + 'px';
        kopya.style.top = (r2.top + r2.height / 2 - 16) + 'px';
        kopya.style.width = '44px'; kopya.style.height = '32px';
        kopya.style.opacity = '.25'; kopya.style.borderRadius = '50%';
      }); });
      setTimeout(function () { kopya.remove(); }, 750);
      badge(true);
    }

    function badge(zipla) {
      var toplam = 0; for (var k in sepet) toplam += sepet[k];
      document.getElementById('sepetSayi').textContent = toplam;
      var fab = document.getElementById('sepetFab');
      if (zipla) { fab.classList.remove('zipla'); void fab.offsetWidth; fab.classList.add('zipla'); }
    }

    function adetDegistir(slug, delta) {
      sepet[slug] = (sepet[slug] || 0) + delta;
      if (sepet[slug] <= 0) delete sepet[slug];
      cizSepet(); badge(false);
    }
    function kaldir(slug) { delete sepet[slug]; cizSepet(); badge(false); }

    function cizSepet() {
      var kutu = document.getElementById('sepetListe');
      var k = Object.keys(sepet);
      if (!k.length) {
        kutu.innerHTML = '<p class="sepet-bos" style="color:var(--text)">${T.sepet_bos}</p>';
        document.getElementById('sepetJson').value = '';
        return;
      }
      kutu.innerHTML = k.map(function (s) {
        return '<div class="sepet-satir">' +
          '<img src="/assets/img/products/' + s + '.webp" alt="">' +
          '<strong>' + URUNLER[s] + '</strong>' +
          '<span class="adet-step">' +
            '<button type="button" onclick="adetDegistir(\\'' + s + '\\', -1)">−</button>' +
            '<b>' + sepet[s] + '</b>' +
            '<button type="button" onclick="adetDegistir(\\'' + s + '\\', 1)">+</button>' +
          '</span>' +
          '<button type="button" class="sepet-kaldir" onclick="kaldir(\\'' + s + '\\')" title="${T.kaldir}">✕</button>' +
        '</div>';
      }).join('');
      document.getElementById('sepetJson').value = JSON.stringify(sepet);
    }

    function sepetAc() { cizSepet(); document.getElementById('dlg-sepet').showModal(); }

    document.getElementById('siparisForm').addEventListener('submit', function (e) {
      if (!Object.keys(sepet).length) { e.preventDefault(); alert('${T.en_az_bir}'); }
      else document.getElementById('sepetJson').value = JSON.stringify(sepet);
    });
  </script>`;
  return pageShell(T.portal, body, {
    nav: `<a href="/bayi/">${T.urunler}</a><a href="/bayi/siparisler/">${T.siparis_takip}</a><a href="/">${T.siteye_don}</a><a href="/bayi/cikis/">${T.cikis}</a>`,
    script,
  });
}

function bayiSiparislerPage(dealer, lang, msg) {
  const T = BL[lang];
  const D = lang === "en" ? DURUM_EN : DURUM_TR;
  const fiyatAcik = store.settings.fiyatGoster;
  const myOrders = store.orders.filter((o) => o.dealerId === dealer.id).slice().reverse();

  const teklifler = myOrders.filter((o) => o.durum === "fiyat_verildi" && !o.bayiOnay).map((o) => `
    <div class="msg msg-info" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span><strong>${esc(o.no)}</strong> ${T.teklif_msg} <strong style="font-size:1.15rem">${siparisParaFmt(o, o.fiyat)}</strong>
        ${indirimTutarOf(o) ? `<small>(${indirimEtiketi(o)} ${T.indirim_uygulandi})</small>` : ""}</span>
      <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        ${o.seffaf ? `<a class="btn btn-outline btn-sm" href="/bayi/teklif/?id=${o.id}">${T.teklif_dokum}</a>` : ""}
        <form method="post" action="/bayi/onayla/">
          <input type="hidden" name="id" value="${o.id}">
          <button class="btn btn-accent btn-sm">${T.onayla}</button>
        </form>
      </span>
    </div>`).join("");

  const tesekkurler = myOrders.filter((o) => o.durum === "teslim" && !o.tesekkur).map((o) => `
    <div class="kutu">
      <h2>${T.tesekkur_baslik} <small style="font-weight:400">(${esc(o.no)})</small></h2>
      <form method="post" action="/bayi/tesekkur/">
        <input type="hidden" name="id" value="${o.id}">
        <textarea name="mesaj" rows="2" required maxlength="600" placeholder="${T.tesekkur_ph}"
          style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:12px"></textarea>
        <p class="mt-2"><button class="btn btn-accent btn-sm">${T.tesekkur_gonder}</button></p>
      </form>
    </div>`).join("");

  const orderRows = myOrders.map((o) => {
    let durumHtml = `<span class="durum durum-${DURUM_RENK[o.durum]}">${D[o.durum]}</span>`;
    if (["hazirlaniyor", "kargoda", "teslim"].includes(o.durum)) {
      durumHtml = kargoStepper(o.durum, lang);
      if (o.kargoTakip) durumHtml += `<small>${lang === "en" ? "Tracking" : "Takip"}: <span class="kod">${esc(o.kargoTakip)}</span></small>`;
    }
    else if (o.durum === "fiyat_bekliyor") durumHtml += `<br><small>${T.fiyat_bekliyor_msg}</small>`;
    else if (o.durum === "fiyat_verildi") {
      durumHtml += `<div class="onay-cizelge">
        <span class="${o.bayiOnay ? "ok" : "bekliyor"}">${o.bayiOnay ? "✓ " + T.onay_sen : "• " + (lang==="en"?"Your approval pending":"Onayınız bekleniyor")}</span>
        <span class="${o.adminOnay ? "ok" : "bekliyor"}">${o.adminOnay ? "✓ Maxx Global" : "• " + T.onay_bekle_admin}</span>
      </div>`;
    }
    const fiyatHtml = o.fiyat
      ? `<strong>${siparisParaFmt(o, o.fiyat)}</strong>` + (o.seffaf ? `<br><a href="/bayi/teklif/?id=${o.id}"><small>${T.teklif_dokum}</small></a>` : "")
      : "—";
    return `<tr>
      <td><strong>${esc(o.no)}</strong><br><small>${new Date(o.tarih).toLocaleDateString(lang==="en"?"en-GB":"tr-TR")}</small></td>
      <td>${o.kalemler.map((k) => esc(k.ad) + " × " + k.adet).join("<br>")}${o.not ? `<br><small>${esc(o.not)}</small>` : ""}</td>
      <td>${fiyatHtml}</td>
      <td style="min-width:290px">${durumHtml}</td>
    </tr>`;
  }).join("");

  const body = `
  <span class="eyebrow">${T.portal}</span>
  <h1 class="portal-title" style="font-size:2rem">${T.siparis_takip}</h1>
  <p class="portal-sub">${T.takip_alt}</p>
  ${msg || ""}
  ${teklifler}
  ${tesekkurler}
  <div class="kutu">
    <h2>${T.siparislerim}</h2>
    ${myOrders.length ? `<table class="liste"><thead><tr><th>${T.no_col}</th><th>${T.urun_col}</th><th>${T.toplam}</th><th>${T.durum}</th></tr></thead><tbody>${orderRows}</tbody></table>` : `<p>${T.siparis_yok}</p>`}
  </div>

`;


  return pageShell(T.siparis_takip, body, {
    nav: `<a href="/bayi/">${T.urunler}</a><a href="/bayi/siparisler/">${T.siparis_takip}</a><a href="/">${T.siteye_don}</a><a href="/bayi/cikis/">${T.cikis}</a>`,
    });
}

/* Fiyat teklifi dökümü — bayi (seffaf ise) ve admin görebilir; yazdır → PDF */
function teklifPage(o, dealer, lang, geriUrl) {
  const T = BL[lang];
  const rows = o.kalemler.map((k) => `
    <tr>
      <td><span class="u-kart"><img src="/assets/img/products/${k.slug}.webp" alt="" loading="lazy"><strong>${esc(k.ad)}</strong></span></td>
      <td style="text-align:center">${k.adet}</td>
      <td style="text-align:right">${k.birim ? siparisParaFmt(o, k.birim) : "—"}</td>
      <td style="text-align:right"><strong>${k.birim ? siparisParaFmt(o, k.birim * k.adet) : "—"}</strong></td>
    </tr>`).join("");
  const body = `
  <p class="yazdirma-gizle"><a href="${geriUrl}">← ${T.kapat}</a></p>
  <span class="eyebrow">Maxx Global Medikal</span>
  <h1 class="portal-title" style="font-size:1.7rem">${T.teklif_baslik} — ${esc(o.no)}</h1>
  <p class="portal-sub">${esc(dealer.firma)} · ${new Date(o.fiyatTarihi || o.tarih).toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR")}</p>
  <div class="kutu">
    <table class="liste fiyat-tablo">
      <thead><tr><th>${T.urun_col}</th><th style="text-align:center">${lang === "en" ? "Qty" : "Adet"}</th><th style="text-align:right">${T.birim_lbl}</th><th style="text-align:right">${T.satir_lbl}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fiyat-ozet">
      <span>${T.ara_toplam}: <strong>${siparisParaFmt(o, o.araToplam || o.fiyat)}</strong></span>
      ${indirimTutarOf(o) ? `<span>${T.indirim_lbl} (${indirimEtiketi(o)}): <strong>−${siparisParaFmt(o, indirimTutarOf(o))}</strong></span>` : ""}
      <span class="genel">${T.genel_toplam}: ${siparisParaFmt(o, o.fiyat)}</span>
      <small>${lang === "en" ? "Prices exclude VAT." : "Fiyatlara KDV dahil değildir."}</small>
    </div>
    <p class="mt-4 yazdirma-gizle"><button class="btn btn-accent" onclick="window.print()">🖨 ${T.pdf_indir}</button></p>
  </div>`;
  return pageShell(T.teklif_baslik + " " + o.no, body, { nav: `<a href="${geriUrl}">← ${T.kapat}</a>` });
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
    ["/admin/urun-ekle/", "Yeni Ürün"],
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
        d.siparisler.forEach(function (o) { olaylar.push({ baslik: 'Yeni sipariş isteği: ' + o.no, metin: o.firma, url: '/admin/siparisler/' }); });
        (d.onaylar || []).forEach(function (o) { olaylar.push({ baslik: 'Bayi fiyatı onayladı: ' + o.no, metin: o.firma, url: '/admin/siparisler/onay/' }); });
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
  // Bayileri şehre göre grupla; yoğunluk arttıkça kırmızı koyulaşır
  const gruplar = {};
  for (const d of store.dealers) {
    if (!d.lat || !d.lng || d.durum === "reddedildi") continue;
    const k = (d.sehir || "?").trim().toLocaleLowerCase("tr");
    if (!gruplar[k]) gruplar[k] = { sehir: d.sehir, lat: 0, lng: 0, n: 0, firmalar: [] };
    const g = gruplar[k];
    g.lat += d.lat; g.lng += d.lng; g.n++;
    g.firmalar.push(d.firma + (d.durum === "beklemede" ? " (onay bekliyor)" : ""));
  }
  const data = Object.values(gruplar).map((g) => ({
    sehir: g.sehir, lat: g.lat / g.n, lng: g.lng / g.n, n: g.n, firmalar: g.firmalar,
  }));
  return `<script>
    var data = ${JSON.stringify(data)};
    var map = L.map('harita').setView([30, 20], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }).addTo(map);
    var tonlar = ['#ffb3b3', '#ff8080', '#ff4d4d', '#e60000', '#990000'];
    data.forEach(function (g) {
      var renk = tonlar[Math.min(g.n - 1, tonlar.length - 1)];
      L.circleMarker([g.lat, g.lng], {
        radius: Math.min(9 + g.n * 3, 26), color: renk, fillColor: renk, fillOpacity: .8, weight: 2,
      }).addTo(map).bindPopup('<b>' + g.sehir + '</b> — ' + g.n + ' bayi<br>' + g.firmalar.join('<br>'));
    });
    if (data.length === 1) map.setView([data[0].lat, data[0].lng], 5);
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
        <td>${o.fiyat ? "<strong>" + siparisParaFmt(o, o.fiyat) + "</strong>" : "—"}<br><span class="durum durum-${DURUM_RENK[o.durum] || "beklemede"}">${DURUM_TR[o.durum] || o.durum}</span></td></tr>`;
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
  ${dlg("teklif", "Teklif Talepleri", teklifIcerik, "/admin/talepler/", "Teklif Taleplerine Git")}
  <div class="kutu">
    <h2>Tarayıcı Bildirimleri</h2>
    <p style="margin-bottom:12px">Bu panel herhangi bir sekmede açıkken yeni bayilik başvurusu ve siparişlerde tarayıcı bildirimi alırsınız (sekme arka planda olsa bile).</p>
    <button id="bildirimAc" class="btn btn-accent btn-sm" type="button">Bildirimleri Aç</button>
  </div>
  <div class="kutu">
    <h2>Bayi Haritası <small style="font-weight:400">(şehir bazlı — bayi sayısı arttıkça kırmızı koyulaşır)</small></h2>
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
      <td>${d.durum === "onayli" && !d.salt ? `<span class="kod">www.maxx-global.net/bayi/aktivasyon/?token=${esc(d.token)}</span>` : ""}</td>
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
    <h2>Bayi Haritası <small style="font-weight:400">(şehir bazlı — bayi sayısı arttıkça kırmızı koyulaşır)</small></h2>
    <div id="harita"></div>
  </div>
  <div class="kutu">
    <h2>Tüm Bayiler</h2>
    ${dealers.length ? `<table class="liste"><thead><tr><th>Firma</th><th>İletişim</th><th>Adres</th><th>Durum</th><th>Aktivasyon Bağlantısı</th></tr></thead><tbody>${dealerRows}</tbody></table>` : "<p>Kayıtlı bayi yok.</p>"}
  </div>`;
  return adminLayout("/admin/onaylar/", "Bayilik Onayları", body, { leaflet: true, script: haritaScript() });
}

function adminFiyatlarPage(msg) {
  const acik = store.settings.fiyatGoster;
  const rows = PRODUCTS.map(([slug, name]) => {
    const meta = store.prodMeta[slug] || {};
    const kod = paraBirimi(meta.paraBirimi);
    const secenekler = Object.keys(PARA_BIRIMLERI).map((k) =>
      `<option value="${k}" ${k === kod ? "selected" : ""}>${k}</option>`).join("");
    return `
    <tr class="aranabilir">
      <td><span class="u-kart"><img src="/assets/img/products/${slug}.webp" alt="" loading="lazy"><strong>${esc(name)}</strong></span></td>
      <td style="width:260px">
        <span style="display:flex;gap:6px">
          <input class="adet" style="width:150px" type="number" step="0.01" min="0" name="fiyat_${slug}" value="${meta.fiyat || ""}" placeholder="bayi fiyatı">
          <select class="adet" style="width:90px" name="para_${slug}">${secenekler}</select>
        </span>
      </td>
    </tr>`;
  }).join("");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Fiyat Güncelleme</h1>
  <p class="portal-sub">Buradaki liste fiyatları yalnızca aşağıdaki anahtar AÇIK olduğunda bayilere gösterilir. Sipariş fiyatlandırması her durumda Siparişler sayfasından, siparişe özel yapılır.</p>
  ${msg || ""}
  <div class="kutu" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
    <div>
      <h2 style="margin-bottom:4px">Bayilere Fiyat Gösterimi: <span class="durum durum-${acik ? "onayli" : "reddedildi"}">${acik ? "AÇIK" : "KAPALI"}</span></h2>
      <small>${acik ? "Bayiler ürün kartlarında liste fiyatlarını görüyor." : "Bayiler hiçbir fiyat görmüyor; yalnızca sipariş isteği oluşturabiliyor."}</small>
    </div>
    <form method="post" action="/admin/fiyat-goster/" style="margin-left:auto">
      <button class="btn ${acik ? "btn-outline" : "btn-accent"}">${acik ? "Kapat" : "Aç"}</button>
    </form>
  </div>
  <form class="kutu" method="post" action="/admin/fiyatlar/">
    <table class="liste">
      <thead><tr><th>Ürün</th><th>Liste Fiyatı (KDV hariç)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="mt-4"><button class="btn btn-accent">Fiyatları Kaydet</button></p>
  </form>`;
  return adminLayout("/admin/fiyatlar/", "Fiyat Güncelleme", body);
}

function adminAciklamalarPage() {
  const nokta = (k) => (store.content[k] !== undefined ? " •" : "");
  const prodRows = PRODUCTS.map(([slug, name]) => `
    <tr class="aranabilir">
      <td><span class="u-kart"><img src="/assets/img/products/${slug}.webp" alt="" loading="lazy"><strong>${esc(name)}</strong></span></td>
      <td style="white-space:nowrap">
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=urun:${slug}:tr">TR${nokta(`urun:${slug}:tr`)}</a>
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=urun:${slug}:en">EN${nokta(`urun:${slug}:en`)}</a>
      </td>
      <td style="white-space:nowrap">
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=spec:${slug}:tr">TR${nokta(`spec:${slug}:tr`)}</a>
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=spec:${slug}:en">EN${nokta(`spec:${slug}:en`)}</a>
      </td>
      <td style="white-space:nowrap">
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=sss:${slug}:tr">TR${nokta(`sss:${slug}:tr`)}</a>
        <a class="btn btn-outline btn-sm" href="/admin/icerik/?key=sss:${slug}:en">EN${nokta(`sss:${slug}:en`)}</a>
      </td>
    </tr>`).join("");
  const link = (k, l) => `<a class="btn btn-outline btn-sm aranabilir" style="margin:3px 2px" href="/admin/icerik/?key=${encodeURIComponent(k)}">${esc(l)}${nokta(k)}</a>`;
  const anaLinkler = [
    ["ana:badge:tr", "Ana Sayfa — Rozet (TR)"], ["ana:baslik:tr", "Ana Sayfa — Büyük Başlık (TR)"], ["ana:aciklama:tr", "Ana Sayfa — Açıklama (TR)"],
    ["ana:badge:en", "Ana Sayfa — Rozet (EN)"], ["ana:baslik:en", "Ana Sayfa — Büyük Başlık (EN)"], ["ana:aciklama:en", "Ana Sayfa — Açıklama (EN)"],
  ].map(([k, l]) => link(k, l)).join(" ");
  const kurumsalLinkler = [
    ["hakkimizda:tr", "Hakkımızda (TR)"], ["hakkimizda:en", "About Us (EN)"],
    ["vm:vizyon:tr", "Vizyonumuz (TR)"], ["vm:misyon:tr", "Misyonumuz (TR)"],
    ["vm:vizyon:en", "Our Vision (EN)"], ["vm:misyon:en", "Our Mission (EN)"],
    ["deger:1:tr", "Değer: Kalite Odaklılık (TR)"], ["deger:2:tr", "Değer: Güvenilirlik (TR)"],
    ["deger:3:tr", "Değer: Yenilikçilik (TR)"], ["deger:4:tr", "Değer: Müşteri Memnuniyeti (TR)"],
    ["deger:5:tr", "Değer: Sürdürülebilirlik (TR)"], ["deger:6:tr", "Değer: Etik ve Şeffaflık (TR)"],
    ["deger:1:en", "Value: Quality Focus (EN)"], ["deger:2:en", "Value: Reliability (EN)"],
    ["deger:3:en", "Value: Innovation (EN)"], ["deger:4:en", "Value: Customer Satisfaction (EN)"],
    ["deger:5:en", "Value: Sustainability (EN)"], ["deger:6:en", "Value: Ethics (EN)"],
  ].map(([k, l]) => link(k, l)).join(" ");
  const proseLinkler = PROSE_TR.concat(PROSE_EN).map(([p, lbl]) => link("sayfa:" + p, lbl)).join(" ");
  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">Açıklama &amp; Metin Güncelleme</h1>
  <p class="portal-sub">Aramak istediğiniz sayfa veya ürünü yazın, tıklayın, düzenleyin — site anında güncellenir. Yanında <strong>•</strong> olanlar daha önce düzenlenmiştir.</p>
  <input class="ara-kutu" id="ara" type="search" placeholder="Ara: hakkımızda, anchor, vizyon, çevre…" autocomplete="off">
  <div class="kutu">
    <h2>Ana Sayfa</h2>
    <p>${anaLinkler}</p>
  </div>
  <div class="kutu">
    <h2>Kurumsal Sayfalar <small style="font-weight:400">(Hakkımızda · Vizyon &amp; Misyon · Değerlerimiz)</small></h2>
    <p>${kurumsalLinkler}</p>
  </div>
  <div class="kutu">
    <h2>Politika &amp; Diğer Sayfalar</h2>
    <p>${proseLinkler}</p>
  </div>
  <div class="kutu">
    <h2>Ürün Açıklamaları</h2>
    <table class="liste">
      <thead><tr><th>Ürün</th><th>Açıklama</th><th>Teknik Tablo</th><th>SSS</th></tr></thead>
      <tbody>${prodRows}</tbody>
    </table>
  </div>`;
  const script = `<script>
    document.getElementById('ara').addEventListener('input', function () {
      var q = this.value.toLocaleLowerCase('tr');
      document.querySelectorAll('.aranabilir').forEach(function (el) {
        el.style.display = el.textContent.toLocaleLowerCase('tr').indexOf(q) === -1 ? 'none' : '';
      });
    });
  </script>`;
  return adminLayout("/admin/aciklamalar/", "Açıklama Güncelleme", body, { script });
}

/* ---- Sipariş bölümü: her aşama ayrı sayfa, üstte sayaçlı sekmeler ---- */

const bayiAdi = (o) => { const d = store.dealers.find((x) => x.id === o.dealerId); return d ? d.firma : "?"; };
const kalemListe = (o) => o.kalemler.map((k) => esc(k.ad) + " × " + k.adet).join("<br>") +
  (o.not ? `<br><small>Not: ${esc(o.not)}</small>` : "");
const trTarih = (ts) => new Date(ts).toLocaleString("tr-TR");

function siparisAltNav(aktif) {
  const n = {
    bekleyen: store.orders.filter((o) => o.durum === "fiyat_bekliyor").length,
    onay: store.orders.filter((o) => o.durum === "fiyat_verildi").length,
    kargo: store.orders.filter((o) => ["hazirlaniyor", "kargoda"].includes(o.durum)).length,
    teslim: store.orders.filter((o) => o.durum === "teslim").length,
    tesekkur: store.thanks.length,
    talep: (store.quotes || []).length,
  };
  const item = (url, ad, sayi) =>
    `<a class="alt-sekme${aktif === url ? " aktif" : ""}" href="${url}">${ad} <span class="alt-sayi">${sayi}</span></a>`;
  return '<div class="alt-sekmeler">' +
    item("/admin/siparisler/", "1 · Fiyat Bekleyen", n.bekleyen) +
    item("/admin/siparisler/onay/", "2 · Onay Aşaması", n.onay) +
    item("/admin/siparisler/kargo/", "3 · Kargo Takibi", n.kargo) +
    item("/admin/siparisler/teslim/", "4 · Teslim Edilenler", n.teslim) +
    item("/admin/tesekkurler/", "💬 Teşekkürler", n.tesekkur) +
    item("/admin/talepler/", "Teklif Talepleri", n.talep) +
    "</div>";
}

function siparisSayfa(aktif, baslik, altBaslik, icerik, script) {
  const body = `
  <span class="eyebrow">Yönetim Paneli · Siparişler</span>
  <h1 class="portal-title" style="font-size:2rem">${baslik}</h1>
  <p class="portal-sub">${altBaslik}</p>
  ${siparisAltNav(aktif)}
  ${icerik}`;
  return adminLayout("/admin/siparisler/", baslik, body, script ? { script } : {});
}

function adminFiyatBekleyenPage(msg) {
  const bekleyenler = store.orders.filter((o) => o.durum === "fiyat_bekliyor");
  const kutular = bekleyenler.map((o) => {
    const satirlar = o.kalemler.map((k) => `
      <tr>
        <td><span class="u-kart"><img src="/assets/img/products/${k.slug}.webp" alt="" loading="lazy"><strong>${esc(k.ad)}</strong></span></td>
        <td style="text-align:center">${k.adet}</td>
        <td><input class="birim para" type="text" inputmode="decimal" name="birim_${k.slug}" data-adet="${k.adet}" placeholder="₺ birim" required autocomplete="off"></td>
        <td style="text-align:right" class="satir-toplam">—</td>
      </tr>`).join("");
    return `
    <div class="kutu" style="border-left:4px solid var(--accent)">
      <h2>${esc(o.no)} — ${esc(bayiAdi(o))} <small style="font-weight:400">(${trTarih(o.tarih)})</small></h2>
      ${o.not ? `<p style="margin-bottom:10px"><small>Not: ${esc(o.not)}</small></p>` : ""}
      <form method="post" action="/admin/siparis/fiyat/" class="fiyatlandirma">
        <input type="hidden" name="id" value="${o.id}">
        <div class="doviz-sec" aria-label="Para birimi seçimi">
          <label><input type="radio" name="para_birimi" value="TRY" checked><span>₺ TL</span></label>
          <label><input type="radio" name="para_birimi" value="USD"><span>$ Dolar</span></label>
          <label><input type="radio" name="para_birimi" value="EUR"><span>€ Euro</span></label>
        </div>
        <table class="liste fiyat-tablo">
          <thead><tr><th>Ürün</th><th style="text-align:center">Adet</th><th>Birim Fiyat (<span class="doviz-simge">₺</span>)</th><th style="text-align:right">Tutar</th></tr></thead>
          <tbody>${satirlar}</tbody>
        </table>
        <div class="fiyat-ozet">
          <span>Ara Toplam: <strong class="ara-toplam">₺0,00</strong></span>
          <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end">
            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="indirim-ac" style="width:18px;height:18px"> İndirim yap
            </label>
            <span class="indirim-alan" style="display:none;align-items:center;gap:6px">
              <select name="indirim_tip" class="adet indirim-tip" style="width:64px;padding:8px 4px">
                <option value="yuzde">%</option>
                <option value="tutar" class="tutar-sec">₺</option>
              </select>
              <input class="birim para indirim-deger" type="text" inputmode="decimal" name="indirim" value="" style="width:110px" placeholder="10" autocomplete="off">
              <span class="indirim-tutar"></span>
            </span>
          </span>
          <span class="genel">Genel Toplam: <span class="genel-toplam">₺0,00</span></span>
        </div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="radio" name="seffaf" value="1" checked> Detaylı döküm bayiye gösterilsin <small>(birim fiyatlar + indirim, PDF alınabilir)</small>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="radio" name="seffaf" value="0"> Sadece toplam fiyat iletilsin
          </label>
          <button class="btn btn-accent btn-sm" style="margin-left:auto">Fiyatı Gönder →</button>
        </div>
      </form>
    </div>`;
  }).join("");

  const script = `<script>
    var PARA = {
      TRY: { simge: '₺', ad: 'TL' },
      USD: { simge: '$', ad: 'Dolar' },
      EUR: { simge: '€', ad: 'Euro' }
    };
    function paraBirimi(form) {
      var secili = form.querySelector('input[name="para_birimi"]:checked');
      return secili ? secili.value : 'TRY';
    }
    function formatter(kod) {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: kod });
    }
    function sayi(v) { return parseFloat(String(v).replace(/\\./g, '').replace(',', '.')) || 0; }
    function bicimle(el) {
      var v = el.value.replace(/[^\\d,]/g, '');
      var parca = v.split(',');
      var tam = parca[0].replace(/^0+(?=\\d)/, '').replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
      el.value = tam + (parca.length > 1 ? ',' + parca.slice(1).join('').slice(0, 2) : '');
    }
    document.querySelectorAll('.fiyatlandirma').forEach(function (form) {
      function hesapla() {
        var kod = paraBirimi(form);
        var fmt = formatter(kod);
        var simge = PARA[kod].simge;
        form.querySelectorAll('.doviz-simge').forEach(function (el) { el.textContent = simge; });
        form.querySelectorAll('input.birim[name^="birim_"]').forEach(function (inp) { inp.placeholder = simge + ' birim'; });
        var tutarSec = form.querySelector('.tutar-sec');
        if (tutarSec) tutarSec.textContent = simge;
        var ara = 0;
        form.querySelectorAll('input.birim[name^="birim_"]').forEach(function (inp) {
          var adet = parseInt(inp.getAttribute('data-adet'), 10);
          var birim = sayi(inp.value);
          inp.closest('tr').querySelector('.satir-toplam').textContent = birim ? fmt.format(birim * adet) : '—';
          ara += birim * adet;
        });
        var acik = form.querySelector('.indirim-ac').checked;
        form.querySelector('.indirim-alan').style.display = acik ? 'inline-flex' : 'none';
        var tip = form.querySelector('.indirim-tip').value;
        var deger = acik ? sayi(form.querySelector('.indirim-deger').value) : 0;
        var indirimTutar = tip === 'tutar' ? Math.min(deger, ara) : ara * Math.min(deger, 99) / 100;
        form.querySelector('.indirim-tutar').textContent = indirimTutar ? '(−' + fmt.format(indirimTutar) + ')' : '';
        form.querySelector('.ara-toplam').textContent = fmt.format(ara);
        form.querySelector('.genel-toplam').textContent = fmt.format(ara - indirimTutar);
      }
      form.querySelectorAll('input.para').forEach(function (inp) {
        inp.addEventListener('input', function () { bicimle(inp); hesapla(); });
      });
      form.addEventListener('input', hesapla);
      form.addEventListener('change', hesapla);
      hesapla();
    });
  </script>`;
  return siparisSayfa("/admin/siparisler/", "Fiyat Bekleyen İstekler",
    "Her ürüne birim fiyat girin; toplam ve indirim canlı hesaplanır. Fiyat gönderilince sipariş Onay Aşamasına geçer.",
    (msg || "") + (bekleyenler.length ? kutular : '<div class="kutu"><p>Bekleyen istek yok.</p></div>'), script);
}

function adminOnayPage() {
  const onaydakiler = store.orders.filter((o) => o.durum === "fiyat_verildi");
  const rows = onaydakiler.map((o) => `
    <tr>
      <td><strong>${esc(o.no)}</strong><br><small>${trTarih(o.tarih)}</small><br><a href="/admin/teklif/?id=${o.id}"><small>Dökümü Gör</small></a></td>
      <td>${esc(bayiAdi(o))}</td>
      <td>${kalemListe(o)}</td>
      <td><strong>${siparisParaFmt(o, o.fiyat)}</strong>${indirimTutarOf(o) ? `<br><small>${indirimEtiketi(o)} indirimli (${siparisParaFmt(o, o.araToplam)} üzerinden)</small>` : ""}<br><small>${o.seffaf ? "Şeffaf döküm" : "Yalnız toplam"}</small></td>
      <td>
        <div class="onay-cizelge" style="flex-direction:column;gap:6px">
          <span class="${o.bayiOnay ? "ok" : "bekliyor"}">${o.bayiOnay ? "✓ Bayi onayladı" : "• Bayi onayı bekleniyor"}</span>
          <span class="${o.adminOnay ? "ok" : "bekliyor"}">${o.adminOnay ? "✓ Siz onayladınız" : "• Sizin onayınız bekleniyor"}</span>
        </div>
        ${o.adminOnay ? "" : `<form method="post" action="/admin/siparis/onayla/" class="mt-2"><input type="hidden" name="id" value="${o.id}"><button class="btn btn-accent btn-sm">Onayla</button></form>`}
      </td>
    </tr>`).join("");
  return siparisSayfa("/admin/siparisler/onay/", "Onay Aşamasındaki Siparişler",
    "Fiyat verildi; iki taraf da onaylayınca sipariş Kargo Takibine geçer. Gerekirse bayiyi arayın.",
    onaydakiler.length
      ? `<div class="kutu"><table class="liste"><thead><tr><th>No</th><th>Bayi</th><th>Ürünler</th><th>Fiyat</th><th>Onaylar</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kutu"><p>Onay bekleyen sipariş yok.</p></div>');
}

function adminKargoPage() {
  const aktifler = store.orders.filter((o) => ["hazirlaniyor", "kargoda"].includes(o.durum));
  const secenek = (o) => ["hazirlaniyor", "kargoda", "teslim"].map((k) =>
    `<option value="${k}" ${o.durum === k ? "selected" : ""}>${DURUM_TR[k]}</option>`).join("");
  const rows = aktifler.map((o) => `
    <tr>
      <td><strong>${esc(o.no)}</strong><br><small>${esc(bayiAdi(o))} · ${siparisParaFmt(o, o.fiyat)}</small></td>
      <td>${kalemListe(o)}</td>
      <td style="min-width:300px">${kargoStepper(o.durum, "tr")}</td>
      <td>
        <form method="post" action="/admin/siparis/kargo/" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="hidden" name="id" value="${o.id}">
          <select name="kdurum" class="adet" style="width:160px">${secenek(o)}</select>
          <input class="adet" style="width:150px" name="takip" value="${esc(o.kargoTakip || "")}" placeholder="Takip no (ops.)" maxlength="60">
          <button class="btn btn-accent btn-sm">Güncelle</button>
        </form>
      </td>
    </tr>`).join("");
  return siparisSayfa("/admin/siparisler/kargo/", "Kargo Takibi",
    "Durumu güncelleyin; bayi ekranındaki ilerleme çubuğu anında değişir. Teslim Edildi seçilince sipariş arşive geçer.",
    aktifler.length
      ? `<div class="kutu"><table class="liste"><thead><tr><th>Sipariş</th><th>Ürünler</th><th>Durum</th><th>Güncelle</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kutu"><p>Aktif kargo süreci yok.</p></div>');
}

function adminTeslimPage() {
  const teslimler = store.orders.filter((o) => o.durum === "teslim").slice().reverse();
  const rows = teslimler.map((o) => `
    <tr>
      <td><strong>${esc(o.no)}</strong><br><small>${trTarih(o.tarih)}</small>${o.fiyat && o.seffaf ? `<br><a href="/admin/teklif/?id=${o.id}"><small>Dökümü Gör</small></a>` : ""}</td>
      <td>${esc(bayiAdi(o))}</td>
      <td>${kalemListe(o)}</td>
      <td>${o.fiyat ? siparisParaFmt(o, o.fiyat) : "—"}</td>
      <td>${o.kargoTakip ? `<span class="kod">${esc(o.kargoTakip)}</span>` : ""} ${o.tesekkur ? "💬" : ""}</td>
    </tr>`).join("");
  return siparisSayfa("/admin/siparisler/teslim/", "Teslim Edilen Siparişler",
    "Tamamlanan siparişlerin arşivi. 💬 işareti bayinin teşekkür mesajı bıraktığını gösterir.",
    teslimler.length
      ? `<div class="kutu"><table class="liste"><thead><tr><th>No</th><th>Bayi</th><th>Ürünler</th><th>Tutar</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kutu"><p>Henüz teslim edilen sipariş yok.</p></div>');
}

function adminTesekkurlerPage() {
  const liste = store.thanks.slice().reverse().map((t) => `
    <div class="msg msg-ok" style="margin-bottom:10px">
      <strong>${esc(t.firma)}</strong> <small>(${esc(t.sehir || "")} · ${esc(t.no)} · ${trTarih(t.tarih)})</small><br>
      "${esc(t.mesaj)}"
    </div>`).join("");
  return siparisSayfa("/admin/tesekkurler/", "Bayi Teşekkür Mesajları",
    "Teslimat sonrası bayilerden gelen mesajlar. Beğendiklerinizi web sitesine referans olarak koyabiliriz.",
    store.thanks.length ? `<div class="kutu">${liste}</div>` : '<div class="kutu"><p>Henüz teşekkür mesajı yok.</p></div>');
}

function adminTaleplerPage() {
  const rows = (store.quotes || []).slice().reverse().map((q) => `
    <tr><td>${trTarih(q.tarih)}</td><td>${esc(q.ad)}<br><small>${esc(q.firma || "")}</small></td>
    <td>${esc(q.eposta)}<br><small>${esc(q.telefon)}</small></td><td>${esc(q.urun)}</td><td>${esc(q.mesaj || "")}</td></tr>`).join("");
  return siparisSayfa("/admin/talepler/", "Web Sitesi Teklif Talepleri",
    "Sitedeki Teklif Al formundan gelen istekler (bayi olmayan ziyaretçiler).",
    (store.quotes || []).length
      ? `<div class="kutu"><table class="liste"><thead><tr><th>Tarih</th><th>Ad / Firma</th><th>İletişim</th><th>Ürün</th><th>Mesaj</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="kutu"><p>Henüz talep yok.</p></div>');
}

function icerikDuzenlePage(key, msg) {
  const region = regionOf(key);
  if (!region) return null;
  const current = store.content[key] !== undefined ? store.content[key] : region.original;
  const text = key.startsWith("spec:") ? specToText(current)
             : key.startsWith("sss:") ? sssToText(current)
             : htmlToText(current);
  const degisik = store.content[key] !== undefined;
  const ipucu = key.startsWith("spec:")
    ? 'Her satır bir tablo satırıdır: <span class="kod">Başlık | Değer</span> (dik çizgiyle ayırın). Satır silmek için satırı kaldırın, eklemek için yeni satır yazın.'
    : key.startsWith("sss:")
    ? 'İlk satır <strong>soru</strong>, altındaki satır(lar) <strong>cevaptır</strong>. Soru-cevap çiftlerini boş satırla ayırın. Kaydedince Google\'a giden SSS verisi de otomatik güncellenir.'
    : 'Paragrafları boş satırla ayırın; madde işareti için satıra <span class="kod">- </span> ile başlayın.';
  const body = `
  <p><a href="/admin/aciklamalar/">← Açıklama &amp; Metinler</a></p>
  <span class="eyebrow">İçerik Düzenle</span>
  <h1 class="portal-title" style="font-size:1.6rem">${esc(region.meta.label)}</h1>
  <p class="portal-sub">${ipucu}
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

/* ---------------- admin'in eklediği ürünler ---------------- */

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const TPL_DIR = path.join(ROOT, "server", "tpl");
const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
// Yeni ürün sayfası için dil bilgileri (build.py'deki L sözlüğünün ihtiyaç duyulan kısmı)
const CPL = {
  tr: { site: "Maxx Global Medikal", quote_path: "/teklif-al/", cta: "Teklif Al", detail_cta: "" },
  en: { site: "Maxx Global Medical", quote_path: "/en/get-quote/", cta: "Get a Quote",
        detail_cta: "Contact us for detailed information and a price quote for" },
};
const _tplCache = {};
function productTpl(lang) {
  if (!_tplCache[lang]) _tplCache[lang] = fs.readFileSync(path.join(TPL_DIR, "product-" + lang + ".html"), "utf8");
  return _tplCache[lang];
}

const TR_MAP = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "İ": "i" };
function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/[çğıöşüİ]/g, (c) => TR_MAP[c] || c)
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
const staticSlugs = new Set(PRODUCTS.map(([s]) => s));
function uniqueSlug(base) {
  let s = base || "urun", n = 2;
  const taken = (x) => staticSlugs.has(x) || staticSlugs.has(x.replace(/-en$/, "")) ||
    store.customProducts.some((c) => c.slug === x) || x === "urunler" || x === "bayi" || x === "admin" || x === "assets" || x === "en";
  while (taken(s)) { s = base + "-" + n++; }
  return s;
}
const customBySlug = (slug) => store.customProducts.find((c) => c.slug === slug);
function prodImg(slug) {
  return customBySlug(slug) ? "/urun-gorsel/" + slug + ".webp" : "/assets/img/products/" + slug + ".webp";
}
// Bayi portalı + admin fiyatlandırma için: statik + özel ürünler birlikte
function allDealerProducts() {
  return PRODUCTS.concat(store.customProducts.map((c) => [c.slug, c.name_tr || c.name_en]));
}

// "Başlık | Değer" satırlarını spec tablosu HTML'ine
function specHtml(text, lang) {
  const rows = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    return `          <tr><th>${esc((i === -1 ? l : l.slice(0, i)).trim())}</th><td>${esc(i === -1 ? "" : l.slice(i + 1).trim())}</td></tr>`;
  });
  if (!rows.length) return "";
  const baslik = lang === "tr" ? "Teknik Özellikler" : "Technical Specifications";
  return `        <h3 class="mt-4">${baslik}</h3>\n        <table class="spec-tablo"><tbody>\n${rows.join("\n")}\n        </tbody></table>`;
}
// SSS metnini (soru\ncevap, boş satırla ayrılmış) parse
function faqParse(text) {
  return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    return { q: lines[0] || "", a: lines.slice(1).join(" ") };
  }).filter((x) => x.q && x.a);
}
function customProductCard(cp, lang) {
  const name = lang === "en" ? (cp.name_en || cp.name_tr) : (cp.name_tr || cp.name_en);
  const tag = lang === "en" ? (cp.tag_en || "Arthroscopy Products") : (cp.tag_tr || "Artroskopi Ürünleri");
  const href = "/" + cp.slug + (lang === "en" ? "-en" : "") + "/";
  const incele = lang === "en" ? "Explore" : "İncele";
  return `        <article class="product-card">
          <a class="media" href="${href}" tabindex="-1" aria-hidden="true">
            <img src="/urun-gorsel/${cp.slug}.webp" alt="${esc(name)}" loading="lazy">
          </a>
          <div class="body">
            <span class="tag">${esc(tag)}</span>
            <h3><a href="${href}">${esc(name)}</a></h3>
            <a class="more" href="${href}">${incele} →</a>
          </div>
        </article>`;
}

// Yeni ürün için tam sayfa HTML üret (build.py şablonunu doldurarak)
function renderCustomProduct(cp, lang) {
  const en = lang === "en";
  const name = en ? (cp.name_en || cp.name_tr) : (cp.name_tr || cp.name_en);
  const tag = en ? (cp.tag_en || "Arthroscopy Products") : (cp.tag_tr || "Artroskopi Ürünleri");
  const desc = en ? (cp.desc_en || cp.desc_tr) : (cp.desc_tr || cp.desc_en);
  const specText = en ? cp.spec_en : cp.spec_tr;
  const faqText = en ? cp.faq_en : cp.faq_tr;
  const urlTr = BASE + "/" + cp.slug + "/";
  const urlEn = BASE + "/" + cp.slug + "-en/";
  const canonical = en ? urlEn : urlTr;
  const imgUrl = BASE + "/urun-gorsel/" + cp.slug + ".webp";
  const listPath = en ? "/en/products/" : "/urunler/";
  const listName = en ? "Products" : "Ürünler";
  const T = CPL[lang];
  const metaDesc = (name + ": " + String(desc || "").replace(/\s+/g, " ")).slice(0, 155);

  const paras = String(desc || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => "        <p>" + esc(p) + "</p>").join("\n");
  const specBlock = specHtml(specText, lang);
  const faqs = faqParse(faqText);
  const faqH2 = en ? "Frequently Asked Questions" : "Sık Sorulan Sorular";
  const faqHtml = faqs.map((x) => `        <details>
          <summary>${esc(x.q)}</summary>
          <p>${esc(x.a)}</p>
        </details>`).join("\n");
  const ctaText = en
    ? `${T.detail_cta || "Contact us for a quote for"} <strong>${esc(name)}</strong>.`
    : `<strong>${esc(name)}</strong> hakkında detaylı bilgi ve fiyat teklifi almak için bize ulaşın.`;
  // İlgili: ilk 3 statik ürün
  const rel = PRODUCTS.slice(0, 3).map(([s, n]) => {
    const rhref = "/" + s + (en ? "-en" : "") + "/";
    return `        <article class="product-card">
          <a class="media" href="${rhref}" tabindex="-1" aria-hidden="true">
            <img src="/assets/img/products/${s}.webp" alt="${esc(n)}" loading="lazy">
          </a>
          <div class="body"><span class="tag">${esc(tag)}</span>
            <h3><a href="${rhref}">${esc(n)}</a></h3>
            <a class="more" href="${rhref}">${en ? "Explore" : "İncele"} →</a></div>
        </article>`;
  }).join("\n");

  const main = `  <section class="page-hero">
    <div class="container">
      <h1>${esc(name)}</h1>
      <nav aria-label="${en ? "Breadcrumb" : "Sayfa konumu"}"><ol class="breadcrumb">
      <li><a href="${en ? "/en/" : "/"}">${en ? "Home" : "Ana Sayfa"}</a></li>
      <li><a href="${listPath}">${listName}</a></li>
      <li class="current" aria-current="page">${esc(name)}</li>
      </ol></nav>
    </div>
  </section>
  <section class="section">
    <div class="container product-detail">
      <div class="media image-anime">
        <img src="/urun-gorsel/${cp.slug}.webp" alt="${esc(name)}" fetchpriority="high">
      </div>
      <div class="content">
        <span class="eyebrow">${esc(tag)}</span>
        <h2>${esc(name)}</h2>
${paras}
${specBlock}
        <div class="product-cta">
          <p>${ctaText}</p>
          <a class="btn btn-accent" href="${T.quote_path}">${T.cta} ${ARROW}</a>
        </div>
      </div>
    </div>
  </section>` +
  (faqHtml ? `
  <section class="section">
    <div class="container" style="max-width:860px">
      <h2 style="margin-bottom:20px">${faqH2}</h2>
      <div class="sss-bolum">
${faqHtml}
      </div>
    </div>
  </section>` : "") + `
  <section class="section section-soft">
    <div class="container">
      <div class="section-head">
        <span class="eyebrow">${en ? "Other Products" : "Diğer Ürünler"}</span>
        <h2>${en ? "Products You May Be Interested In" : "İlginizi Çekebilecek Ürünler"}</h2>
      </div>
      <div class="grid grid-3">
${rel}
      </div>
    </div>
  </section>`;

  // JSON-LD
  const ld = [];
  ld.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": en ? "Home" : "Ana Sayfa", "item": en ? BASE + "/en/" : BASE + "/" },
    { "@type": "ListItem", "position": 2, "name": listName, "item": BASE + listPath },
    { "@type": "ListItem", "position": 3, "name": name, "item": canonical },
  ]});
  const prod = { "@context": "https://schema.org", "@type": "Product", "name": name, "sku": cp.slug,
    "image": imgUrl, "description": metaDesc, "category": tag,
    "brand": { "@type": "Brand", "name": "Maxx Global" },
    "manufacturer": { "@type": "Organization", "name": "Maxx Global Medikal", "url": BASE + "/", "logo": BASE + "/assets/img/logo-maxx.png" },
    "countryOfOrigin": "TR", "url": canonical };
  const specRows = String(specText || "").split("\n").map((l) => l.trim()).filter((l) => l.includes("|"))
    .map((l) => ({ "@type": "PropertyValue", "name": l.slice(0, l.indexOf("|")).trim(), "value": l.slice(l.indexOf("|") + 1).trim() }));
  if (specRows.length) prod.additionalProperty = specRows;
  ld.push(prod);
  if (faqs.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": faqs.map((x) => ({ "@type": "Question", "name": x.q, "acceptedAnswer": { "@type": "Answer", "text": x.a } })) });
  const jsonld = ld.map((o) => '<script type="application/ld+json">' + JSON.stringify(o) + "<" + "/script>").join("\n  ");

  const title = (name + " | " + (en ? "Arthroscopy" : "Artroskopi") + " | " + T.site).slice(0, 68);
  return productTpl(lang)
    .replace(/\{\{TITLE\}\}/g, esc(title))
    .replace(/\{\{DESC\}\}/g, esc(metaDesc))
    .replace(/\{\{OG_IMAGE\}\}/g, imgUrl)
    .replace(/\{\{URL_TR\}\}/g, urlTr)
    .replace(/\{\{URL_EN\}\}/g, urlEn)
    .replace("{{JSONLD}}", jsonld)
    .replace("{{MAIN}}", main);
}

function adminUrunEklePage(msg, edit) {
  const cp = edit ? customBySlug(edit) : null;
  const val = (x) => esc(x || "");
  const mevcut = store.customProducts.slice().reverse().map((c) => `
    <tr>
      <td><span class="u-kart"><img src="/urun-gorsel/${c.slug}.webp" alt="" loading="lazy"><strong>${esc(c.name_tr || c.name_en)}</strong></span></td>
      <td><a href="/${c.slug}/" target="_blank">/${c.slug}/</a></td>
      <td style="white-space:nowrap">
        <a class="btn btn-outline btn-sm" href="/admin/urun-ekle/?edit=${c.slug}">Düzenle</a>
        <form method="post" action="/admin/urun-sil/" style="display:inline" onsubmit="return confirm('Bu ürün silinsin mi?')">
          <input type="hidden" name="slug" value="${c.slug}"><button class="btn btn-outline btn-sm">Sil</button></form>
      </td>
    </tr>`).join("");

  const body = `
  <span class="eyebrow">Yönetim Paneli</span>
  <h1 class="portal-title" style="font-size:2rem">${cp ? "Ürünü Düzenle" : "Yeni Ürün Ekle"}</h1>
  <p class="portal-sub">Fotoğraf, açıklama, teknik tablo ve SSS girin — kaydedince ürün web sitesinde (TR ve EN) yayınlanır.</p>
  ${msg || ""}
  <form class="kutu" method="post" action="/admin/urun-ekle/" enctype="application/x-www-form-urlencoded" onsubmit="return haz()">
    ${cp ? `<input type="hidden" name="duzenle" value="${cp.slug}">` : ""}
    <h2>Fotoğraf</h2>
    <p style="margin-bottom:14px"><small>Yatay (4:3) ve net bir görsel önerilir. Tarayıcı otomatik küçültüp optimize eder.</small></p>
    <input type="file" accept="image/*" id="foto" onchange="fotoSec(this)" style="margin-bottom:10px">
    <div><img id="onizleme" src="${cp ? "/urun-gorsel/" + cp.slug + ".webp" : ""}" alt="" style="max-width:280px;border-radius:12px;${cp ? "" : "display:none"};border:1px solid var(--line)"></div>
    <input type="hidden" name="foto_data" id="foto_data">

    <h2 class="mt-4">Ürün Adı</h2>
    <div class="form-grid">
      <p class="form-field"><label>Türkçe *</label><input name="name_tr" required maxlength="120" value="${val(cp && cp.name_tr)}"></p>
      <p class="form-field"><label>İngilizce *</label><input name="name_en" required maxlength="120" value="${val(cp && cp.name_en)}"></p>
      <p class="form-field"><label>Kategori Etiketi (TR)</label><input name="tag_tr" maxlength="60" placeholder="Artroskopi Ürünleri" value="${val(cp && cp.tag_tr)}"></p>
      <p class="form-field"><label>Kategori Etiketi (EN)</label><input name="tag_en" maxlength="60" placeholder="Arthroscopy Products" value="${val(cp && cp.tag_en)}"></p>
    </div>

    <h2 class="mt-4">Açıklama <small style="font-weight:400">(paragrafları boş satırla ayırın)</small></h2>
    <div class="form-grid">
      <p class="form-field"><label>Türkçe *</label><textarea name="desc_tr" rows="6" required style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.desc_tr)}</textarea></p>
      <p class="form-field"><label>İngilizce *</label><textarea name="desc_en" rows="6" required style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.desc_en)}</textarea></p>
    </div>

    <h2 class="mt-4">Teknik Tablo <small style="font-weight:400">(her satır: <span class="kod">Başlık | Değer</span>)</small></h2>
    <div class="form-grid">
      <p class="form-field"><label>Türkçe</label><textarea name="spec_tr" rows="5" placeholder="Malzeme | Titanyum&#10;Çap | 3.5 mm" style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.spec_tr)}</textarea></p>
      <p class="form-field"><label>İngilizce</label><textarea name="spec_en" rows="5" placeholder="Material | Titanium&#10;Diameter | 3.5 mm" style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.spec_en)}</textarea></p>
    </div>

    <h2 class="mt-4">SSS <small style="font-weight:400">(ilk satır soru, altı cevap; çiftleri boş satırla ayırın)</small></h2>
    <div class="form-grid">
      <p class="form-field"><label>Türkçe</label><textarea name="faq_tr" rows="6" style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.faq_tr)}</textarea></p>
      <p class="form-field"><label>İngilizce</label><textarea name="faq_en" rows="6" style="border:1.5px solid var(--line);border-radius:10px;padding:10px">${val(cp && cp.faq_en)}</textarea></p>
    </div>

    <p class="mt-4"><button class="btn btn-accent">${cp ? "Değişiklikleri Kaydet" : "Ürünü Ekle ve Yayınla"}</button>
    ${cp ? ' <a class="btn btn-outline" href="/admin/urun-ekle/">Vazgeç</a>' : ""}</p>
  </form>

  <div class="kutu">
    <h2>Eklenen Ürünler (${store.customProducts.length})</h2>
    ${store.customProducts.length ? `<table class="liste"><thead><tr><th>Ürün</th><th>Adres</th><th></th></tr></thead><tbody>${mevcut}</tbody></table>` : "<p>Henüz yeni ürün eklenmedi. Yukarıdaki formla ekleyebilirsiniz.</p>"}
  </div>`;

  const script = `<script>
    function fotoSec(input) {
      var f = input.files[0]; if (!f) return;
      var img = new Image();
      img.onload = function () {
        var maxW = 1100, sc = Math.min(1, maxW / img.width);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/webp', 0.82);
        if (data.length < 1000) data = c.toDataURL('image/jpeg', 0.85);
        document.getElementById('foto_data').value = data;
        var o = document.getElementById('onizleme'); o.src = data; o.style.display = '';
      };
      img.src = URL.createObjectURL(f);
    }
    function haz() {
      if (!document.getElementById('foto_data').value && !${cp ? "true" : "false"}) {
        alert('Lütfen bir ürün fotoğrafı seçin.'); return false;
      }
      return true;
    }
  </script>`;
  return adminLayout("/admin/urun-ekle/", cp ? "Ürünü Düzenle" : "Yeni Ürün", body, { script });
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
      const lang = bayiDil(req, url);
      if (req.method === "GET") {
        const T = BL[lang];
        const okMsg = lang === "en"
          ? '<p class="msg msg-ok">Your application has been received! We will send an activation link to your e-mail once approved.</p>'
          : '<p class="msg msg-ok">Başvurunuz alındı! Onaylandığında e-posta adresinize aktivasyon bağlantısı göndereceğiz.</p>';
        return send(bayilikAlPage(lang, url.searchParams.get("ok") ? okMsg : ""));
      }
      const f = parseForm(await readBody(req));
      const flang = f.lang === "en" ? "en" : "tr";
      if (f.web_site) return redirect("/bayilik-al/?ok=1&lang=" + flang);
      const firma = clamp(f.firma, 120), yetkili = clamp(f.yetkili, 120), eposta = clamp(f.eposta, 180).toLowerCase(),
        telefon = clamp(f.telefon, 40), adres = clamp(f.adres, 300), sehir = clamp(f.sehir, 80),
        lat = parseFloat(f.lat), lng = parseFloat(f.lng);
      const hataMsg = flang === "en"
        ? '<p class="msg msg-err">Please fill in all required fields and mark your location.</p>'
        : '<p class="msg msg-err">Lütfen tüm zorunlu alanları doldurun ve haritada konum işaretleyin.</p>';
      if (!firma || !yetkili || !telefon || !adres || !sehir || !emailOk(eposta) || !isFinite(lat) || !isFinite(lng))
        return send(bayilikAlPage(flang, hataMsg));
      if (store.dealers.some((d) => d.eposta === eposta && d.durum !== "reddedildi"))
        return send(bayilikAlPage(flang, flang === "en"
          ? '<p class="msg msg-err">An application already exists with this e-mail.</p>'
          : '<p class="msg msg-err">Bu e-posta ile daha önce başvuru yapılmış.</p>'));
      store.dealers.push({
        id: crypto.randomUUID(), firma, yetkili, eposta, telefon, adres, sehir, lang: flang,
        lat, lng, durum: "beklemede", kayitTarihi: Date.now(),
      });
      saveStore();
      sendMail(ORDER_EMAIL, "Yeni bayilik başvurusu: " + firma,
        `Firma: ${firma}\nYetkili: ${yetkili}\nŞehir: ${sehir}\nE-posta: ${eposta}\nTelefon: ${telefon}\nAdres: ${adres}\n\nOnaylamak için yönetim paneline girin.`);
      return redirect("/bayilik-al/?ok=1&lang=" + flang);
    }

    /* ---- Bayi girişi ---- */
    if (p === "/bayi/giris/") {
      const lang = bayiDil(req, url);
      if (req.method === "GET") return send(bayiGirisPage(lang));
      const f = parseForm(await readBody(req));
      const flang = f.lang === "en" ? "en" : "tr";
      const eposta = clamp(f.eposta, 180).toLowerCase();
      const key = "b:" + ip + ":" + eposta;
      if (rateLimited(key)) return send(bayiGirisPage(flang, flang === "en"
        ? '<p class="msg msg-err">Too many attempts. Try again in 15 minutes.</p>'
        : '<p class="msg msg-err">Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.</p>'), 429);
      const d = store.dealers.find((x) => x.eposta === eposta);
      if (!d || !verifyPassword(f.parola || "", d.salt, d.hash)) {
        recordFail(key);
        if (d && d.durum === "beklemede") return send(bayiGirisPage(flang, flang === "en"
          ? '<p class="msg msg-info">Your application has not been approved yet.</p>'
          : '<p class="msg msg-info">Başvurunuz henüz onaylanmadı. Onaylandığında e-posta alacaksınız.</p>'));
        if (d && d.durum === "onayli" && !d.salt) return send(bayiGirisPage(flang, flang === "en"
          ? '<p class="msg msg-info">Approved but not activated — use the activation link in your e-mail.</p>'
          : '<p class="msg msg-info">Hesabınız onaylandı ancak henüz etkinleştirilmedi. E-postanızdaki aktivasyon bağlantısını kullanın.</p>'));
        return send(bayiGirisPage(flang, flang === "en"
          ? '<p class="msg msg-err">Wrong e-mail or password.</p>'
          : '<p class="msg msg-err">E-posta veya parola hatalı.</p>'));
      }
      if (d.durum !== "onayli") return send(bayiGirisPage(flang, '<p class="msg msg-err">Hesabınız aktif değil.</p>'));
      d.lang = flang; saveStore();
      setCookie(res, "bayi", makeSession({ t: "bayi", id: d.id }, 7), 7 * 86400);
      return redirect("/bayi/");
    }

    /* ---- Aktivasyon (ilk parola belirleme ve parola sıfırlama ortak akışı) ---- */
    if (p === "/bayi/aktivasyon/") {
      const lang = bayiDil(req, url);
      const token = req.method === "GET" ? url.searchParams.get("token") : null;
      if (req.method === "GET") {
        const d = store.dealers.find((x) => x.token && x.token === token && x.durum === "onayli");
        if (!d) return send(pageShell("Aktivasyon", '<p class="msg msg-err">Aktivasyon bağlantısı geçersiz ya da kullanılmış.</p>'), 400);
        return send(aktivasyonPage(d.lang || lang, token, "", !!d.salt));
      }
      const f = parseForm(await readBody(req));
      const d = store.dealers.find((x) => x.token && x.token === f.token && x.durum === "onayli");
      if (!d) return send(pageShell("Aktivasyon", '<p class="msg msg-err">Aktivasyon bağlantısı geçersiz.</p>'), 400);
      const isReset = !!d.salt;
      if ((f.p1 || "").length < 8 || f.p1 !== f.p2)
        return send(aktivasyonPage(d.lang || "tr", f.token, d.lang === "en"
          ? '<p class="msg msg-err">Passwords must match and be at least 8 characters.</p>'
          : '<p class="msg msg-err">Parolalar eşleşmeli ve en az 8 karakter olmalı.</p>', isReset));
      Object.assign(d, hashPassword(f.p1));
      delete d.token;
      saveStore();
      setCookie(res, "bayi", makeSession({ t: "bayi", id: d.id }, 7), 7 * 86400);
      return redirect("/bayi/");
    }

    /* ---- Bayi parola sıfırlama (şifremi unuttum) ---- */
    if (p === "/bayi/sifremi-unuttum/") {
      const lang = bayiDil(req, url);
      if (req.method === "GET") return send(sifremiUnuttumPage(lang));
      const f = parseForm(await readBody(req));
      const flang = f.lang === "en" ? "en" : "tr";
      const eposta = clamp(f.eposta, 180).toLowerCase();
      const key = "f:" + ip;
      if (rateLimited(key)) return send(sifremiUnuttumPage(flang, flang === "en"
        ? '<p class="msg msg-err">Too many attempts. Try again in 15 minutes.</p>'
        : '<p class="msg msg-err">Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.</p>'), 429);
      recordFail(key); // e-posta gönderim spam'ini de bu sayaçla sınırla
      const d = store.dealers.find((x) => x.eposta === eposta && x.durum === "onayli");
      if (d) {
        d.token = crypto.randomBytes(24).toString("base64url");
        saveStore();
        const base = (IS_PROD ? "https://" : "http://") + (req.headers.host || "localhost");
        const isReset = !!d.salt;
        sendMail(d.eposta, isReset ? "Maxx Global parola sıfırlama" : "Maxx Global bayilik hesabınızı etkinleştirin",
          `Sayın ${d.yetkili},\n\n` +
          (isReset ? "Yeni parola belirlemek için aşağıdaki bağlantıyı kullanın:\n" : "Hesabınızı etkinleştirmek için aşağıdaki bağlantıyı kullanın:\n") +
          `${base}/bayi/aktivasyon/?token=${d.token}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.\n\nMaxx Global Medikal`);
      }
      // Bayi kayıtlı olsun ya da olmasın aynı mesaj gösterilir (e-posta numaralandırma saldırısını önlemek için)
      return send(sifremiUnuttumPage(flang, `<p class="msg msg-ok">${BL[flang].sifirlama_gonderildi_msg}</p>`));
    }

    /* ---- Bayi portalı (ürünler + sepet) ---- */
    if (p === "/bayi/") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      return send(bayiPortalPage(d, bayiDil(req, url, d), ""));
    }

    /* ---- Sipariş takibi (ayrı sayfa) ---- */
    if (p === "/bayi/siparisler/") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const lang = bayiDil(req, url, d);
      const T = BL[lang];
      let m = "";
      if (url.searchParams.get("no")) m = `<p class="msg msg-ok">${T.istek_alindi} <strong>${esc(url.searchParams.get("no"))}</strong>. ${T.istek_alindi2}</p>`;
      if (url.searchParams.get("tesekkur")) m = `<p class="msg msg-ok">${T.tesekkur_alindi}</p>`;
      return send(bayiSiparislerPage(d, lang, m));
    }

    /* ---- Sipariş isteği (sepet) ---- */
    if (p === "/bayi/siparis/" && req.method === "POST") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const lang = d.lang || "tr";
      const f = parseForm(await readBody(req));
      let sepet = {};
      try { sepet = JSON.parse(f.sepet || "{}"); } catch {}
      const kalemler = [];
      for (const [slug, name] of allDealerProducts()) {
        const n = parseInt(sepet[slug] || 0, 10);
        if (n > 0) kalemler.push({ slug, ad: name, adet: Math.min(n, 99999) });
      }
      if (!kalemler.length) return send(bayiPortalPage(d, lang, `<p class="msg msg-err">${BL[lang].en_az_bir}</p>`));
      const no = orderNo();
      store.orders.push({
        id: crypto.randomUUID(), no, dealerId: d.id, tarih: Date.now(),
        kalemler, not: clamp(f.not, 1000),
        durum: "fiyat_bekliyor", fiyat: null, adminOnay: false, bayiOnay: false,
      });
      saveStore();
      sendMail(ORDER_EMAIL, `Yeni sipariş isteği ${no} — ${d.firma}`,
        `Bayi: ${d.firma} (${d.yetkili})\nE-posta: ${d.eposta}\nTelefon: ${d.telefon}\n\nSipariş No: ${no}\n\n` +
        kalemler.map((k) => `- ${k.ad} × ${k.adet}`).join("\n") +
        (f.not ? `\n\nNot: ${clamp(f.not, 1000)}` : "") +
        `\n\nFiyat belirlemek için yönetim paneline girin.`);
      return redirect("/bayi/siparisler/?no=" + encodeURIComponent(no));
    }

    /* ---- Bayi fiyat onayı ---- */
    if (p === "/bayi/onayla/" && req.method === "POST") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const f = parseForm(await readBody(req));
      const o = store.orders.find((x) => x.id === f.id && x.dealerId === d.id);
      if (o && o.durum === "fiyat_verildi" && !o.bayiOnay) {
        o.bayiOnay = true;
        o.bayiOnayTarihi = Date.now();
        if (o.adminOnay) { o.durum = "hazirlaniyor"; o.kargoTarihi = Date.now(); }
        saveStore();
        sendMail(ORDER_EMAIL, `Bayi siparişi onayladı: ${o.no} — ${d.firma}`,
          `${d.firma}, ${o.no} numaralı sipariş için ${siparisParaFmt(o, o.fiyat)} fiyat teklifini ONAYLADI.` +
          (o.adminOnay ? "\nHer iki onay tamam — sipariş Hazırlanıyor durumuna geçti." : "\nSizin onayınız bekleniyor (yönetim paneli → Siparişler)."));
      }
      return redirect("/bayi/siparisler/");
    }

    /* ---- Bayi teşekkür mesajı ---- */
    if (p === "/bayi/tesekkur/" && req.method === "POST") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const f = parseForm(await readBody(req));
      const o = store.orders.find((x) => x.id === f.id && x.dealerId === d.id);
      const mesaj = clamp(f.mesaj, 600);
      if (o && o.durum === "teslim" && !o.tesekkur && mesaj) {
        o.tesekkur = mesaj;
        store.thanks.push({ tarih: Date.now(), firma: d.firma, sehir: d.sehir, no: o.no, mesaj });
        saveStore();
      }
      return redirect("/bayi/siparisler/?tesekkur=1");
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
        // Vercel arkasında gerçek alan adı x-forwarded-host'tadır (host = api.maxx-global.net olur)
        const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
        const base = (IS_PROD ? "https://" : "http://") + host;
        const gitti = await sendMail(d.eposta, "Maxx Global bayilik başvurunuz onaylandı",
          `Sayın ${d.yetkili},\n\n${d.firma} adına yaptığınız bayilik başvurusu onaylanmıştır.\n` +
          `Hesabınızı etkinleştirmek için: ${base}/bayi/aktivasyon/?token=${d.token}\n\nMaxx Global Medikal`);
        return redirect("/admin/onaylar/?mail=" + (gitti ? "ok" : "hata"));
      } else if (d) {
        d.durum = "reddedildi";
        saveStore();
      }
      return redirect("/admin/onaylar/");
    }

    /* ---- Admin: menü sayfaları ---- */
    if (p === "/admin/onaylar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      const m = url.searchParams.get("mail");
      return send(adminOnaylarPage(
        m === "ok" ? '<p class="msg msg-ok">Bayi onaylandı; aktivasyon e-postası gönderildi.</p>'
        : m === "hata" ? '<p class="msg msg-err">Bayi onaylandı ancak aktivasyon e-postası GÖNDERİLEMEDİ. Aşağıdaki tablodan aktivasyon bağlantısını kopyalayıp bayiye iletebilirsiniz. (Olası neden: Resend alan adı doğrulaması eksik ya da MAIL_FROM ayarı yanlış — Railway loglarına bakın.)</p>'
        : ""));
    }
    if (p === "/admin/fiyatlar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminFiyatlarPage(url.searchParams.get("ok") ? '<p class="msg msg-ok">Fiyatlar kaydedildi — bayi portalında şu anda geçerli.</p>' : ""));
    }
    if (p === "/admin/aciklamalar/" && req.method === "GET") {
      if (!adminSes) return redirect("/admin/");
      return send(adminAciklamalarPage());
    }

    /* ---- Admin: yeni ürün ekle/düzenle ---- */
    if (p === "/admin/urun-ekle/") {
      if (!adminSes) return redirect("/admin/");
      if (req.method === "GET") {
        const e = url.searchParams.get("edit");
        return send(adminUrunEklePage(url.searchParams.get("ok") ? '<p class="msg msg-ok">Ürün kaydedildi ve web sitesinde yayınlandı.</p>' : "", e && customBySlug(e) ? e : null));
      }
      const f = parseForm(await readBody(req, 9_000_000)); // fotoğraf base64 için büyük gövde
      const duzenle = f.duzenle ? customBySlug(f.duzenle) : null;
      const name_tr = clamp(f.name_tr, 120), name_en = clamp(f.name_en, 120);
      if (!name_tr || !name_en || !clamp(f.desc_tr, 1) || !clamp(f.desc_en, 1))
        return send(adminUrunEklePage('<p class="msg msg-err">Ürün adı (TR+EN) ve açıklama (TR+EN) zorunludur.</p>', duzenle && duzenle.slug), 400);

      // Fotoğrafı kaydet (base64 data URL → webp dosyası)
      let slug = duzenle ? duzenle.slug : uniqueSlug(slugify(name_tr));
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const dataUrl = f.foto_data || "";
      const mm = dataUrl.match(/^data:image\/\w+;base64,([\s\S]+)$/);
      if (mm) {
        const buf = Buffer.from(mm[1], "base64");
        if (buf.length > 6_000_000) return send(adminUrunEklePage('<p class="msg msg-err">Fotoğraf çok büyük.</p>', duzenle && duzenle.slug), 400);
        fs.writeFileSync(path.join(UPLOAD_DIR, slug + ".webp"), buf);
      } else if (!duzenle) {
        return send(adminUrunEklePage('<p class="msg msg-err">Lütfen bir ürün fotoğrafı seçin.</p>'), 400);
      }

      const kayit = {
        slug, name_tr, name_en,
        tag_tr: clamp(f.tag_tr, 60) || "Artroskopi Ürünleri",
        tag_en: clamp(f.tag_en, 60) || "Arthroscopy Products",
        desc_tr: clamp(f.desc_tr, 5000), desc_en: clamp(f.desc_en, 5000),
        spec_tr: clamp(f.spec_tr, 3000), spec_en: clamp(f.spec_en, 3000),
        faq_tr: clamp(f.faq_tr, 5000), faq_en: clamp(f.faq_en, 5000),
        created: duzenle ? duzenle.created : Date.now(),
      };
      if (duzenle) Object.assign(duzenle, kayit);
      else store.customProducts.push(kayit);
      saveStore();
      return redirect("/admin/urun-ekle/?ok=1");
    }

    if (p === "/admin/urun-sil/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      const i = store.customProducts.findIndex((c) => c.slug === f.slug);
      if (i !== -1) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, store.customProducts[i].slug + ".webp")); } catch {}
        store.customProducts.splice(i, 1);
        saveStore();
      }
      return redirect("/admin/urun-ekle/");
    }
    if (req.method === "GET" && ["/admin/siparisler/", "/admin/siparisler/onay/", "/admin/siparisler/kargo/",
        "/admin/siparisler/teslim/", "/admin/tesekkurler/", "/admin/talepler/"].includes(p)) {
      if (!adminSes) return redirect("/admin/");
      if (p === "/admin/siparisler/") return send(adminFiyatBekleyenPage());
      if (p === "/admin/siparisler/onay/") return send(adminOnayPage());
      if (p === "/admin/siparisler/kargo/") return send(adminKargoPage());
      if (p === "/admin/siparisler/teslim/") return send(adminTeslimPage());
      if (p === "/admin/tesekkurler/") return send(adminTesekkurlerPage());
      return send(adminTaleplerPage());
    }
    if (p === "/admin/api/yeni/") {
      if (!adminSes) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end("{}"); }
      const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
      const basvurular = store.dealers.filter((d) => d.kayitTarihi > since).map((d) => ({ firma: d.firma }));
      const siparisler = store.orders.filter((o) => o.tarih > since).map((o) => {
        const d = store.dealers.find((x) => x.id === o.dealerId);
        return { no: o.no, firma: d ? d.firma : "" };
      });
      const onaylar = store.orders.filter((o) => o.bayiOnayTarihi && o.bayiOnayTarihi > since).map((o) => {
        const d = store.dealers.find((x) => x.id === o.dealerId);
        return { no: o.no, firma: d ? d.firma : "" };
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ now: Date.now(), basvurular, siparisler, onaylar }));
    }

    /* ---- Admin: sipariş fiyatı belirle (ürün başı + indirim) ---- */
    if (p === "/admin/siparis/fiyat/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      const o = store.orders.find((x) => x.id === f.id);
      if (o && o.durum === "fiyat_bekliyor") {
        const paraOku = (v) => parseFloat(String(v || "").replace(/\./g, "").replace(",", "."));
        const secilenPara = paraBirimi(f.para_birimi);
        let ara = 0, eksik = false;
        for (const k of o.kalemler) {
          const b = paraOku(f["birim_" + k.slug]);
          if (!isFinite(b) || b <= 0) { eksik = true; break; }
          k.birim = Math.round(b * 100) / 100;
          ara += k.birim * k.adet;
        }
        if (!eksik && ara > 0) {
          const tip = f.indirim_tip === "tutar" ? "tutar" : "yuzde";
          let deger = paraOku(f.indirim);
          if (!isFinite(deger) || deger < 0) deger = 0;
          if (tip === "yuzde") deger = Math.min(deger, 99);
          const indirimTutar = tip === "tutar" ? Math.min(deger, ara) : ara * deger / 100;
          o.araToplam = Math.round(ara * 100) / 100;
          o.indirimTip = deger > 0 ? tip : null;
          o.indirimDeger = deger > 0 ? deger : 0;
          o.indirimTutar = Math.round(indirimTutar * 100) / 100;
          o.indirim = tip === "yuzde" && deger > 0 ? deger : 0;
          o.fiyat = Math.round((ara - indirimTutar) * 100) / 100;
          o.paraBirimi = secilenPara;
          o.seffaf = f.seffaf === "1";
          o.durum = "fiyat_verildi";
          o.fiyatTarihi = Date.now();
          saveStore();
          const d = store.dealers.find((x) => x.id === o.dealerId);
          if (d) sendMail(d.eposta,
            d.lang === "en" ? `Price quote for your order ${o.no}` : `${o.no} numaralı siparişiniz için fiyat teklifi`,
            d.lang === "en"
              ? `Dear ${d.yetkili},\n\nOur quote for order ${o.no}: ${siparisParaFmt(o, o.fiyat)}${indirimTutarOf(o) ? ` (discount applied: ${indirimEtiketi(o)})` : ""}.\nLog in to the dealer portal to review and approve.`
              : `Sayın ${d.yetkili},\n\n${o.no} numaralı siparişiniz için fiyat teklifimiz: ${siparisParaFmt(o, o.fiyat)}${indirimTutarOf(o) ? ` (${indirimEtiketi(o)} indirim uygulandı)` : ""}.\nİncelemek ve onaylamak için bayi portalına giriş yapın.`);
        }
      }
      return redirect("/admin/siparisler/");
    }

    /* ---- Teklif dökümü: bayi (şeffaf ise) ---- */
    if (p === "/bayi/teklif/") {
      const d = bayiSes && store.dealers.find((x) => x.id === bayiSes.id && x.durum === "onayli");
      if (!d) return redirect("/bayi/giris/");
      const o = store.orders.find((x) => x.id === url.searchParams.get("id") && x.dealerId === d.id);
      if (!o || !o.seffaf || !o.fiyat) return redirect("/bayi/siparisler/");
      return send(teklifPage(o, d, d.lang || "tr", "/bayi/siparisler/"));
    }

    /* ---- Teklif dökümü: admin ---- */
    if (p === "/admin/teklif/") {
      if (!adminSes) return redirect("/admin/");
      const o = store.orders.find((x) => x.id === url.searchParams.get("id"));
      if (!o || !o.fiyat) return redirect("/admin/siparisler/");
      const d = store.dealers.find((x) => x.id === o.dealerId) || { firma: "?" };
      return send(teklifPage(o, d, "tr", "/admin/siparisler/"));
    }

    /* ---- Admin: sipariş onayı ---- */
    if (p === "/admin/siparis/onayla/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      const o = store.orders.find((x) => x.id === f.id);
      if (o && o.durum === "fiyat_verildi" && !o.adminOnay) {
        o.adminOnay = true;
        o.adminOnayTarihi = Date.now();
        if (o.bayiOnay) { o.durum = "hazirlaniyor"; o.kargoTarihi = Date.now(); }
        saveStore();
      }
      return redirect(o && o.durum === "hazirlaniyor" ? "/admin/siparisler/kargo/" : "/admin/siparisler/onay/");
    }

    /* ---- Admin: kargo durumu güncelle ---- */
    if (p === "/admin/siparis/kargo/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      const o = store.orders.find((x) => x.id === f.id);
      if (o && ["hazirlaniyor", "kargoda", "teslim"].includes(f.kdurum) &&
          ["hazirlaniyor", "kargoda", "teslim"].includes(o.durum)) {
        o.durum = f.kdurum;
        o.kargoTakip = clamp(f.takip, 60);
        saveStore();
        const d = store.dealers.find((x) => x.id === o.dealerId);
        if (d && f.kdurum === "kargoda") sendMail(d.eposta,
          d.lang === "en" ? `Your order ${o.no} has been shipped` : `${o.no} numaralı siparişiniz kargoya verildi`,
          (d.lang === "en" ? `Your order is on its way.` : `Siparişiniz yola çıktı.`) +
          (o.kargoTakip ? `\nTakip / Tracking: ${o.kargoTakip}` : ""));
      }
      return redirect(f.kdurum === "teslim" ? "/admin/siparisler/teslim/" : "/admin/siparisler/kargo/");
    }

    /* ---- Admin: bayilere fiyat gösterimi anahtarı ---- */
    if (p === "/admin/fiyat-goster/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      store.settings.fiyatGoster = !store.settings.fiyatGoster;
      saveStore();
      return redirect("/admin/fiyatlar/");
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
        if (key.startsWith("sss:")) delete store.content["sssld:" + key.slice(4)];
        saveStore();
        return send(icerikDuzenlePage(key, '<p class="msg msg-ok">Orijinal metne dönüldü ve yayına alındı.</p>'));
      }
      const metin = String(f.metin || "").slice(0, 20000).trim();
      if (!metin) return send(icerikDuzenlePage(key, '<p class="msg msg-err">Metin boş olamaz.</p>'));
      if (key.startsWith("spec:")) {
        store.content[key] = textToSpec(metin);
      } else if (key.startsWith("sss:")) {
        if (!sssParse(metin).length) return send(icerikDuzenlePage(key, '<p class="msg msg-err">En az bir soru-cevap çifti gerekli (ilk satır soru, altı cevap).</p>'));
        store.content[key] = textToSss(metin);
        store.content["sssld:" + key.slice(4)] = sssLdScript(metin); // Google SSS verisi görünürle eş
      } else {
        store.content[key] = textToHtml(metin, isInlineKey(key));
      }
      saveStore();
      return send(icerikDuzenlePage(key, '<p class="msg msg-ok">Kaydedildi — web sitesinde şu anda yayında.</p>'));
    }

    /* ---- Admin: bayi fiyatları ---- */
    if (p === "/admin/fiyatlar/" && req.method === "POST") {
      if (!adminSes) return redirect("/admin/");
      const f = parseForm(await readBody(req));
      for (const [slug] of PRODUCTS) {
        const v = parseFloat(String(f["fiyat_" + slug] || "").replace(",", "."));
        const kod = paraBirimi(f["para_" + slug]);
        if (isFinite(v) && v > 0) store.prodMeta[slug] = { ...(store.prodMeta[slug] || {}), fiyat: Math.round(v * 100) / 100, paraBirimi: kod };
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

    /* ---- Yeni ürün görseli (kalıcı diskten) ---- */
    if (p.startsWith("/urun-gorsel/")) {
      const fn = path.basename(url.pathname);
      if (!/^[a-z0-9-]+\.webp$/.test(fn)) { res.writeHead(404); return res.end(); }
      const file = path.join(UPLOAD_DIR, fn);
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" });
      return res.end(fs.readFileSync(file));
    }

    /* ---- Yeni ürünlerin detay sayfası ---- */
    {
      const m = url.pathname.replace(/\/+$/, "").match(/^\/([a-z0-9-]+?)(-en)?$/);
      if (m) {
        const cp = customBySlug(m[1]);
        if (cp) {
          const html = renderCustomProduct(cp, m[2] ? "en" : "tr");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Frame-Options": "SAMEORIGIN" });
          return res.end(html);
        }
      }
    }

    /* ---- Dinamik sitemap: yeni ürünleri de ekle ---- */
    if (url.pathname === "/sitemap.xml" && store.customProducts.length) {
      let xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
      const extra = store.customProducts.map((c) =>
        `  <url><loc>${BASE}/${c.slug}/</loc>\n    <xhtml:link rel="alternate" hreflang="tr" href="${BASE}/${c.slug}/"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${BASE}/${c.slug}-en/"/>\n    <priority>0.7</priority></url>\n` +
        `  <url><loc>${BASE}/${c.slug}-en/</loc>\n    <xhtml:link rel="alternate" hreflang="tr" href="${BASE}/${c.slug}/"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${BASE}/${c.slug}-en/"/>\n    <priority>0.7</priority></url>`).join("\n");
      xml = xml.replace("</urlset>", extra + "\n</urlset>");
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(xml);
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
  console.log(`Maxx Global sitesi + bayi portalı çalışıyor (port ${PORT})`);
  console.log(`Yönetim paneli girişi: /admin/  (${store.admin.email})`);
  if (generatedPw) console.log(`İlk kurulum yönetici parolası: ${generatedPw}  ← .env dosyasına da yazıldı sanmayın; kaydedin!`);
  if (!RESEND_KEY) console.log("Not: RESEND_API_KEY tanımlı değil — e-postalar konsola yazılır.");
});
