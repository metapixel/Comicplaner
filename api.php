<?php
/**
 * Comic-Planer – JSON-API
 * Jede Abfrage ist auf den angemeldeten Nutzer begrenzt (user_id = $U).
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
security_headers();

function out(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(string $msg, int $code = 400): never { out(['ok' => false, 'error' => $msg], $code); }

if (!is_installed()) fail('Nicht installiert', 503);
$pdo = db();
$pdo->exec("SET time_zone = '+00:00'");   // Zeiten in UTC
migrate();

$ME = current_user();
if (!$ME) fail('Nicht angemeldet', 401);
$U = $ME['id'];

$action = (string)($_GET['a'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = [];
if ($method === 'POST') {
    if (!check_csrf($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) fail('Sitzung abgelaufen – bitte Seite neu laden.', 403);
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 8 * 1024 * 1024) fail('Datei zu groß', 413);
    $body = json_decode($raw, true);
    if (!is_array($body)) fail('Ungültige Anfrage');
}
// frischer CSRF-Schlüssel (z. B. wenn die Seite aus dem Offline-Speicher kam)
if ($action === 'csrf') out(['ok' => true, 'csrf' => csrf_token()]);
// Sitzung nur noch lesen – außer beim eigenen Passwortwechsel, der die Sitzung erneuert
if ($action !== 'password') session_write_close();

/* ---------- Validierung ---------- */
function v_isbn($v): string {   // Schlüssel: ISBN-13 oder „F“ + 12 Ziffern (freier Eintrag ohne ISBN)
    $s = is_string($v) ? $v : '';
    if (!preg_match('/^(\d{13}|F\d{12})$/', $s)) fail('Ungültige ID');
    return $s;
}
function new_free_key(PDO $pdo): string {
    $s = $pdo->prepare('SELECT 1 FROM ' . t('comics') . ' WHERE isbn = ?');
    do { $k = 'F' . str_pad((string)random_int(0, 999999999999), 12, '0', STR_PAD_LEFT); $s->execute([$k]); } while ($s->fetchColumn());
    return $k;
}
function v_tags($v): string {
    $list = is_array($v) ? $v : explode(',', (string)$v);
    $out = [];
    foreach ($list as $t) { $t = v_str(str_replace(',', ' ', (string)$t), 60); if ($t !== '' && !in_array($t, $out, true)) $out[] = $t; }
    return mb_substr(implode(',', $out), 0, 500);
}
function v_str($v, int $max): string {
    $s = is_scalar($v) ? trim((string)$v) : '';
    if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
    return mb_substr($s, 0, $max);
}
function v_price($v): ?float {
    if ($v === null || $v === '') return null;
    if (!is_numeric($v)) return null;
    $f = round((float)$v, 2);
    return ($f < 0 || $f > 9999999) ? null : $f;
}
function v_date($v): ?string {
    return (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) ? $v : null;
}
function v_month($v): string {
    return (is_string($v) && preg_match('/^\d{4}-(0[0-9]|1[0-2])$/', $v)) ? $v : '';   // -00 = nur Jahr bekannt
}
function v_password(string $pw): void {
    if (mb_strlen($pw) < 10) fail('Das Passwort braucht mindestens 10 Zeichen.');
    if (strlen($pw) > 200) fail('Das Passwort ist zu lang.');
}
function iso(?string $dt): ?string { return $dt ? str_replace(' ', 'T', $dt) . 'Z' : null; }
function price_out($v): ?float { return $v === null ? null : (float)$v; }
function need_post(string $m): void { if ($m !== 'POST') fail('POST erwartet', 405); }
function need_admin(array $me): void { if (!$me['isAdmin']) fail('Nur für Admins', 403); }
/** Alle Daten eines Nutzers löschen (ohne den Nutzer selbst) */
function wipe_user_data(PDO $pdo, int $uid): void {
    $pdo->prepare('DELETE ii FROM ' . t('import_items') . ' ii JOIN ' . t('imports') . ' i ON i.id = ii.import_id WHERE i.user_id = ?')->execute([$uid]);
    foreach (['comics', 'history', 'imports', 'series_meta'] as $tb) $pdo->prepare('DELETE FROM ' . t($tb) . ' WHERE user_id = ?')->execute([$uid]);
}

/* ---------- Aktionen ---------- */
switch ($action) {

case 'list':
    $hist = [];
    $s = $pdo->prepare('SELECT isbn, at, field, old_val, new_val, import_id FROM ' . t('history') . ' WHERE user_id = ? ORDER BY at DESC, id DESC');
    $s->execute([$U]);
    foreach ($s as $r) {
        if (count($hist[$r['isbn']] ?? []) >= 15) continue;
        $isPrice = $r['field'] === 'price';
        $hist[$r['isbn']][] = ['at' => iso($r['at']), 'field' => $r['field'],
            'from' => $isPrice ? ($r['old_val'] === '' ? null : (float)$r['old_val']) : $r['old_val'],
            'to' => $isPrice ? ($r['new_val'] === '' ? null : (float)$r['new_val']) : $r['new_val'],
            'importId' => $r['import_id'] !== null ? (int)$r['import_id'] : null];
    }
    $items = [];
    $s = $pdo->prepare('SELECT * FROM ' . t('comics') . ' WHERE user_id = ?');
    $s->execute([$U]);
    foreach ($s as $r) {
        $items[] = [
            'isbn' => $r['isbn'], 'title' => $r['title'], 'subtitle' => $r['subtitle'], 'authors' => $r['authors'],
            'publisher' => $r['publisher'], 'dateRaw' => $r['date_raw'], 'date' => $r['pub_date'] ?? '', 'month' => $r['pub_month'],
            'price' => price_out($r['price']), 'priceSub' => price_out($r['price_sub']), 'status' => $r['status'],
            'note' => $r['note'] ?? '', 'titleKey' => $r['title_key'], 'firstSeen' => iso($r['first_seen']),
            'firstImportId' => $r['first_import_id'] !== null ? (int)$r['first_import_id'] : null,
            'changedImportId' => $r['changed_import_id'] !== null ? (int)$r['changed_import_id'] : null,
            'changedAt' => iso($r['changed_at']), 'source' => $r['source'] ?? 'vlb',
            'series' => $r['series'] ?? '', 'volume' => $r['volume'] ?? '', 'read' => (bool)($r['is_read'] ?? 0),
            'tags' => ($r['tags'] ?? '') === '' ? [] : explode(',', $r['tags']),
            'history' => $hist[$r['isbn']] ?? [],
        ];
    }
    $imports = [];
    $s = $pdo->prepare('SELECT * FROM ' . t('imports') . ' WHERE user_id = ? ORDER BY id DESC LIMIT 40');
    $s->execute([$U]);
    foreach ($s as $r) {
        $imports[] = ['id' => (int)$r['id'], 'at' => iso($r['at']), 'file' => $r['file'], 'total' => (int)$r['total'],
            'neu' => (int)$r['neu'], 'geaendert' => (int)$r['geaendert'], 'fehlend' => (int)$r['fehlend']];
    }
    $latest = $imports[0]['id'] ?? null;
    $latestIsbns = null;
    if ($latest) {
        $s = $pdo->prepare('SELECT isbn FROM ' . t('import_items') . ' WHERE import_id = ?');   // $latest gehört nachweislich $U
        $s->execute([$latest]);
        $latestIsbns = $s->fetchAll(PDO::FETCH_COLUMN);
    }
    $complete = [];
    $s = $pdo->prepare('SELECT name FROM ' . t('series_meta') . ' WHERE user_id = ? AND complete = 1');
    $s->execute([$U]);
    foreach ($s as $r) $complete[] = $r['name'];
    out(['ok' => true, 'items' => $items, 'meta' => ['imports' => $imports, 'latestImportId' => $latest, 'latestIsbns' => $latestIsbns,
        'complete' => $complete, 'user' => $ME]]);

case 'status':
    need_post($method);
    $isbn = v_isbn($body['isbn'] ?? null);
    $st = (string)($body['status'] ?? '');
    if (!in_array($st, STATUSES, true)) fail('Ungültiger Status');
    $pdo->prepare('UPDATE ' . t('comics') . ' SET status = ?, status_at = UTC_TIMESTAMP() WHERE user_id = ? AND isbn = ?')->execute([$st, $U, $isbn]);
    out(['ok' => true]);

case 'note':
    need_post($method);
    $isbn = v_isbn($body['isbn'] ?? null);
    $pdo->prepare('UPDATE ' . t('comics') . ' SET note = ? WHERE user_id = ? AND isbn = ?')->execute([v_str($body['note'] ?? '', 5000), $U, $isbn]);
    out(['ok' => true]);

case 'read':
    need_post($method);
    $isbn = v_isbn($body['isbn'] ?? null);
    $pdo->prepare('UPDATE ' . t('comics') . ' SET is_read = ? WHERE user_id = ? AND isbn = ?')->execute([!empty($body['read']) ? 1 : 0, $U, $isbn]);
    out(['ok' => true]);

case 'delete':
    need_post($method);
    $isbn = v_isbn($body['isbn'] ?? null);
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM ' . t('comics') . ' WHERE user_id = ? AND isbn = ?')->execute([$U, $isbn]);
    $pdo->prepare('DELETE FROM ' . t('history') . ' WHERE user_id = ? AND isbn = ?')->execute([$U, $isbn]);
    $pdo->prepare('DELETE ii FROM ' . t('import_items') . ' ii JOIN ' . t('imports') . ' i ON i.id = ii.import_id WHERE i.user_id = ? AND ii.isbn = ?')->execute([$U, $isbn]);
    $pdo->commit();
    out(['ok' => true]);

case 'import':
    need_post($method);
    $rows = $body['rows'] ?? null;
    if (!is_array($rows) || count($rows) > 20000) fail('Keine Titel übergeben');
    $doNew = !empty($body['doNew']);
    $doChg = !empty($body['doChg']);
    $file  = v_str($body['file'] ?? '', 255);

    $clean = [];
    foreach ($rows as $r) {
        if (!is_array($r) || !isset($r['isbn']) || !preg_match('/^\d{13}$/', (string)$r['isbn'])) continue;
        $isbn = (string)$r['isbn'];
        if (isset($clean[$isbn])) continue;
        $clean[$isbn] = [
            'title' => v_str($r['title'] ?? '', 500), 'subtitle' => v_str($r['subtitle'] ?? '', 500),
            'authors' => v_str($r['authors'] ?? '', 1000), 'publisher' => v_str($r['publisher'] ?? '', 255),
            'date_raw' => v_str($r['dateRaw'] ?? '', 32), 'pub_date' => v_date($r['date'] ?? null),
            'pub_month' => v_month($r['month'] ?? ''), 'price' => v_price($r['price'] ?? null),
            'price_sub' => v_price($r['priceSub'] ?? null), 'title_key' => v_str($r['titleKey'] ?? '', 600),
        ];
    }
    if (!$clean) fail('Keine gültigen Titel in der Datei');

    $existing = [];
    $s = $pdo->prepare('SELECT isbn, title, subtitle, authors, publisher, date_raw, price, source FROM ' . t('comics') . ' WHERE user_id = ?');
    $s->execute([$U]);
    foreach ($s as $r) $existing[$r['isbn']] = $r;
    $vlbBefore = array_filter($existing, fn($r) => $r['source'] === 'vlb');

    $FIELDS = ['title' => 'title', 'subtitle' => 'subtitle', 'authors' => 'authors', 'publisher' => 'publisher', 'date_raw' => 'dateRaw', 'price' => 'price'];
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO ' . t('imports') . ' (user_id, at, file) VALUES (?, UTC_TIMESTAMP(), ?)')->execute([$U, $file]);
        $impId = (int)$pdo->lastInsertId();

        $ins = $pdo->prepare('INSERT INTO ' . t('comics') . ' (user_id, isbn, title, subtitle, authors, publisher, date_raw, pub_date, pub_month, price, price_sub, title_key, status, note, first_seen, first_import_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'interessant\', \'\', UTC_TIMESTAMP(), ?)');
        $hist = $pdo->prepare('INSERT INTO ' . t('history') . ' (user_id, isbn, at, field, old_val, new_val, import_id) VALUES (?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)');
        $item = $pdo->prepare('INSERT IGNORE INTO ' . t('import_items') . ' (import_id, isbn) VALUES (?, ?)');
        $toVlb = $pdo->prepare('UPDATE ' . t('comics') . " SET source = 'vlb' WHERE user_id = ? AND isbn = ? AND source <> 'vlb'");
        $neu = 0; $chg = 0;

        foreach ($clean as $isbn => $c) {
            $isbn = (string)$isbn;
            $ex = $existing[$isbn] ?? null;
            if (!$ex) {
                if (!$doNew) continue;
                $ins->execute([$U, $isbn, $c['title'], $c['subtitle'], $c['authors'], $c['publisher'], $c['date_raw'], $c['pub_date'], $c['pub_month'], $c['price'], $c['price_sub'], $c['title_key'], $impId]);
                $item->execute([$impId, $isbn]);
                $neu++;
                continue;
            }
            $item->execute([$impId, $isbn]);
            $toVlb->execute([$U, $isbn]);
            if (!$doChg) continue;
            $set = []; $vals = [];
            foreach ($FIELDS as $col => $label) {
                $old = $ex[$col]; $new = $c[$col];
                if ($col === 'price') {
                    if ($new === null) continue;
                    if ($old !== null && abs((float)$old - $new) < 0.005) continue;
                    $hist->execute([$U, $isbn, $label, $old === null ? '' : (string)(float)$old, (string)$new, $impId]);
                } else {
                    if ($new === '' || (string)$old === $new) continue;
                    $hist->execute([$U, $isbn, $label, (string)$old, $new, $impId]);
                }
                $set[] = "$col = ?"; $vals[] = $new;
                if ($col === 'date_raw') { $set[] = 'pub_date = ?'; $vals[] = $c['pub_date']; $set[] = 'pub_month = ?'; $vals[] = $c['pub_month']; }
                if ($col === 'title' || $col === 'subtitle') { $set[] = 'title_key = ?'; $vals[] = $c['title_key']; }
            }
            if ($set) {
                $set[] = 'changed_import_id = ?'; $vals[] = $impId;
                $set[] = 'changed_at = UTC_TIMESTAMP()';
                array_push($vals, $U, $isbn);
                $pdo->prepare('UPDATE ' . t('comics') . ' SET ' . implode(', ', array_unique($set)) . ' WHERE user_id = ? AND isbn = ?')->execute($vals);
                $chg++;
            }
        }
        $gone = $vlbBefore ? count(array_diff_key($vlbBefore, $clean)) : 0;
        $pdo->prepare('UPDATE ' . t('imports') . ' SET total = ?, neu = ?, geaendert = ?, fehlend = ? WHERE id = ? AND user_id = ?')->execute([count($clean), $neu, $chg, $gone, $impId, $U]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('Comic-Planer import: ' . $e->getMessage());
        fail('Import fehlgeschlagen – nichts wurde gespeichert.', 500);
    }
    out(['ok' => true, 'importId' => $impId, 'neu' => $neu, 'geaendert' => $chg]);

case 'search':
    require __DIR__ . '/inc/dnb.php';
    $q = v_str($_GET['q'] ?? '', 300);
    $start = max(1, (int)($_GET['start'] ?? 1));
    $r = dnb_search($q, $start, 30);
    if (isset($r['error'])) fail($r['error'], 502);
    $have = [];
    if ($r['items']) {
        $isbns = array_column($r['items'], 'isbn');
        $s = $pdo->prepare('SELECT isbn, status FROM ' . t('comics') . ' WHERE user_id = ? AND isbn IN (' . implode(',', array_fill(0, count($isbns), '?')) . ')');
        $s->execute(array_merge([$U], $isbns));
        foreach ($s->fetchAll() as $row) $have[$row['isbn']] = $row['status'];
    }
    foreach ($r['items'] as &$it) $it['have'] = $have[$it['isbn']] ?? null;
    unset($it);
    out(['ok' => true, 'total' => $r['total'], 'start' => $start, 'items' => $r['items'], 'skipped' => $r['skipped']]);

case 'add':
    need_post($method);
    $rows = $body['rows'] ?? null;
    $st = (string)($body['status'] ?? 'interessant');
    if (!in_array($st, STATUSES, true)) fail('Ungültiger Status');
    if (!is_array($rows) || !$rows || count($rows) > 200) fail('Keine Titel ausgewählt');
    $ins = $pdo->prepare('INSERT IGNORE INTO ' . t('comics') . ' (user_id, isbn, title, subtitle, authors, publisher, date_raw, pub_date, pub_month, price, price_sub, title_key, status, status_at, note, first_seen, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, UTC_TIMESTAMP(), \'\', UTC_TIMESTAMP(), \'dnb\')');
    $added = 0;
    foreach ($rows as $r) {
        if (!is_array($r) || !preg_match('/^\d{13}$/', (string)($r['isbn'] ?? ''))) continue;
        $ins->execute([$U, (string)$r['isbn'], v_str($r['title'] ?? '', 500), v_str($r['subtitle'] ?? '', 500), v_str($r['authors'] ?? '', 1000),
            v_str($r['publisher'] ?? '', 255), v_str($r['dateRaw'] ?? '', 32), v_date($r['date'] ?? null), v_month($r['month'] ?? ''),
            v_price($r['price'] ?? null), v_str($r['titleKey'] ?? '', 600), $st]);
        $added += $ins->rowCount();
    }
    out(['ok' => true, 'added' => $added]);

case 'save':   // Eintrag anlegen oder bearbeiten
    need_post($method);
    $d = $body['item'] ?? null;
    if (!is_array($d)) fail('Keine Daten');
    $f = [
        'title' => v_str($d['title'] ?? '', 500), 'subtitle' => v_str($d['subtitle'] ?? '', 500),
        'series' => v_str($d['series'] ?? '', 300), 'volume' => v_str($d['volume'] ?? '', 40),
        'authors' => v_str($d['authors'] ?? '', 1000), 'publisher' => v_str($d['publisher'] ?? '', 255),
        'date_raw' => v_str($d['dateRaw'] ?? '', 32), 'pub_date' => v_date($d['date'] ?? null), 'pub_month' => v_month($d['month'] ?? ''),
        'price' => v_price($d['price'] ?? null), 'note' => v_str($d['note'] ?? '', 5000),
        'is_read' => !empty($d['read']) ? 1 : 0, 'tags' => v_tags($d['tags'] ?? []), 'title_key' => v_str($d['titleKey'] ?? '', 600),
    ];
    $st = (string)($d['status'] ?? 'da');
    if (!in_array($st, STATUSES, true)) fail('Ungültiger Status');
    if ($f['title'] === '' && $f['series'] === '') fail('Bitte Titel oder Reihe angeben.');
    $newIsbn = trim((string)($d['newIsbn'] ?? ''));
    if ($newIsbn !== '') {
        $digits = strtoupper(preg_replace('/[^0-9X]/i', '', $newIsbn) ?? '');
        if (strlen($digits) === 10) { $b = '978' . substr($digits, 0, 9); $sum = 0; for ($i = 0; $i < 12; $i++) $sum += (int)$b[$i] * ($i % 2 ? 3 : 1); $digits = $b . ((10 - $sum % 10) % 10); }
        $ok = preg_match('/^97[89]\d{10}$/', $digits) === 1;
        if ($ok) { $sum = 0; for ($i = 0; $i < 12; $i++) $sum += (int)$digits[$i] * ($i % 2 ? 3 : 1); $ok = ((10 - $sum % 10) % 10) === (int)$digits[12]; }
        if (!$ok) fail('Die ISBN ist ungültig (Prüfziffer stimmt nicht).');
        $newIsbn = $digits;
        $s = $pdo->prepare('SELECT 1 FROM ' . t('comics') . ' WHERE user_id = ? AND isbn = ?'); $s->execute([$U, $newIsbn]);
        if ($s->fetchColumn()) fail('Diese ISBN steht schon auf deiner Liste.');
    }
    $cols = array_keys($f);
    $pdo->beginTransaction();
    try {
        if (empty($d['isbn'])) {   // neu
            $key = $newIsbn !== '' ? $newIsbn : new_free_key($pdo);
            $pdo->prepare('INSERT INTO ' . t('comics') . ' (user_id, isbn, ' . implode(', ', $cols) . ', status, status_at, first_seen, source) VALUES (?, ?, '
                . implode(', ', array_fill(0, count($cols), '?')) . ', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), \'manual\')')
                ->execute(array_merge([$U, $key], array_values($f), [$st]));
        } else {
            $key = v_isbn($d['isbn']);
            $s = $pdo->prepare('SELECT status FROM ' . t('comics') . ' WHERE user_id = ? AND isbn = ?'); $s->execute([$U, $key]);
            $old = $s->fetchColumn();
            if ($old === false) { $pdo->rollBack(); fail('Eintrag nicht gefunden', 404); }
            $set = implode(', ', array_map(fn($c) => "$c = ?", $cols));
            $pdo->prepare('UPDATE ' . t('comics') . " SET $set, status = ?" . ($old !== $st ? ', status_at = UTC_TIMESTAMP()' : '') . ' WHERE user_id = ? AND isbn = ?')
                ->execute(array_merge(array_values($f), [$st, $U, $key]));
            if ($newIsbn !== '' && $newIsbn !== $key) {   // freiem Eintrag eine ISBN geben
                $pdo->prepare('UPDATE ' . t('comics') . ' SET isbn = ? WHERE user_id = ? AND isbn = ?')->execute([$newIsbn, $U, $key]);
                $pdo->prepare('UPDATE ' . t('history') . ' SET isbn = ? WHERE user_id = ? AND isbn = ?')->execute([$newIsbn, $U, $key]);
                $pdo->prepare('UPDATE ' . t('import_items') . ' ii JOIN ' . t('imports') . ' i ON i.id = ii.import_id SET ii.isbn = ? WHERE i.user_id = ? AND ii.isbn = ?')->execute([$newIsbn, $U, $key]);
                $key = $newIsbn;
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Comic-Planer save: ' . $e->getMessage());
        fail('Speichern fehlgeschlagen.', 500);
    }
    out(['ok' => true, 'isbn' => $key]);

case 'series':   // Reihe umbenennen / als komplett markieren
    need_post($method);
    $name = v_str($body['name'] ?? '', 300);
    if (array_key_exists('rename', $body)) {
        $to = v_str($body['rename'], 300);
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE ' . t('comics') . ' SET series = ? WHERE user_id = ? AND series = ?')->execute([$to, $U, $name]);
        $s = $pdo->prepare('SELECT complete FROM ' . t('series_meta') . ' WHERE user_id = ? AND name = ?'); $s->execute([$U, $name]);
        $c = (int)$s->fetchColumn();
        $pdo->prepare('DELETE FROM ' . t('series_meta') . ' WHERE user_id = ? AND name = ?')->execute([$U, $name]);
        if ($c && $to !== '') $pdo->prepare('INSERT INTO ' . t('series_meta') . ' (user_id, name, complete) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE complete = 1')->execute([$U, $to]);
        $pdo->commit();
    }
    if (array_key_exists('complete', $body) && $name !== '') {
        $pdo->prepare('INSERT INTO ' . t('series_meta') . ' (user_id, name, complete) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE complete = VALUES(complete)')
            ->execute([$U, $name, !empty($body['complete']) ? 1 : 0]);
    }
    out(['ok' => true]);

case 'notesimport':
    need_post($method);
    $rows = $body['rows'] ?? null;
    if (!is_array($rows) || !$rows || count($rows) > 20000) fail('Keine Einträge übergeben');
    $complete = is_array($body['complete'] ?? null) ? $body['complete'] : [];
    $seen = [];   // frühere Übernahmen nicht doppelt anlegen
    $s = $pdo->prepare('SELECT series, volume, title FROM ' . t('comics') . " WHERE user_id = ? AND source IN ('notes','manual')");
    $s->execute([$U]);
    foreach ($s as $r) $seen[mb_strtolower($r['series'] . '|' . $r['volume'] . '|' . $r['title'])] = true;
    $ins = $pdo->prepare('INSERT INTO ' . t('comics') . ' (user_id, isbn, title, subtitle, series, volume, is_read, tags, note, title_key, status, status_at, first_seen, source)
        VALUES (?, ?, ?, \'\', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), \'notes\')');
    $added = 0; $dupes = 0;
    $pdo->beginTransaction();
    try {
        foreach ($rows as $r) {
            if (!is_array($r)) continue;
            $series = v_str($r['series'] ?? '', 300); $vol = v_str($r['volume'] ?? '', 40); $title = v_str($r['title'] ?? '', 500);
            if ($series === '' && $title === '') continue;
            $k = mb_strtolower("$series|$vol|$title");
            if (isset($seen[$k])) { $dupes++; continue; }
            $seen[$k] = true;
            $st = in_array($r['status'] ?? '', STATUSES, true) ? $r['status'] : 'da';
            $ins->execute([$U, new_free_key($pdo), $title, $series, $vol, !empty($r['read']) ? 1 : 0, v_tags($r['tags'] ?? []),
                v_str($r['note'] ?? '', 5000), v_str($r['titleKey'] ?? '', 600), $st]);
            $added++;
        }
        $cm = $pdo->prepare('INSERT INTO ' . t('series_meta') . ' (user_id, name, complete) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE complete = 1');
        foreach ($complete as $name) { $n = v_str($name, 300); if ($n !== '') $cm->execute([$U, $n]); }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('Comic-Planer notesimport: ' . $e->getMessage());
        fail('Übernahme fehlgeschlagen – nichts wurde gespeichert.', 500);
    }
    out(['ok' => true, 'added' => $added, 'dupes' => $dupes]);

case 'backup':   // nur die eigenen Daten
    $tables = [];
    foreach (['comics', 'history', 'imports', 'series_meta'] as $tb) {
        $s = $pdo->prepare('SELECT * FROM ' . t($tb) . ' WHERE user_id = ?'); $s->execute([$U]);
        $tables[$tb] = array_map(function ($r) { unset($r['user_id']); return $r; }, $s->fetchAll());
    }
    $s = $pdo->prepare('SELECT ii.import_id, ii.isbn FROM ' . t('import_items') . ' ii JOIN ' . t('imports') . ' i ON i.id = ii.import_id WHERE i.user_id = ?');
    $s->execute([$U]);
    $tables['import_items'] = $s->fetchAll();
    $data = ['app' => APP_NAME, 'version' => APP_VERSION, 'schema' => SCHEMA_VERSION, 'exported' => gmdate('c'), 'user' => $ME['username'], 'tables' => $tables];
    header('Content-Disposition: attachment; filename="comic-planer-sicherung-' . preg_replace('/[^A-Za-z0-9._-]/', '', $ME['username']) . '-' . gmdate('Y-m-d') . '.json"');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;

case 'restore':   // ersetzt nur die eigenen Daten; interne IDs werden neu vergeben
    need_post($method);
    if (($body['app'] ?? '') !== APP_NAME || !is_array($body['tables'] ?? null) || !is_array($body['tables']['comics'] ?? null)) fail('Das ist keine Comic-Planer-Sicherung.');
    $T = $body['tables'];
    $COMICS = ['isbn','title','subtitle','authors','publisher','date_raw','pub_date','pub_month','price','price_sub','status','status_at','note','title_key',
               'first_seen','first_import_id','changed_import_id','changed_at','source','series','volume','is_read','tags'];
    $val = fn($v) => (is_scalar($v) || $v === null) ? $v : null;
    $pdo->beginTransaction();
    try {
        wipe_user_data($pdo, $U);
        $map = [];   // alte Import-ID → neue
        $insImp = $pdo->prepare('INSERT INTO ' . t('imports') . ' (user_id, at, file, total, neu, geaendert, fehlend) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach (($T['imports'] ?? []) as $r) {
            if (!is_array($r) || !isset($r['id'], $r['at'])) continue;
            $insImp->execute([$U, $val($r['at']), v_str($r['file'] ?? '', 255), (int)($r['total'] ?? 0), (int)($r['neu'] ?? 0), (int)($r['geaendert'] ?? 0), (int)($r['fehlend'] ?? 0)]);
            $map[(int)$r['id']] = (int)$pdo->lastInsertId();
        }
        $remap = fn($id) => ($id !== null && isset($map[(int)$id])) ? $map[(int)$id] : null;
        $n = 0;
        foreach ($T['comics'] as $r) {
            if (!is_array($r) || !isset($r['isbn']) || !preg_match('/^(\d{13}|F\d{12})$/', (string)$r['isbn'])) continue;
            $r['first_import_id'] = $remap($r['first_import_id'] ?? null);
            $r['changed_import_id'] = $remap($r['changed_import_id'] ?? null);
            if (!isset($r['first_seen'])) $r['first_seen'] = gmdate('Y-m-d H:i:s');
            if (isset($r['status']) && !in_array($r['status'], STATUSES, true)) $r['status'] = 'interessant';
            $use = array_values(array_filter($COMICS, fn($c) => array_key_exists($c, $r)));
            $isbnKey = (string)$r['isbn'];
            if (str_starts_with($isbnKey, 'F')) {   // freie IDs sind global eindeutig – bei Kollision neu vergeben
                $s = $pdo->prepare('SELECT 1 FROM ' . t('comics') . ' WHERE isbn = ?'); $s->execute([$isbnKey]);
                if ($s->fetchColumn()) { $old = $isbnKey; $isbnKey = new_free_key($pdo); $r['isbn'] = $isbnKey;
                    foreach (($T['history'] ?? []) as $i => $h) if (is_array($h) && ($h['isbn'] ?? '') === $old) $T['history'][$i]['isbn'] = $isbnKey; }
            }
            $pdo->prepare('INSERT IGNORE INTO ' . t('comics') . ' (user_id, ' . implode(', ', $use) . ') VALUES (?, ' . implode(', ', array_fill(0, count($use), '?')) . ')')
                ->execute(array_merge([$U], array_map(fn($c) => $val($r[$c]), $use)));
            $n++;
        }
        $insH = $pdo->prepare('INSERT INTO ' . t('history') . ' (user_id, isbn, at, field, old_val, new_val, import_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach (($T['history'] ?? []) as $r) {
            if (!is_array($r) || !preg_match('/^(\d{13}|F\d{12})$/', (string)($r['isbn'] ?? '')) || !isset($r['at'], $r['field'])) continue;
            $insH->execute([$U, $r['isbn'], $val($r['at']), v_str($r['field'], 32), v_str($r['old_val'] ?? '', 1000), v_str($r['new_val'] ?? '', 1000), $remap($r['import_id'] ?? null)]);
        }
        $insI = $pdo->prepare('INSERT IGNORE INTO ' . t('import_items') . ' (import_id, isbn) VALUES (?, ?)');
        foreach (($T['import_items'] ?? []) as $r) {
            $nid = is_array($r) ? $remap($r['import_id'] ?? null) : null;
            if ($nid && preg_match('/^\d{13}$/', (string)($r['isbn'] ?? ''))) $insI->execute([$nid, $r['isbn']]);
        }
        $insS = $pdo->prepare('INSERT IGNORE INTO ' . t('series_meta') . ' (user_id, name, complete) VALUES (?, ?, ?)');
        foreach (($T['series_meta'] ?? []) as $r) if (is_array($r) && isset($r['name'])) $insS->execute([$U, v_str($r['name'], 300), !empty($r['complete']) ? 1 : 0]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('Comic-Planer restore: ' . $e->getMessage());
        fail('Wiederherstellung fehlgeschlagen – der bisherige Stand bleibt erhalten.', 500);
    }
    out(['ok' => true, 'restored' => $n]);

case 'password':   // eigenes Passwort
    need_post($method);
    $old = (string)($body['old'] ?? ''); $new = (string)($body['new'] ?? '');
    $s = $pdo->prepare('SELECT password_hash FROM ' . t('users') . ' WHERE id = ?'); $s->execute([$U]);
    if (!password_verify($old, (string)$s->fetchColumn())) fail('Aktuelles Passwort stimmt nicht.');
    v_password($new);
    if (hash_equals($old, $new)) fail('Das neue Passwort muss sich vom alten unterscheiden.');
    $pdo->prepare('UPDATE ' . t('users') . ' SET password_hash = ?, must_change_pw = 0, session_gen = session_gen + 1 WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $U]);
    // diese Sitzung bleibt gültig, alle anderen Geräte werden abgemeldet
    $_SESSION['gen'] = (int)$pdo->query('SELECT session_gen FROM ' . t('users') . ' WHERE id = ' . (int)$U)->fetchColumn();
    session_regenerate_id(true);
    session_write_close();
    out(['ok' => true]);

/* ---------- Nutzerverwaltung (nur Admins) ---------- */
case 'users':
    need_admin($ME);
    $rows = $pdo->query('SELECT u.id, u.username, u.display_name, u.is_admin, u.must_change_pw, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM ' . t('comics') . ' c WHERE c.user_id = u.id) AS items FROM ' . t('users') . ' u ORDER BY u.username')->fetchAll();
    out(['ok' => true, 'users' => array_map(fn($r) => ['id' => (int)$r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'],
        'isAdmin' => (bool)$r['is_admin'], 'mustChangePw' => (bool)$r['must_change_pw'], 'created' => iso($r['created_at']),
        'lastLogin' => iso($r['last_login']), 'items' => (int)$r['items'], 'me' => (int)$r['id'] === $U], $rows)]);

case 'userSave':
    need_post($method); need_admin($ME);
    $id = (int)($body['id'] ?? 0);
    $username = trim((string)($body['username'] ?? ''));
    $display = v_str($body['displayName'] ?? '', 100);
    $isAdmin = !empty($body['isAdmin']) ? 1 : 0;
    $pw = (string)($body['password'] ?? '');
    if (!preg_match(USERNAME_RE, $username)) fail('Benutzername: 2–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich.');
    $s = $pdo->prepare('SELECT id FROM ' . t('users') . ' WHERE username = ? AND id <> ?'); $s->execute([$username, $id]);
    if ($s->fetchColumn()) fail('Diesen Benutzernamen gibt es schon.');
    if ($id === 0) {
        v_password($pw);
        $pdo->prepare('INSERT INTO ' . t('users') . ' (username, display_name, password_hash, is_admin, must_change_pw, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())')
            ->execute([$username, $display, password_hash($pw, PASSWORD_DEFAULT), $isAdmin]);
        out(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
    }
    $s = $pdo->prepare('SELECT is_admin FROM ' . t('users') . ' WHERE id = ?'); $s->execute([$id]);
    $wasAdmin = $s->fetchColumn();
    if ($wasAdmin === false) fail('Nutzer nicht gefunden', 404);
    if ((int)$wasAdmin === 1 && !$isAdmin) {
        if ($id === $U) fail('Du kannst dir die Admin-Rechte nicht selbst entziehen.');
        if ((int)$pdo->query('SELECT COUNT(*) FROM ' . t('users') . ' WHERE is_admin = 1')->fetchColumn() <= 1) fail('Es muss mindestens einen Admin geben.');
    }
    $pdo->prepare('UPDATE ' . t('users') . ' SET username = ?, display_name = ?, is_admin = ? WHERE id = ?')->execute([$username, $display, $isAdmin, $id]);
    if ($pw !== '') {   // Passwort zurücksetzen: Nutzer muss es bei der nächsten Anmeldung ändern, alle Sitzungen enden
        if ($id === $U) fail('Dein eigenes Passwort änderst du über „Passwort ändern“.');
        v_password($pw);
        $pdo->prepare('UPDATE ' . t('users') . ' SET password_hash = ?, must_change_pw = 1, session_gen = session_gen + 1 WHERE id = ?')
            ->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
    }
    if (!(int)$pdo->query('SELECT COUNT(*) FROM ' . t('users') . " WHERE username = 'admin'")->fetchColumn()) set_setting('admin_hint', '0');
    out(['ok' => true, 'id' => $id]);

case 'userDelete':
    need_post($method); need_admin($ME);
    $id = (int)($body['id'] ?? 0);
    if ($id === $U) fail('Du kannst dich nicht selbst löschen.');
    $s = $pdo->prepare('SELECT 1 FROM ' . t('users') . ' WHERE id = ?'); $s->execute([$id]);
    if (!$s->fetchColumn()) fail('Nutzer nicht gefunden', 404);
    $pdo->beginTransaction();
    try {
        wipe_user_data($pdo, $id);
        $pdo->prepare('DELETE FROM ' . t('users') . ' WHERE id = ?')->execute([$id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('Comic-Planer userDelete: ' . $e->getMessage());
        fail('Löschen fehlgeschlagen.', 500);
    }
    out(['ok' => true]);

default:
    fail('Unbekannte Aktion', 404);
}
