<?php
/**
 * Comic-Planer – Cover: automatische Suche (Google Books, Open Library) und eigene Bilder
 * Copyright (C) 2026 Kai Kranz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Ablage:  data/covers/isbn/<ISBN>.jpg       automatisch gefunden – für alle Nutzer gemeinsam (öffentliche Buchcover)
 *          data/covers/u-<hmac>/<ID>.jpg      eigene Bilder – pro Nutzer, Ordnername nicht erratbar
 * Google Books liefert nur mit eigenem API-Schlüssel (Einstellung „gbooks_key“), anonym ist das Kontingent 0.
 * Ausgeliefert wird nur über cover.php (mit Anmeldung); data/ ist per .htaccess gesperrt.
 */
declare(strict_types=1);

const COVER_MAX_W = 500;          // Bilder werden auf diese Breite verkleinert und als JPEG gespeichert
const COVER_MAX_BYTES = 6_000_000;

function cover_root(): string { return APP_ROOT . '/data/covers'; }
function cover_secret(): string {
    $s = setting('secret', '');
    if ($s === '' || $s === null) { $s = bin2hex(random_bytes(24)); set_setting('secret', $s); }
    return $s;
}
function cover_user_dir(int $uid): string { return cover_root() . '/u-' . substr(hash_hmac('sha256', 'cover:' . $uid, cover_secret()), 0, 24); }
function cover_shared_path(string $isbn): string { return cover_root() . '/isbn/' . $isbn . '.jpg'; }
function cover_manual_path(int $uid, string $key): string { return cover_user_dir($uid) . '/' . $key . '.jpg'; }

/** Pfad der Bilddatei für einen Eintrag – oder null */
function cover_file(int $uid, string $key, string $state): ?string {
    if ($state === 'manual') { $p = cover_manual_path($uid, $key); return is_file($p) ? $p : null; }
    if ($state === 'auto' && preg_match('/^\d{13}$/', $key)) { $p = cover_shared_path($key); return is_file($p) ? $p : null; }
    return null;
}

function cover_ensure_dirs(?int $uid = null): bool {
    $root = cover_root();
    foreach ([dirname($root), $root, $root . '/isbn'] as $d) if (!is_dir($d) && !@mkdir($d, 0755, true) && !is_dir($d)) return false;
    $ht = dirname($root) . '/.htaccess';
    if (!is_file($ht)) @file_put_contents($ht, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    if (!is_file(dirname($root) . '/index.php')) @file_put_contents(dirname($root) . '/index.php', "<?php http_response_code(403);\n");
    if ($uid !== null) { $u = cover_user_dir($uid); if (!is_dir($u) && !@mkdir($u, 0755, true) && !is_dir($u)) return false; }
    return is_writable($root);
}

/** Bild prüfen, verkleinern, Metadaten entfernen → JPEG-Bytes (oder null, wenn kein brauchbares Bild) */
function cover_normalize(string $bytes): ?string {
    if ($bytes === '' || strlen($bytes) > COVER_MAX_BYTES) return null;
    $info = @getimagesizefromstring($bytes);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) return null;
    [$w, $h] = $info;
    if ($w < 40 || $h < 40 || $w > 12000 || $h > 12000) return null;   // Platzhalter-Pixel o. ä.
    if (!function_exists('imagecreatefromstring')) {
        return $info[2] === IMAGETYPE_JPEG && strlen($bytes) <= 1_500_000 ? $bytes : null;   // ohne GD nur kleine JPEGs übernehmen
    }
    $src = @imagecreatefromstring($bytes);
    if (!$src) return null;
    $nw = min(COVER_MAX_W, $w); $nh = (int)round($h * $nw / $w);
    $dst = imagecreatetruecolor($nw, $nh);
    imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));   // Transparenz → weiß
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    ob_start(); imagejpeg($dst, null, 84); $out = (string)ob_get_clean();
    imagedestroy($src); imagedestroy($dst);
    return $out !== '' ? $out : null;
}

/** HTTP GET: [Statuscode, Inhalt]; Code 0 = keine Verbindung */
function cover_http(string $url, int $timeout = 8): array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_USERAGENT => 'Comic-Planer/' . APP_VERSION . ' (+' . APP_SOURCE_URL . ')']);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return [$body === false ? 0 : $code, $body === false ? '' : (string)$body];
    }
    if (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'ignore_errors' => true, 'header' => 'User-Agent: Comic-Planer/' . APP_VERSION . "\r\n"]]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) return [0, ''];
        $code = 200;
        foreach ($http_response_header ?? [] as $hline) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $hline, $m)) $code = (int)$m[1];
        return [$code, (string)$body];
    }
    return [0, ''];
}

/**
 * Cover für eine ISBN suchen und gemeinsam ablegen.
 * Rückgabe: 'auto' (gefunden), 'none' (nirgends vorhanden) oder 'error' (Dienste nicht erreichbar – später erneut versuchen)
 */
function cover_lookup(string $isbn): string {
    if (!preg_match('/^\d{13}$/', $isbn)) return 'none';
    if (is_file(cover_shared_path($isbn))) return 'auto';
    $reachable = false; $quota = false;
    // 1) Google Books – nur mit API-Schlüssel
    $key = (string)setting('gbooks_key', '');
    [$code, $body] = $key !== ''
        ? cover_http('https://www.googleapis.com/books/v1/volumes?q=isbn:' . $isbn . '&maxResults=1&fields=items(volumeInfo/imageLinks)&key=' . rawurlencode($key))
        : [-1, ''];
    if ($code > 0) $reachable = true;
    if ($code === 429 || $code === 403) $quota = true;   // Kontingent erschöpft oder Schlüssel gesperrt → später erneut
    if ($code === 200) {
        $j = json_decode($body, true);
        $links = $j['items'][0]['volumeInfo']['imageLinks'] ?? [];
        $url = $links['thumbnail'] ?? ($links['smallThumbnail'] ?? '');
        if ($url) {
            $url = preg_replace('#^http://#', 'https://', $url);
            $url = str_replace('&edge=curl', '', $url);
            [$c2, $img] = cover_http($url);
            if ($c2 === 200 && ($jpg = cover_normalize($img)) !== null && cover_save_shared($isbn, $jpg)) return 'auto';
        }
    }
    // 2) Open Library (liefert 404, wenn es kein Cover gibt)
    [$code, $img] = cover_http('https://covers.openlibrary.org/b/isbn/' . $isbn . '-L.jpg?default=false');
    if ($code > 0) $reachable = true;
    if ($code === 200 && ($jpg = cover_normalize($img)) !== null && cover_save_shared($isbn, $jpg)) return 'auto';
    if ($quota) return 'error';
    return $reachable ? 'none' : 'error';
}
/** API-Schlüssel prüfen: '' = in Ordnung, sonst Fehlermeldung */
function cover_check_key(string $key): string {
    [$code, $body] = cover_http('https://www.googleapis.com/books/v1/volumes?q=isbn:9783551021373&maxResults=1&fields=totalItems&key=' . rawurlencode($key));
    if ($code === 200) return '';
    if ($code === 0) return 'Google ist vom Webspace aus nicht erreichbar.';
    $j = json_decode($body, true);
    $msg = (string)($j['error']['message'] ?? ('HTTP ' . $code));
    return 'Google meldet: ' . mb_substr($msg, 0, 200);
}
function cover_save_shared(string $isbn, string $jpg): bool {
    if (!cover_ensure_dirs()) return false;
    $p = cover_shared_path($isbn); $tmp = $p . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $jpg, LOCK_EX) === false) return false;
    return @rename($tmp, $p);
}
function cover_save_manual(int $uid, string $key, string $jpg): bool {
    if (!cover_ensure_dirs($uid)) return false;
    $p = cover_manual_path($uid, $key); $tmp = $p . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $jpg, LOCK_EX) === false) return false;
    return @rename($tmp, $p);
}
function cover_delete_manual(int $uid, string $key): void { $p = cover_manual_path($uid, $key); if (is_file($p)) @unlink($p); }
function cover_rename_manual(int $uid, string $old, string $new): void {
    $a = cover_manual_path($uid, $old); if (is_file($a)) @rename($a, cover_manual_path($uid, $new));
}
function cover_delete_user(int $uid): void {
    $d = cover_user_dir($uid);
    if (!is_dir($d)) return;
    foreach (glob($d . '/*') ?: [] as $f) @unlink($f);
    @rmdir($d);
}
