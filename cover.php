<?php
/**
 * Comic-Planer – Cover ausliefern (nur für angemeldete Nutzer, nur eigene Einträge)
 * Copyright (C) 2026 Kai Kranz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
require __DIR__ . '/inc/covers.php';
if (!is_installed()) { http_response_code(503); exit; }
$ME = current_user();
session_write_close();
if (!$ME) { http_response_code(401); exit; }
$key = (string)($_GET['k'] ?? '');
if (!preg_match('/^(\d{13}|F\d{12})$/', $key)) { http_response_code(400); exit; }
$s = db()->prepare('SELECT cover, cover_ver FROM ' . t('comics') . ' WHERE user_id = ? AND isbn = ?');
$s->execute([$ME['id'], $key]);
$r = $s->fetch();
$file = $r ? cover_file($ME['id'], $key, (string)$r['cover']) : null;
if (!$file) { http_response_code(404); exit; }
$etag = '"' . $key . '-' . (int)$r['cover_ver'] . '-' . filemtime($file) . '"';
header('Content-Type: image/jpeg');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=31536000, immutable');   // die URL enthält die Version
header('ETag: ' . $etag);
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
header('Content-Length: ' . filesize($file));
readfile($file);
