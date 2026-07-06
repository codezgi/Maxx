# Maxx Global Medikal — Ürün Bazlı SEO, AI Görünürlüğü ve Yapılandırılmış Veri Çalışma Planı

Hedef: **maxx-global.net**'in ürün adı, kategori ve teknik aramalarında Google, Google Görseller/Lens ve
yapay zekâ cevap motorlarında (ChatGPT, Gemini, Perplexity, Claude) güçlü görünmesi.
Mevcut teknik taban sağlam (Lighthouse 100/100, hreflang, JSON-LD, sitemap) — bu plan onun üzerine kurulur.

---

## 1. Genel Strateji

**Üç kanal, üç farklı sinyal:**

| Kanal | Ne arar? | Bizim vereceğimiz sinyal |
|---|---|---|
| Google Arama | Sorgu–sayfa eşleşmesi + otorite | Ürün adı + kategori başlıkta; kategori (silo) sayfaları; iç link ağı |
| Google Görseller/Lens | Benzersiz, adlandırılmış görsel | Dosya adı = ürün slug'ı (mevcut ✓), zengin `alt`, `image` schema, büyük önizleme izni (mevcut ✓) |
| AI cevap motorları | **Açık varlık (entity) cümleleri** | "X, Maxx Global Medikal tarafından Türkiye'de üretilen bir Y'dir" kalıbı; tutarlı marka adı; schema'da `manufacturer` |

**Varlık ilişkisi kurma kuralı:** Her ürün sayfasında en az bir yerde şu üçlü açıkça geçmeli:
`[Ürün adı] + [kategori terimi] + [Maxx Global Medikal üretir]`.
Örnek entity cümleleri (ürün açıklamalarına dokunmadan sayfaya ayrı "özet kutusu" olarak eklenebilir):

- TR: **"Helix TI Screw Anchor, Maxx Global Medikal tarafından Ankara'da üretilen titanyum bir sütür ankorudur (suture anchor)."**
- EN: **"Helix TI Screw Anchor is a titanium suture anchor manufactured by Maxx Global Medical in Türkiye."**

Aynı kalıp `Organization` schema'daki `knowsAbout` ve ürün schema'sındaki `manufacturer` ile örtüşünce
AI sistemleri marka–ürün ilişkisini güvenle kurar.

---

## 2. Ürün Sayfası İçerik Şablonu (ideal yapı)

```
H1: {Ürün Adı}                              ← tek H1 (mevcut ✓)
Kısa giriş (1-2 cümle, entity cümlesi)      ← YENİ: "özet kutusu"
Ürün özeti (mevcut açıklama — DOKUNULMAZ)
H2: Kullanım Alanları                       ← liste (3-5 madde)
H2: Malzeme ve Teknik Özellikler            ← tablo: malzeme, ölçü, sterilizasyon, ambalaj
H2: Avantajlar                              ← liste
H2: Varyantlar                              ← varsa (3.5mm/5mm, Titanium/PEEK) tablo + kardeş ürün linki
H2: İlgili Ürünler                          ← mevcut ✓ (3 kart)
H2: Sık Sorulan Sorular                     ← 4-6 soru + FAQPage schema
CTA: Teklif Al                              ← mevcut ✓
```

**Meta formülleri:**
- Title: `{Ürün Adı} | {Kategori} | Maxx Global Medikal` (≤65 karakter, mevcut ✓)
- Description: `{Ürün adı}: {tek cümle işlev}. {Malzeme}. Maxx Global Medikal üretimi, ISO 13485. Teklif alın.` (140-155 kr)
- Görsel alt: `{Ürün adı} — {kategori} ({malzeme}), Maxx Global Medikal` — "ürün görseli" gibi boş ifadeler yerine.

---

## 3. Ürün Bazlı Anahtar Kelime Haritası

Kısaltmalar: P=primary, S=secondary, L=long-tail. Her satırda TR / EN birlikte.

| # | Ürün | P (TR / EN) | S | L (örnek) | Kategori bağı |
|---|---|---|---|---|---|
| 1 | Titanium Peek Knotless Pushlock | düğümsüz ankor / knotless anchor | pushlock ankor, PEEK ankor; knotless suture anchor | "rotator manşet için düğümsüz ankor", "knotless pushlock anchor manufacturer" | Sütür Ankorları |
| 2 | TI-BUTTON CL System Continuous Loop | sabit loop endobutton / fixed loop button | ACL düğmesi, kortikal düğme; ACL fixation button | "ön çapraz bağ ameliyatı endobutton", "continuous loop ACL button supplier" | Süspansiyon Sist. |
| 3 | TI-BUTTON Without Loop | loopsuz titanyum düğme / titanium button no loop | kortikal fiksasyon düğmesi; cortical button | "loopsuz endobutton fiyat", "titanium cortical button orthopedic" | Süspansiyon Sist. |
| 4 | Surgical Suture Energybraid | örgü cerrahi sütür / braided surgical suture | yüksek mukavemetli iplik; high-strength suture | "artroskopi cerrahi ipliği üretici", "UHMWPE braided suture manufacturer" | Cerrahi Sütürler |
| 5 | Sensitiva Soft Anchor All Suture | all-suture ankor / all-suture anchor | yumuşak ankor; soft anchor | "kemik koruyucu all suture anchor", "soft all-suture anchor Türkiye" | Sütür Ankorları |
| 6 | Remissas Tightloop Syndesmosis Mini | sindezmoz mini implant / syndesmosis mini | ayak bileği fiksasyonu; ankle tightrope | "sindezmoz yaralanması mini implant" | Sindezmoz Onarımı |
| 7 | Remissas Tightloop Syndesmosis Repair | sindezmoz onarım sistemi / syndesmosis repair system | tightloop; suture button ankle | "sindezmoz cerrahisi implant üretici", "syndesmosis repair device manufacturer" | Sindezmoz Onarımı |
| 8 | Remissas Hanger Adjustable Button | ayarlanabilir loop düğme / adjustable loop button | ACL ayarlanabilir düğme; adjustable suspension | "ayarlanabilir endobutton ACL", "adjustable loop cortical button" | Süspansiyon Sist. |
| 9 | Ligament Staple Titanium | ligament zımbası / ligament staple | bağ stapleri, titanyum staple; fixation staple | "diz bağ cerrahisi zımba implant", "titanium ligament staple orthopedic" | Doku Fiksasyonu |
| 10 | Helix TI Screw Anchor | vida ankor / screw anchor | titanyum sütür ankoru; titanium suture anchor | "omuz artroskopisi vida ankor", "helical titanium suture anchor" | Sütür Ankorları |
| 11 | Helix Titanium TI Screw | titanyum interferans vidası / titanium screw | ortopedik vida; orthopedic titanium screw | "artroskopi titanyum vida üretici" | Titanyum İmplantlar |
| 12 | Helix TI Screw Anchor 5mm Titanium | 5mm titanyum ankor / 5mm titanium anchor | 5 mm sütür ankoru | "5mm titanyum vida ankor fiyat" | Sütür Ankorları |
| 13 | Helix TI Screw Anchor 3.5mm Titanium | 3.5mm titanyum ankor / 3.5mm titanium anchor | küçük eklem ankoru | "3.5 mm suture anchor small joint" | Sütür Ankorları |
| 14 | Helix TI Screw Anchor 3.5mm Peek | 3.5mm PEEK ankor / 3.5mm PEEK anchor | radyolusen ankor; radiolucent anchor | "PEEK ankor MR uyumlu", "3.5mm PEEK suture anchor" | Sütür Ankorları |
| 15 | Helix Peek Screw Anchor SWLOCK | SWLOCK PEEK ankor / SWLOCK PEEK anchor | kilitli PEEK ankor | "swlock mekanizmalı ankor" | Sütür Ankorları |
| 16 | Anchor With Needles | iğneli ankor / anchor with needles | iğneli sütür ankoru; needled suture anchor | "iğneli hazır yüklü ankor sistemi" | Sütür Ankorları |
| 17 | AC Double Implant Oval | AC eklem implantı / AC joint implant | akromiyoklaviküler düğme; AC dogbone button | "AC eklem çıkığı çift implant", "acromioclavicular double button implant" | Süspansiyon Sist. |

**AI arama cümleleri** (her ürün sayfası özet kutusuna, doğal dille):
"{Ürün}, {kategori} kategorisinde, {malzeme}den, Maxx Global Medikal tarafından ISO 13485 koşullarında üretilir.
Diz ve omuz artroskopisi başta olmak üzere spor cerrahisi uygulamaları için tasarlanmıştır." (+EN karşılığı)

---

## 4. Product Schema Geliştirme

Mevcut: name, sku, image, description, category, brand, manufacturer, countryOfOrigin, url ✓.
Eklenmesi önerilenler:

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Helix TI Screw Anchor 5mm Titanium",
  "alternateName": ["Helix 5mm Titanyum Vida Ankor", "5mm Titanium Suture Anchor"],
  "sku": "helix-ti-screw-anchor-5mm-titanium",
  "mpn": "MG-HLX-TI-50",                       // gerçek katalog kodlarınızla doldurun
  "material": "Titanium (Ti6Al4V)",             // ürün başına: Titanium / PEEK / UHMWPE
  "brand": { "@type": "Brand", "name": "Maxx Global" },
  "manufacturer": { "@id": "https://www.maxx-global.net/#organization" },
  "countryOfOrigin": "TR",
  "category": "Suture Anchors > Arthroscopy Products",
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Çap / Diameter", "value": "5 mm" },
    { "@type": "PropertyValue", "name": "Sterilizasyon", "value": "EO / Steril ambalaj" }
  ],
  "isRelatedTo": [{ "@type": "Product", "url": ".../helix-ti-screw-anchor-3-5mm-titanium/" }],
  "subjectOf": { "@type": "DigitalDocument", "name": "Maxx Arthroscopy Catalog", "url": ".../assets/maxx-arthroscopy-catalog.pdf" }
}
```

**Offer sorusu:** B2B tekliflendirmede fiyat yayınlanmıyorsa `offers` **eklemeyin** — sahte "0 TL" veya
InStock uydurmak Merchant uyarısı ve güven kaybı yaratır. Doğru alternatif: sayfadaki "Teklif Al" CTA'sı +
`potentialAction` yerine ContactPage bağlantısı. İleride bayilere açık fiyat olursa `offers` yalnızca
giriş korumalı portalda kalmalı (Google görmez, sorun değil).

---

## 5. Kategori (Silo) Sayfaları — EN ÖNEMLİ YENİ İŞ

Google "suture anchor manufacturer" gibi kategori aramalarını tek ürüne değil kategori sayfasına bağlar.
Önerilen 7 sayfa (TR/EN URL, H1, bağlanacak ürünler):

| Kategori | TR URL | EN URL | Bağlanan ürünler |
|---|---|---|---|
| Artroskopi Ürünleri | `/artroskopi-urunleri/`* | `/en/arthroscopy-products/`* | tümü (mevcut /urunler yeniden konumlanabilir) |
| Sütür Ankorları | `/sutur-ankorlari/` | `/en/suture-anchors/` | 1, 5, 10, 12, 13, 14, 15, 16 |
| Süspansiyon / Endobutton | `/endobutton-sistemleri/` | `/en/suspension-fixation-buttons/` | 2, 3, 8, 17 |
| Sindezmoz Onarımı | `/sindezmoz-onarim/` | `/en/syndesmosis-repair/` | 6, 7 |
| Cerrahi Sütürler | `/cerrahi-suturler/` | `/en/surgical-sutures/` | 4 |
| Titanyum İmplantlar | `/titanyum-implantlar/` | `/en/titanium-implants/` | 9, 10, 11, 12, 13 |
| Yumuşak Doku Fiksasyonu | `/yumusak-doku-fiksasyonu/` | `/en/soft-tissue-fixation/` | 1, 5, 9, 16 |

Şablon: H1 (kategori adı) → 150-250 kelime giriş (entity cümlesi + kategori tanımı) → ürün kartları →
kategoriye özgü 3 SSS → CTA. Title: `{Kategori} | Üretici Maxx Global Medikal`.
İç link kuralı: her ürün sayfası kendi kategorisine breadcrumb ile; kategoriler ana menüde "Ürünler" altına açılır menü.

---

## 6. AI Search / LLM Görünürlüğü

1. **Özet bilgi bloğu** — her ürün sayfasının başına 2-3 cümlelik, gerçeklere dayalı "hızlı bilgi" kutusu
   (madde: kategori, malzeme, üretici, kullanım alanı). AI sistemleri bu yapıdaki blokları alıntılamayı sever.
2. **Doğal tekrar** — "Maxx Global Medikal" tam adı her ürün sayfasında 2-3 kez (giriş, üretici satırı, CTA)
   geçmeli; "firmamız/şirketimiz" gibi anonim ifadeler yerine marka adı.
3. **İlişki kurulacak sayfalar** — Ana sayfa (marka+tüm kategoriler), kategori sayfaları (kategori+ürünler+üretici),
   ürün sayfaları (ürün+kategori+üretici), Hakkımızda (üretici+yetkinlik: CNC, ISO 13485).
4. **PDF katalog** — Katalog PDF'i kendi domain'inize koyun (`/assets/maxx-arthroscopy-catalog.pdf`),
   ürün sayfalarından `subjectOf` ile bağlayın; PDF başlık/metadata'sında marka+kategori geçsin.
   (Eski katalog linki kırıktı — yeni PDF hazır olunca ekleyelim.)
5. **Dış sinyal** — bkz. Bölüm 8; AI motorları LinkedIn ve dizin kayıtlarını marka doğrulaması olarak kullanır.

---

## 7. SSS Çerçevesi (FAQPage schema ile)

Her ürün için 4 soru tipi (cevaplar ürün başına 1-2 cümle özelleştirilir; medikal iddia YOK):

| Soru şablonu (TR / EN) | Güvenli cevap kalıbı |
|---|---|
| "{Ürün} hangi malzemeden üretilir?" / "What material is {product} made of?" | "{Malzeme}den, biyouyumluluk gözetilerek üretilir. Ayrıntılı teknik döküman talep üzerine paylaşılır." |
| "{Ürün} hangi uygulamalarda kullanılır?" / "What is {product} used for?" | "{Kategori} uygulamaları için tasarlanmıştır. **Kullanım kararı ve endikasyon değerlendirmesi sağlık profesyonellerine aittir.**" |
| "{Ürün} steril mi teslim edilir?" / "Is {product} delivered sterile?" | "Ambalaj ve sterilizasyon bilgisi ürün etiketinde belirtilir; sipariş öncesi ekibimiz bilgilendirir." |
| "{Ürün} için nasıl teklif alırım?" / "How can I get a quote for {product}?" | "Teklif Al sayfasından veya info@maxx-global.net üzerinden 24 saat içinde dönüş yapılır." |
| +Varyantlı ürünlerde: "3.5mm ve 5mm arasındaki fark nedir?" | Ölçü/malzeme farkı nesnel olarak. |
| +PEEK ürünlerde: "PEEK ankor görüntülemede artefakt yapar mı?" | "PEEK radyolusendir; görüntüleme kararı hekime aittir." |

JSON-LD: her ürün sayfasına `FAQPage` bloğu (Question/acceptedAnswer). Not: FAQ zengin sonucu artık çoğunlukla
resmî kurum sitelerinde gösteriliyor; yine de AI motorları için değerli — eklemeye değer.

---

## 8. Dış Otorite ve Marka Sinyalleri (öncelik sırasıyla)

1. **Google Business Profile** — "Maxx Global Medikal", İvedik OSB adresi, kategori: Tıbbi Cihaz Üreticisi. Ücretsiz, 30 dk.
2. **LinkedIn şirket sayfası** — website alanına domain; ürün lansmanlarını buradan duyurun (AI motorları LinkedIn'i okur).
3. **Bayi siteleri** — her bayiden "Yetkili Maxx Global Bayisi" rozeti + link (bayi sözleşmesine madde olarak eklenebilir). En değerli backlink kaynağınız.
4. **Medikal dizinler** — MedicalExpo, Medica/Arab Health katılımcı profilleri, TİTUBB/ÜTS kamu kayıtları, ihracatçı birlikleri üye listeleri.
5. **PDF katalog + YouTube** — ürün tanıtım videoları (30-60 sn, ürün adı başlıkta); video schema ile ürün sayfasına gömülebilir.
6. **Basın bülteni** — yeni ürün/ihracat haberleri sektör portallarına (backlink + haber sinyali).

---

## 9. Teknik SEO Kontrol Listesi

**Yayın günü:** Search Console'a domain doğrulama → sitemap.xml gönder → "URL Denetimi" ile ana sayfa+2 ürün için indeksleme iste → robots.txt/SSL/www yönlendirmesi canlıda doğrula → Rich Results Test ile 1 ürün sayfası (Product+Breadcrumb geçmeli) → PageSpeed (mobil ≥90 beklenir).
**İlk ay, haftalık:** Index coverage (74 sayfa hedef), Core Web Vitals raporu, ürün schema hataları, görsel indekslenmesi (Görseller sekmesinde site:maxx-global.net), 404 raporu, hreflang hataları.
**Sürekli:** Search Console "Performans"ta hangi ürün hangi kelimede çıkıyor → düşük CTR'li title'ları revize.

---

## 10. Uygulama Öncelikleri

**Faz 1 (yayın haftası — teknik, 1-2 gün):**
Search Console + sitemap; Google Business Profile; LinkedIn sayfası; ürün schema'ya `material`/`alternateName`/`additionalProperty` (build script'te 30 dk); görsel alt metinlerini formüle uydurma.

**Faz 2 (2-4. hafta — içerik):**
7 kategori sayfası (TR+EN); her ürüne özet bilgi kutusu + SSS bölümü (FAQPage schema); varyant tabloları (Helix ailesi birbirine `isRelatedTo`); yeni PDF kataloğu yükleyip bağlama.

**Faz 3 (2. ay+ — otorite):**
Bayi rozet/link programı; dizin kayıtları; YouTube ürün videoları; ayda 1 teknik içerik (ör. "Sütür ankoru seçiminde malzeme farkları") — kategori sayfalarını besler; Search Console verisine göre title/description iterasyonu.

---

*Notlar: (1) Hiçbir sıralama garantisi verilemez; bu plan ölçülebilir en güçlü sinyalleri kurar. Ürün adı aramalarında (ör. "Remissas Tightloop") ilk sayfa kısa vadede gerçekçidir; jenerik kategorilerde ("suture anchor") uluslararası devlerle rekabet uzun vadelidir ve Faz 3'e bağlıdır. (2) Tüm içerikler medikal iddia içermez; endikasyon/kullanım kararları sağlık profesyoneline bırakılır. (3) Bu dosyadaki şablonlar build script'ine entegre edilmeye hazırdır — onay verdiğinizde Faz 1 şema zenginleştirmesini hemen uygularım.*
