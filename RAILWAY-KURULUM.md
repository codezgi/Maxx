# Railway Yayınlama Rehberi — Maxx Global

Bu site (web sitesi + bayi portalı + admin panel) tek bir Node.js sunucusuyla çalışır.
Railway, GitHub'daki `codezgi/Maxx` reposunu otomatik alıp çalıştırır. Adımlar:

## 1. Hesap ve proje
- [ ] [railway.app](https://railway.app) → **GitHub ile giriş** yap
- [ ] **New Project** → **Deploy from GitHub repo** → `codezgi/Maxx` seç
- [ ] Railway otomatik algılar: Node.js uygulaması, `npm start` ile başlatır (ayar gerekmez)

## 2. Ortam değişkenleri (Variables sekmesi)
Projeye tıkla → **Variables** → şunları ekle:

| Değişken | Değer |
|---|---|
| `SESSION_SECRET` | (yerel `.env` dosyasındaki gizli değeri kullan — rastgele uzun dizi) |
| `ADMIN_EMAIL` | `info@maxx-global.net` |
| `ADMIN_PASSWORD` | (güçlü bir parola belirle) |
| `ORDER_EMAIL` | `info@maxx-global.net` |
| `NODE_ENV` | `production` |

> Mail için `RESEND_API_KEY` ve `MAIL_FROM` sonra eklenecek — şimdilik gerekmez, portal onlarsız çalışır.

## 3. ⚠️ KALICI DİSK (Volume) — çok önemli
Bayi kayıtları ve siparişler `server/data/` içinde tutulur. Volume eklenmezse **her güncellemede silinir**.
- [ ] Projede servise sağ tık → **Add Volume**
- [ ] **Mount path:** `/app/server/data`
- [ ] Kaydet. (Böylece veriler güncellemeler arasında korunur.)

## 4. Alan adını bağla (domain)
- [ ] Railway → servis → **Settings** → **Networking** → **Custom Domain** → `www.maxx-global.net` ekle
- [ ] Railway sana bir **CNAME hedefi** verir (örn. `xxx.up.railway.app`)
- [ ] Alan adı DNS panelinde (Yöncü'de) **CNAME kaydı** ekle: `www` → Railway'in verdiği hedef
- [ ] Kök alan (`maxx-global.net`) için: Yöncü DNS'inde `www`'ye yönlendirme (redirect) ayarla
- [ ] SSL (https) Railway tarafından **otomatik** verilir, ekstra iş yok

## 5. Kontrol
Yayınlandıktan sonra:
- `www.maxx-global.net/` → web sitesi ✅
- `www.maxx-global.net/bayilik-al/` → bayilik formu ✅
- `www.maxx-global.net/admin/` → yönetici girişi ✅

## Güncelleme nasıl olur?
GitHub'a her `git push` yapıldığında Railway **otomatik** yeniden yayınlar. Elle bir şey yapmaya gerek yok.
`server/data/` volume'de olduğu için veriler korunur.

## Maliyet
Railway kullanım bazlı; bu hafif uygulama için aylık birkaç dolar seviyesindedir.
(Alternatifler: Render, Fly.io — aynı mantıkla çalışır.)
