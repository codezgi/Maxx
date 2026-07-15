# Maxx Global Medikal — Statik Web Sitesi (TR + EN) 
www.maxx-global.net için elle kodlanmış, hızlı ve SEO uyumlu statik site.
WordPress/framework yok; saf HTML + tek CSS dosyası + tek küçük JS dosyası.
76 sayfa: 38 Türkçe + 38 İngilizce (hreflang etiketleriyle bağlı).

## Klasör Yapısı 
 
```
index.html              → Türkçe ana sayfa
hakkimizda/ vb.         → Türkçe sayfalar (tüm sayfalar klasör içinde index.html)
<urun-adi>/             → 17 TR ürün detayı (ör. anchor-with-needles/)
en/                     → İngilizce sayfalar (/en/about-us/, /en/products/ ...)
<urun-adi>-en/          → 17 EN ürün detayı (ör. anchor-with-needles-en/)
tesekkurler/, en/thank-you/ → Form sonrası sayfalar (arama motorlarına kapalı)
assets/css/style.css    → Sitenin tüm tasarımı (tek dosya)
assets/js/main.js       → Mobil menü + animasyonlar + slider (kütüphanesiz)
assets/img/             → WebP'ye çevrilmiş, optimize görseller
assets/video/           → Ana sayfa hero videosu (maxx-hero.mp4)
assets/fonts/           → Rethink Sans (kendi sunucudan, Google'a istek yok)
form-handler.php        → Teklif formunu e-postaya ileten betik (TR/EN yönlendirmeli)
sitemap.xml, robots.txt → SEO dosyaları (her URL'de TR/EN hreflang alternatifi)
```

## Yerelde Önizleme

Sayfalar kök dizine göre bağlantı kullandığı için (`/assets/...`) dosyaya çift
tıklayarak değil, küçük bir sunucuyla açın:

```bash
cd "MAXX GLOBAL"
python3 -m http.server 8000
# tarayıcıda: http://localhost:8000
```

## Yayınlama

Klasörün tüm içeriğini hosting'in kök dizinine (genelde `public_html/`) yükleyin.
URL yapısı mevcut siteyle birebir aynıdır (`/hakkimizda/`, `/urunler/` vb.),
bu yüzden Google sıralamaları için yönlendirme gerekmez.

- **Form:** `form-handler.php`, PHP destekli her hosting'de çalışır ve talebi
  `info@maxx-global.net` adresine gönderir. PHP yoksa `teklif-al/index.html`
  içindeki `action="/form-handler.php"` satırını Formspree/Getform gibi bir
  servis adresiyle değiştirin.
- **E-Katalog:** Eski sitedeki katalog PDF bağlantısı kırık olduğu için menüye
  eklenmedi. PDF elinize geçince `assets/` içine koyup menüye ekleyebilirsiniz.
- **İngilizce (EN):** Tüm sayfaların İngilizce sürümü `en/` altında hazırdır;
  başlıktaki EN/TR bağlantıları her sayfayı kendi karşılığına götürür.

## SEO Notları

Her sayfada: özgün `<title>` + açıklama, canonical adres, Open Graph/Twitter
etiketleri, schema.org yapılandırılmış verisi (Organization, Product,
BreadcrumbList), tek `<h1>`, ölçüleri belirtilmiş lazy-load görseller.
`sitemap.xml`'i Google Search Console'a göndermeyi unutmayın.
