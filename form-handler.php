<?php
/**
 * Teklif Al formu işleyicisi.
 * PHP destekli her paylaşımlı hosting'de çalışır (mail() fonksiyonu açık olmalı).
 * Alternatif: Formspree/Getform gibi bir servis kullanacaksanız
 * teklif-al/index.html içindeki form "action" adresini değiştirmeniz yeterli.
 */

$form_sayfasi = (($_POST['lang'] ?? 'tr') === 'en') ? '/en/get-quote/' : '/teklif-al/';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: /teklif-al/');
    exit;
}

$tesekkur = (($_POST['lang'] ?? 'tr') === 'en') ? '/en/thank-you/' : '/tesekkurler/';

// Honeypot: botlar bu gizli alanı doldurur, insanlar boş bırakır.
if (!empty($_POST['web_site'])) {
    header('Location: ' . $tesekkur);
    exit;
}

function temizle(string $deger, int $limit = 500): string
{
    $deger = trim($deger);
    // Başlık enjeksiyonunu engelle
    $deger = str_replace(["\r", "\n", "%0a", "%0d"], ' ', $deger);
    return mb_substr($deger, 0, $limit);
}

$ad      = temizle($_POST['ad_soyad'] ?? '', 120);
$firma   = temizle($_POST['firma'] ?? '', 120);
$eposta  = temizle($_POST['eposta'] ?? '', 190);
$telefon = temizle($_POST['telefon'] ?? '', 40);
$urun    = temizle($_POST['urun'] ?? '', 120);
$mesaj   = mb_substr(trim($_POST['mesaj'] ?? ''), 0, 3000);

if ($ad === '' || $telefon === '' || $urun === '' || !filter_var($eposta, FILTER_VALIDATE_EMAIL)) {
    header('Location: ' . $form_sayfasi);
    exit;
}

$alici  = 'info@maxx-global.net';
$konu   = '=?UTF-8?B?' . base64_encode('Web Sitesi Teklif Talebi: ' . $urun) . '?=';
$govde  = "Ad Soyad : $ad\n"
        . "Firma    : $firma\n"
        . "E-posta  : $eposta\n"
        . "Telefon  : $telefon\n"
        . "Ürün     : $urun\n\n"
        . "Mesaj:\n$mesaj\n";

$basliklar = "From: Maxx Global Web <no-reply@maxx-global.net>\r\n"
           . "Reply-To: $eposta\r\n"
           . "Content-Type: text/plain; charset=UTF-8\r\n";

@mail($alici, $konu, $govde, $basliklar);

header('Location: ' . $tesekkur);
exit;
