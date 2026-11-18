<?php
/**
 * Comic-Planer – Titelsuche über die SRU-Schnittstelle der Deutschen Nationalbibliothek
 * Katalogdaten der DNB: frei nutzbar (CC0). Doku: https://www.dnb.de/sru
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);

const DNB_SRU = 'https://services.dnb.de/sru/dnb';
const MARC_NS = 'http://www.loc.gov/MARC21/slim';

/** UTF-8 zusammensetzen (DNB liefert zerlegte Umlaute) – mit Rückfall ohne intl-Erweiterung */
function nfc(string $s): string {
    if (class_exists('Normalizer')) { $n = Normalizer::normalize($s, Normalizer::FORM_C); if (is_string($n)) return $n; }
    static $map = null;
    if ($map === null) {
        $map = [];
        $marks = ["\u{0308}" => ['a'=>'ä','o'=>'ö','u'=>'ü','A'=>'Ä','O'=>'Ö','U'=>'Ü','e'=>'ë','i'=>'ï','E'=>'Ë','I'=>'Ï','y'=>'ÿ'],
                  "\u{0301}" => ['a'=>'á','e'=>'é','i'=>'í','o'=>'ó','u'=>'ú','E'=>'É','A'=>'Á','O'=>'Ó','c'=>'ć','n'=>'ń','s'=>'ś','z'=>'ź','y'=>'ý'],
                  "\u{0300}" => ['a'=>'à','e'=>'è','i'=>'ì','o'=>'ò','u'=>'ù','A'=>'À','E'=>'È'],
                  "\u{0302}" => ['a'=>'â','e'=>'ê','i'=>'î','o'=>'ô','u'=>'û','E'=>'Ê'],
                  "\u{0327}" => ['c'=>'ç','C'=>'Ç','s'=>'ş','S'=>'Ş'],
                  "\u{0303}" => ['a'=>'ã','o'=>'õ','n'=>'ñ','N'=>'Ñ'],
                  "\u{030C}" => ['c'=>'č','s'=>'š','z'=>'ž','C'=>'Č','S'=>'Š','Z'=>'Ž','r'=>'ř','e'=>'ě'],
                  "\u{030A}" => ['a'=>'å','A'=>'Å','u'=>'ů']];
        foreach ($marks as $mark => $chars) foreach ($chars as $base => $comp) $map[$base . $mark] = $comp;
    }
    return strtr($s, $map);
}

function http_get(string $url, int $timeout = 12): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_USERAGENT => 'Comic-Planer/' . APP_VERSION]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($body !== false && $code === 200) ? (string)$body : null;
    }
    if (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'header' => "User-Agent: Comic-Planer/" . APP_VERSION . "\r\n"]]);
        $body = @file_get_contents($url, false, $ctx);
        return $body === false ? null : $body;
    }
    return null;
}

/** Suchtext in eine CQL-Abfrage übersetzen */
function dnb_query(string $input): ?string {
    $input = trim(preg_replace('/\s+/u', ' ', $input) ?? '');
    if ($input === '') return null;
    // ISBNs (eine oder mehrere, getrennt durch Leerzeichen, Komma, Semikolon oder Zeilen)
    $isbns = []; $rest = [];
    foreach (preg_split('/[\s,;]+/u', $input) ?: [] as $tok) {
        $d = strtoupper(preg_replace('/[^0-9Xx]/', '', $tok) ?? '');
        if (preg_match('/^[\dXx-]+$/', $tok) && (strlen($d) === 13 || strlen($d) === 10)) $isbns[] = $d; else $rest[] = $tok;
    }
    // ISBN mit Leerzeichen (978 3 551 02137 3) zusammenfügen
    if (!$isbns) { $d = preg_replace('/[^0-9Xx]/', '', $input) ?? ''; if (preg_match('/^[\d\s\-Xx]+$/', $input) && (strlen($d) === 13 || strlen($d) === 10)) { $isbns[] = strtoupper($d); $rest = []; } }
    if ($isbns && !$rest) return implode(' or ', array_map(fn($i) => 'num=' . $i, array_slice(array_unique($isbns), 0, 30)));
    $rest = implode(' ', $rest);
    // Freitext: jedes Wort muss vorkommen
    $words = preg_split('/\s+/u', $rest) ?: [];
    $terms = [];
    foreach ($words as $w) {
        $w = trim(str_replace(['"', '\\', '(', ')', '=', '<', '>', '/'], ' ', $w));
        if ($w === '' || in_array(mb_strtolower($w), ['and', 'or', 'not', 'prox', 'und', 'oder'], true)) continue;
        $terms[] = '"' . $w . '"';
        if (count($terms) >= 8) break;
    }
    if (!$terms) return null;
    return implode(' and ', $terms) . ' and mat=books';
}

function marc_fields(DOMElement $rec, string $tag): array {
    $out = [];
    foreach ($rec->getElementsByTagNameNS(MARC_NS, 'datafield') as $df) {
        if ($df->getAttribute('tag') !== $tag) continue;
        $sf = [];
        foreach ($df->getElementsByTagNameNS(MARC_NS, 'subfield') as $s) $sf[] = [$s->getAttribute('code'), nfc(trim($s->textContent))];
        $out[] = ['ind1' => $df->getAttribute('ind1'), 'ind2' => $df->getAttribute('ind2'), 'sf' => $sf];
    }
    return $out;
}
function sub(array $field, string $code): string {
    foreach ($field['sf'] as [$c, $v]) if ($c === $code) return $v;
    return '';
}
function subs(array $field, string $code): array {
    $r = [];
    foreach ($field['sf'] as [$c, $v]) if ($c === $code) $r[] = $v;
    return $r;
}
function tidy(string $s): string {
    $s = preg_replace('/\s*\[[^\]]*\]\s*/u', ' ', $s) ?? $s;        // [aus d. Franz. …]
    $s = preg_replace('/\s+\/\s.*$/u', '', $s) ?? $s;              // " / Verantwortlichkeit"
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    return trim($s, " \t/:;,.=");
}
function isbn13(string $v): string {
    $d = strtoupper(preg_replace('/[^0-9X]/i', '', $v) ?? '');
    if (strlen($d) === 10) { $b = '978' . substr($d, 0, 9); $sum = 0; for ($i = 0; $i < 12; $i++) $sum += (int)$b[$i] * ($i % 2 ? 3 : 1); $d = $b . ((10 - $sum % 10) % 10); }
    return preg_match('/^97[89]\d{10}$/', $d) ? $d : '';
}
function dnb_date(string $raw): array {
    $s = trim(preg_replace('/[\[\]©c?]/u', '', $raw) ?? '');
    $months = ['januar'=>1,'jan'=>1,'februar'=>2,'feb'=>2,'märz'=>3,'maerz'=>3,'mär'=>3,'april'=>4,'apr'=>4,'mai'=>5,'juni'=>6,'jun'=>6,'juli'=>7,'jul'=>7,
               'august'=>8,'aug'=>8,'september'=>9,'sep'=>9,'sept'=>9,'oktober'=>10,'okt'=>10,'november'=>11,'nov'=>11,'dezember'=>12,'dez'=>12];
    if (preg_match('/(\d{1,2})\.(\d{1,2})\.(\d{4})/', $s, $m) && checkdate((int)$m[2], (int)$m[1], (int)$m[3]))
        return [sprintf('%02d.%02d.%04d', $m[1], $m[2], $m[3]), sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]), sprintf('%04d-%02d', $m[3], $m[2])];
    if (preg_match('/(\d{1,2})\s*\/\s*(\d{4})/', $s, $m) && (int)$m[1] >= 1 && (int)$m[1] <= 12)
        return [sprintf('%02d.%04d', $m[1], $m[2]), '', sprintf('%04d-%02d', $m[2], $m[1])];
    if (preg_match('/([A-Za-zäÄ]+)\.?\s+(\d{4})/u', $s, $m) && isset($months[mb_strtolower($m[1])]))
        return [sprintf('%02d.%04d', $months[mb_strtolower($m[1])], $m[2]), '', sprintf('%04d-%02d', $m[2], $months[mb_strtolower($m[1])])];
    if (preg_match('/\b(1[89]\d{2}|20\d{2})\b/', $s, $m)) return [$m[1], '', $m[1] . '-00'];
    if (preg_match('/^(\d{2})$/', $s, $m)) { $y = 2000 + (int)$m[1]; return [(string)$y, '', $y . '-00']; }   // DNB kürzt teils auf „26“
    return [$raw, '', ''];
}
function person_name(string $n): string {
    $n = trim($n, " ,.");
    if (preg_match('/^([^,]+),\s*(.+)$/u', $n, $m)) return trim($m[2]) . ' ' . trim($m[1]);
    return $n;
}

/** Ein MARC-Datensatz → Comic-Planer-Eintrag (oder null, wenn ungeeignet) */
function dnb_record(DOMElement $rec): ?array {
    foreach (marc_fields($rec, '338') as $f) if (sub($f, 'b') === 'cr') return null;   // Online-Ressource / E-Book
    $isbn = ''; $price = null;
    foreach (marc_fields($rec, '020') as $f) {
        $i = isbn13(sub($f, 'a') ?: sub($f, '9'));
        if ($i && !$isbn) $isbn = $i;
        $c = sub($f, 'c');
        if ($price === null && $c && (preg_match('/EUR\s*([\d.,]+)\s*\(DE\)/u', $c, $m) || preg_match('/EUR\s*([\d.,]+)/u', $c, $m)))
            $price = (float)str_replace(',', '.', $m[1]);
    }
    if (!$isbn) foreach (marc_fields($rec, '024') as $f) { $i = isbn13(sub($f, 'a')); if ($i) { $isbn = $i; break; } }
    if (!$isbn) return null;

    $f245 = marc_fields($rec, '245')[0] ?? null;
    if (!$f245) return null;
    $a = tidy(sub($f245, 'a')); $b = tidy(sub($f245, 'b'));
    $n = tidy(implode(' ', subs($f245, 'n'))); $p = tidy(implode(' ', subs($f245, 'p')));

    // Reihe: 490 mit Indikator 1 (verknüpfte Reihe) bzw. 800/830
    $series = ''; $vol = '';
    foreach (array_merge(marc_fields($rec, '800'), marc_fields($rec, '830')) as $f) {
        $series = tidy(sub($f, 't') ?: sub($f, 'a')); $vol = tidy(sub($f, 'v')); if ($series) break;
    }
    if (!$series) foreach (marc_fields($rec, '490') as $f) if ($f['ind1'] === '1') { $series = tidy(sub($f, 'a')); $vol = tidy(sub($f, 'v')); break; }

    if ($series && mb_stripos($a, $series) === false) {
        $title = $series . ($vol !== '' ? (preg_match('/^\d/', $vol) ? ' ' : '. ') . $vol : '');
        $subtitle = $a . ($b !== '' ? ' – ' . $b : '');
    } else {
        $title = $a . ($n !== '' ? ' ' . $n : '');
        $subtitle = $p !== '' ? $p : $b;
    }
    // Ausgabe-Hinweis (z. B. limitierte Vorzugsausgabe)
    $ed = sub(marc_fields($rec, '250')[0] ?? ['sf' => []], 'a');
    $ed = trim(preg_replace('/^\s*\d+\.\s*Aufl(age|\.)\s*,?/iu', '', str_replace(['[', ']'], '', $ed)) ?? '', " ,.");
    if ($ed !== '' && !preg_match('/^\d+\.\s*Aufl/iu', $ed)) $subtitle = trim($subtitle . ' (' . $ed . ')');

    // Personen ohne Übersetzer
    $people = [];
    foreach (array_merge(marc_fields($rec, '100'), marc_fields($rec, '700')) as $f) {
        if (in_array('trl', subs($f, '4'), true)) continue;
        $nm = person_name(sub($f, 'a'));
        if ($nm !== '' && !in_array($nm, $people, true)) $people[] = $nm;
    }
    $authors = implode(', ', array_slice($people, 0, 4)) . (count($people) > 4 ? ' u.a.' : '');

    $pubF = null;
    foreach (marc_fields($rec, '264') as $f) if ($f['ind2'] === '1') { $pubF = $f; break; }
    if (!$pubF) $pubF = marc_fields($rec, '264')[0] ?? (marc_fields($rec, '260')[0] ?? null);
    $publisher = $pubF ? tidy(sub($pubF, 'b')) : '';
    [$dateRaw, $date, $month] = dnb_date($pubF ? sub($pubF, 'c') : '');

    return ['isbn' => $isbn, 'title' => mb_substr($title, 0, 500), 'subtitle' => mb_substr($subtitle, 0, 500), 'authors' => mb_substr($authors, 0, 1000),
        'publisher' => mb_substr($publisher, 0, 255), 'dateRaw' => mb_substr($dateRaw, 0, 32), 'date' => $date, 'month' => $month,
        'price' => $price, 'priceSub' => null];
}

/** Suche ausführen. Rückgabe: ['total'=>int, 'items'=>[...], 'skipped'=>int] oder ['error'=>string] */
function dnb_search(string $input, int $start = 1, int $max = 30): array {
    $q = dnb_query($input);
    if ($q === null) return ['error' => 'Bitte einen Suchbegriff oder eine ISBN eingeben.'];
    $url = DNB_SRU . '?' . http_build_query(['version' => '1.1', 'operation' => 'searchRetrieve', 'query' => $q,
        'recordSchema' => 'MARC21-xml', 'maximumRecords' => (string)max(1, min(50, $max)), 'startRecord' => (string)max(1, $start)]);
    $xml = http_get($url);
    if ($xml === null) return ['error' => 'Die Deutsche Nationalbibliothek ist gerade nicht erreichbar (oder der Webspace darf keine externen Verbindungen aufbauen).'];
    return dnb_parse($xml);
}
function dnb_parse(string $xml): array {
    $doc = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $ok = $doc->loadXML($xml, LIBXML_NONET);
    libxml_use_internal_errors($prev);
    if (!$ok) return ['error' => 'Antwort der DNB konnte nicht gelesen werden.'];
    $total = (int)($doc->getElementsByTagName('numberOfRecords')->item(0)?->textContent ?? 0);
    $diag = $doc->getElementsByTagName('diagnostic')->item(0);
    if ($diag && $total === 0) return ['total' => 0, 'items' => [], 'skipped' => 0];
    $items = []; $skipped = 0; $seen = [];
    foreach ($doc->getElementsByTagNameNS(MARC_NS, 'record') as $rec) {
        $r = dnb_record($rec);
        if (!$r || isset($seen[$r['isbn']])) { $skipped++; continue; }
        $seen[$r['isbn']] = true;
        $items[] = $r;
    }
    return ['total' => $total, 'items' => $items, 'skipped' => $skipped];
}
