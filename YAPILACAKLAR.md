# Maxx Global — Yayın Öncesi Yapılacaklar Listesi

Bu doküman, site canlıya çıkmadan önce halledilmesi gereken **karar ve ayarları** listeler.
Kod tarafı hazır; buradaki maddeler çoğunlukla **hesap açma, ayar girme ve karar verme** işleridir.
Sorumlusu belli olanları işaretledim (👤 = sizin/ekip, 🤖 = ben yapabilirim).

---

## 🔴 KRİTİK — Yayına çıkmadan önce mutlaka

### 1. Hosting seçimi ve yayınlama (👤 karar + 🤖 uygulama)
Bu site **iki parçadan** oluşuyor, bu yüzden basit "statik hosting" yetmez:
- **Statik kısım** (76 sayfa, HTML/CSS) — herhangi bir yerde çalışır.
- **Bayi portalı + admin paneli** (`server/server.js`) — sürekli çalışan bir **Node.js sunucusu** ve
  **kalıcı disk** (bayi kayıtları, siparişler `server/data/` içinde) gerektirir.

**Öneri: Railway** (aylık ~5$'dan başlar). Nedeni: hem Node sunucusunu çalıştırır hem kalıcı disk verir,
GitHub'dan otomatik deploy eder. Alternatifler: Render, Fly.io, DigitalOcean.
> ⚠️ Vercel/Netlify TEK BAŞINA yetmez — onlar bayi portalını kalıcı çalıştıramaz (veriler her deploy'da silinir).

**Yapılacaklar:**
- [ ] Railway hesabı aç, GitHub reposunu (`codezgi/Maxx`) bağla
- [ ] `server/data` klasörü için kalıcı disk (volume) ekle — **bu unutulursa her güncellemede bayi verileri silinir**
- [ ] `.env` içindeki değişkenleri Railway paneline elle gir (aşağıda "Ortam Değişkenleri")

### 2. E-posta gönderimi — "Teklif Al" ve bayi mailleri nereye gidecek? (👤 hesap + 🤖 bağlama)
**Şu anda mailler GERÇEKTE GÖNDERİLMİYOR** — sunucu loguna "simülasyon" olarak yazılıyor
(veriler admin panelinde duruyor, hiçbir şey kaybolmuyor ama e-posta düşmüyor).

Sitedeki **tüm** mail çıkışları tek bir sisteme bağlı — hepsi çalışması için **Resend** hesabı gerekli:
| Nereden | Kime gider | İçerik |
|---|---|---|
| Web sitesi "Teklif Al" formu | `info@maxx-global.net` | Ziyaretçinin teklif talebi |
| Bayilik başvurusu | `info@maxx-global.net` | Yeni bayi başvurusu bildirimi |
| Bayi onaylanınca | **bayinin** e-postası | Aktivasyon (parola belirleme) bağlantısı |
| Bayi sipariş verince | `info@maxx-global.net` | Yeni sipariş isteği |
| Admin fiyat verince | **bayinin** e-postası | Fiyat teklifi bildirimi |
| Kargoya verilince | **bayinin** e-postası | Kargo + takip no |

**Yapılacaklar:**
- [ ] 👤 [resend.com](https://resend.com) üzerinden ücretsiz hesap aç (günde 100, ayda 3.000 mail — fazlasıyla yeter)
- [ ] 👤 API anahtarı (`re_...` ile başlar) al → bana ver ya da `.env`'e `RESEND_API_KEY=` olarak ekle
- [ ] 👤 **Alan adı doğrulaması:** Resend panelinde `maxx-global.net` ekle → verdiği SPF/DKIM DNS kayıtlarını
      alan adı yönetim panelinize girin (bayilere mail gidebilmesi için ŞART; sadece kendinize mail bunsuz da gider)
- [ ] 🤖 Doğrulama bitince `MAIL_FROM=Maxx Global <siparis@maxx-global.net>` ayarını ekleyip test maili atarım

> **Alternatif:** Mevcut mail sunucunuz (info@maxx-global.net'in bağlı olduğu hosting) üzerinden SMTP ile de
> gönderebiliriz — bunun için sunucu adresi + parola gerekir ve koda SMTP desteği eklerim. Resend daha kolay.

### 3. Admin parolasını değiştir (👤)
Şu anki geçici parola `.env` dosyasında. Yayından önce güçlü bir parolayla değiştirin.
- [ ] `.env` içinde `ADMIN_PASSWORD=` satırını değiştir (VEYA bana "yeni parola üret" deyin)
- [ ] `SESSION_SECRET=` değerinin rastgele ve gizli olduğundan emin ol (şu an öyle)
- [ ] `.env` dosyasını **kimseyle paylaşmayın**, GitHub'a **yüklemeyin** (zaten `.gitignore`'da)

---

## 🟠 DOMAIN & SEO — Üst sıralarda çıkmak için

> Not: Teknik SEO %100 hazır (Lighthouse 100/100, şemalar, hreflang, sitemap). Aşağıdakiler
> **sitenin dışında** yapılan, sıralamayı fiilen başlatan ve besleyen işler. Bunlar olmadan Google siteyi
> ya geç fark eder ya da otorite veremez.

### 4. Alan adı (domain) ayarları (👤)
- [ ] Site `https://www.maxx-global.net` adresinde yayınlanmalı (kod bu adrese göre yazılı — canonical, sitemap, şema hep bunu gösteriyor)
- [ ] **SSL sertifikası** aktif olmalı (https). Railway/Render otomatik verir; ayrı hosting'de Let's Encrypt kurulmalı
- [ ] `maxx-global.net` → `www.maxx-global.net` yönlendirmesi (301) yapılmalı (`.htaccess` bunu içeriyor; Railway'de ayar olarak eklenir)
- [ ] DNS'te sadece **tek bir doğru IP/CNAME** olmalı (eski WordPress kayıtları temizlenmeli)

### 5. Google Search Console (👤 + 🤖 — yayın günü ilk iş, ÜCRETSIZ, ~15 dk)
**Bu adım olmadan Google siteyi haftalarca fark etmeyebilir.** Sıralamayı başlatan asıl tetikleyici budur.
- [ ] [search.google.com/search-console](https://search.google.com/search-console) → `maxx-global.net` ekle
- [ ] Alan adı doğrulaması yap (DNS TXT kaydı ile — mail doğrulamasıyla aynı panelden)
- [ ] `https://www.maxx-global.net/sitemap.xml` adresini "Site Haritaları" bölümüne gönder
- [ ] "URL Denetimi" ile ana sayfa + birkaç ürün sayfası için elle "İndekslenmeyi İste"
- [ ] 1-2 hafta sonra "Performans" sekmesinden hangi kelimelerde çıktığınızı izlemeye başla

### 6. Google Business Profile (👤 — ücretsiz, marka için çok değerli)
- [ ] "Maxx Global Medikal" işletme profili aç, kategori: **Tıbbi Cihaz Üreticisi**
- [ ] Adres (İvedik OSB 1333. Cadde No: 22), telefon, web sitesi, çalışma saatleri gir
- [ ] Bu, "Maxx Global" aramalarında sağ tarafta marka paneli çıkmasını sağlar + AI motorları bunu okur

### 7. Katalog PDF (👤 dosya + 🤖 bağlama)
Elimizdeki `Maxx-Arthroscopy-Catalog.pdf` sitede yayınlanmıyor (siz öyle istediniz), ama verileri işlendi.
- [ ] Karar: Katalog PDF'i indirilebilir olsun mu? Olursa "E-Katalog" menüsüne ekleriz + SEO'da `subjectOf` sinyali olur
- [ ] Eski sitedeki katalog linki kırıktı; yeni PDF menüye eklenecekse bana söyleyin

### 8. Dış bağlantılar / marka sinyalleri (👤 — sıralamanın EN büyük faktörü, zamana yayılır)
Google sıralamasında en belirleyici şey başka sitelerin size link vermesi. Öncelik sırasıyla:
- [ ] **LinkedIn şirket sayfası** aç, web sitesi alanına domaini ekle
- [ ] **Bayi siteleri:** her bayiden "Yetkili Maxx Global Bayisi" + site linki (bayi sözleşmesine madde eklenebilir — en değerli backlink kaynağı)
- [ ] Medikal dizinler: MedicalExpo, sektör dernekleri, ihracatçı birlikleri üye listeleri, ÜTS/TİTUBB kamu kaydı
- [ ] (İleride) YouTube ürün tanıtım videoları, basın bültenleri

---

## 🟡 İÇERİK & TAMAMLAMA

### 9. Test verilerini temizle (🤖 — yayından hemen önce)
Şu an sistemde benim test ederken oluşturduğum sahte kayıtlar var:
- [ ] "Demo Medikal Ltd.", "Test Medikal Ltd", "ezgi" bayileri
- [ ] MG-2026-xxxx numaralı test siparişleri
- [ ] Test için girdiğim örnek fiyatlar (Fiyat Güncelleme sayfasında)
> "Temizle" deyin, tek komutla `server/data/store.json` sıfırlanır (yalnız admin hesabı kalır).

### 10. Kataloğdan çıkarılamayan 3 ürünün teknik tablosu (👤 görsel + 🤖)
Şu 3 üründe teknik tablo eksik (kataloğun o sayfaları görsel ağırlıklıydı, metin okunamadı):
- [ ] Ligament Staple Titanium
- [ ] Helix Titanium TI Screw
- [ ] TI-BUTTON CL System Continuous Loop
> Bu sayfaların katalog görüntüsünü/verilerini verirseniz tabloları doldururum. VEYA patron admin panelinden kendi girer.

### 11. Katalogda olup sitede olmayan ürünler (👤 karar + 🤖)
Katalogda şunlar var ama sitede yok: ViFix I/II Meniscal, WaterWay Kanül, Shaver Blade & Burr,
Rock Mosaicplasty, Microfracture Pin, Nitinol Guide Wire, Passing Pin, Suture Passer...
- [ ] Karar: Bunlar için "Artroskopik El Aletleri & Aksesuarlar" kategorisi eklensin mi?
      (Ürün yelpazesi tam görünür + SEO yüzeyi genişler; görselleri sizden almam gerekir)

### 12. İçerik kontrolü (👤)
- [ ] Tüm ürün açıklamaları, teknik tablolar ve SSS'ler patron tarafından gözden geçirilsin (admin panelden düzenlenebilir)
- [ ] İletişim bilgileri doğru mu? (telefon +90 312 911 00 11, adres, e-posta)
- [ ] Google Maps konumu doğru mu? (footer'daki harita linki)

---

## 🟢 YAYIN SONRASI (ilk ay)

### 13. İzleme ve bakım
- [ ] Search Console'da index durumu (74 sayfa görünmeli), hata raporları, Core Web Vitals
- [ ] [pagespeed.web.dev](https://pagespeed.web.dev) ile canlı hız testi (90+ beklenir)
- [ ] [Rich Results Test](https://search.google.com/test/rich-results) ile 1 ürün sayfası (Product + FAQ + Breadcrumb şeması geçmeli)
- [ ] Bayi portalı gerçek kullanıcılarla test edilsin (ilk gerçek bayi eklenince akış baştan sona izlensin)
- [ ] `server/data` yedeği: kalıcı diskin düzenli yedeklendiğinden emin ol

### 14. SEO Faz 2-3 (🤖 — hazır bekliyor, onay verince)
`SEO-PLAN.md` dosyasında detaylı plan var:
- [ ] 7 kategori/silo sayfası (Sütür Ankorları, Süspansiyon Sistemleri, Sindezmoz Onarımı...)
- [ ] Ürün adı katalog kodlarına (mpn) gerçek değerler — patrondan tam liste gelince
- [ ] Aylık teknik içerik/blog (kategori sayfalarını besler, uzun vadeli otorite)

---

## 📋 Ortam Değişkenleri (`.env` — Railway paneline girilecek)

```
SESSION_SECRET=<rastgele-uzun-gizli-dizi>     (oturum güvenliği — hazır)
ADMIN_EMAIL=info@maxx-global.net              (admin giriş e-postası)
ADMIN_PASSWORD=<güçlü-parola>                 (👤 DEĞİŞTİRİN)
ORDER_EMAIL=info@maxx-global.net              (bildirimler buraya gelir)
RESEND_API_KEY=re_xxxxxxxx                    (👤 resend.com'dan — mailler için ŞART)
MAIL_FROM=Maxx Global <siparis@maxx-global.net>  (👤 domain doğrulanınca)
NODE_ENV=production                           (Railway'de otomatik)
```

---

## Özet: Yayına çıkmak için minimum 3 adım
1. **Railway'e deploy** + kalıcı disk (👤 hesap açar, 🤖 kurar) → site canlı
2. **Resend'e bağla** (👤 hesap + DNS, 🤖 kod) → mailler çalışır
3. **Search Console + sitemap** (👤+🤖, yayın günü) → Google indekslemeye başlar

Gerisi (backlink, business profile, içerik) sıralamayı **zamanla güçlendiren** işlerdir — yayın için şart değil ama üst sıralar için gereklidir.
