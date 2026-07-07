# Yöncü (cPanel) Node.js Kurulum Rehberi — Yayınlayan Arkadaşa

Bu site iki parçalı: **statik web sayfaları** + **Node.js ile çalışan bayi portalı/admin paneli**.
"Bayilik Al" ve "Bayi Girişi" sayfaları hazır dosya değildir; `server/server.js` çalışırken üretilir.
Bu yüzden dosyaları public_html'e atmak yetmez — **Node.js uygulaması olarak çalıştırmak** gerekir.
Node.js sunucusu **hem web sitesini hem portalı birlikte** sunar; tek uygulama her şeyi halleder.

## Ön koşul: Node.js desteği var mı?
cPanel'de **"Setup Node.js App"** (veya "Node.js Selector" / "Node.js Uygulaması") bölümü varsa destekliyor demektir.
Yoksa Yöncü'ye "Node.js destekli paket" sorulmalı; yoksa Railway gibi bir yere taşınır.

## Adımlar

### 1) Dosyaları yükle
- GitHub'daki `codezgi/Maxx` reposunun **tamamını** hosting'e yükleyin (sadece HTML değil — `server/` klasörü ve `app.js` dahil).
- Önerilen konum: ana dizinde bir klasör, örn. `/home/KULLANICI/maxxglobal/`
- Not: `.env` dosyası GitHub'da YOKTUR (gizli). Onu ayrıca eklemeniz gerekir (Adım 3).

### 2) Node.js uygulaması oluştur
cPanel → **Setup Node.js App** → **Create Application**:
- **Node.js version:** 18 veya üzeri (en güncelini seçin)
- **Application mode:** Production
- **Application root:** dosyaları yüklediğiniz klasör (örn. `maxxglobal`)
- **Application URL:** `www.maxx-global.net` (sitenin çıkacağı adres)
- **Application startup file:** `app.js`  (bu dosya hazır; `server/server.js`'i çağırır)
- **Create** deyin.

### 3) Ortam değişkenlerini (environment variables) gir
Aynı ekranda "Environment variables" bölümüne şunları ekleyin (bu değerler `.env` dosyasındakiyle aynı olmalı;
`.env`'i sunucuya elle de yükleyebilirsiniz, ikisi de olur):

| Değişken | Değer |
|---|---|
| `SESSION_SECRET` | (gizli uzun dizi — `.env` dosyasındaki değeri kullanın; rastgele olmalı) |
| `ADMIN_EMAIL` | `info@maxx-global.net` |
| `ADMIN_PASSWORD` | (güçlü bir parola — giriş için) |
| `ORDER_EMAIL` | `info@maxx-global.net` |
| `NODE_ENV` | `production` |

> E-posta gönderimi için ileride `RESEND_API_KEY` ve `MAIL_FROM` eklenecek — şimdilik gerekmez,
> onlarsız da site ve portal çalışır (mailler sadece gönderilmez).

### 4) Bağımlılık yok — "Run NPM Install" gerekmez
Bu uygulamanın hiçbir dış paketi yoktur (sadece Node'un kendi modülleri). `npm install` bir şey yüklemez, sorun olmaz.

### 5) Başlat
"Start App" / "Restart" deyin. Sonra tarayıcıda:
- `www.maxx-global.net/` → web sitesi açılmalı
- `www.maxx-global.net/bayilik-al/` → bayilik başvuru formu açılmalı
- `www.maxx-global.net/admin/` → yönetici girişi açılmalı

## Önemli notlar
- **Veri kalıcılığı:** Bayi kayıtları/siparişler `server/data/store.json` dosyasında tutulur. cPanel'de bu dosya
  diskte kalıcıdır (Railway'deki gibi ayrı "volume" gerekmez) — ama bu klasöre **yazma izni** olmalı (genelde otomatik olur).
- **Güncelleme:** Kod güncellenince (GitHub'dan çekip) cPanel'de **Restart** demek yeterli.
  `server/data/` klasörünü SİLMEYİN — bayi verileri oradadır.
- **SESSION_SECRET mutlaka sabit olmalı:** Tanımlı değilse her yeniden başlatmada değişir ve tüm oturumlar düşer
  (kullanıcılar sürekli çıkış yapmış olur). `.env`/env değişkeni ile sabit tutun.
- **Statik dosyalar da Node üzerinden gider:** Passenger "static file serving" ayarını Node'a bırakın; aksi halde
  admin panelinden yapılan metin düzenlemeleri sitede görünmeyebilir.

## Takıldığınız yerde
Hata alırsanız cPanel'deki uygulama loglarına bakın (Setup Node.js App ekranında log bağlantısı olur).
Log çıktısını paylaşın, çözelim.
