<?php
/**
 * Comic-Planer – Hauptseite
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
if (!is_installed()) { header('Location: install.php'); exit; }
security_headers();
db()->exec("SET time_zone = '+00:00'");
migrate();
$ME = require_login();
$v = rawurlencode(APP_VERSION);
?><!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#6B3A5B">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Comics">
<meta name="csrf-token" content="<?= h(csrf_token()) ?>">
<meta name="cp-user" content="<?= (int)$ME['id'] ?>" data-name="<?= h($ME['displayName']) ?>" data-admin="<?= $ME['isAdmin'] ? '1' : '0' ?>" data-mustchange="<?= $ME['mustChangePw'] ? '1' : '0' ?>">
<title><?= h(APP_NAME) ?></title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/fonts.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
</head>
<body>
<header class="top">
  <div class="top-inner">
    <div class="brand">
      <h1><?= h(APP_NAME) ?></h1>
      <p id="lastImport">VLB-TIX Merkliste · Monatsplanung</p>
    </div>
    <div class="stats" id="stats"></div>
  </div>
</header>
<div class="banner" id="banner" hidden><div id="bannerText"></div></div>
<div class="bar">
  <div class="bar-inner">
    <div class="viewseg" id="viewSeg" role="tablist"><button data-v="liste" class="on" role="tab">Planung</button><button data-v="sammlung" role="tab">Sammlung</button><button data-v="stat" role="tab">Statistik</button></div>
    <input class="search" id="q" type="search" placeholder="Hab ich das? Titel, Reihe, Band, ISBN …" autocomplete="off">
    <select id="pub"><option value="">Alle Verlage</option></select>
    <select id="range">
      <option value="ab">Ab diesem Monat</option>
      <option value="alle">Alle Monate</option>
      <option value="past">Nur erschienene</option>
    </select>
    <div class="chips" id="statusChips"></div>
    <button class="btn ghost" id="addBtn" title="Ältere Titel über die Deutsche Nationalbibliothek suchen">+ Titel</button>
    <button class="btn" id="importBtn">Import</button>
    <div class="menu">
      <button class="btn ghost icon" id="menuBtn" aria-label="Menü" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu-pop" id="menuPop" hidden>
        <div class="menu-user">Angemeldet als <b><?= h($ME['displayName']) ?></b><?= $ME['displayName'] !== $ME['username'] ? ' <span class="muted">(' . h($ME['username']) . ')</span>' : '' ?></div>
        <button id="notesBtn">Aus Apple Notes übernehmen</button>
        <button id="exportBtn">Liste als CSV exportieren</button>
        <button id="backupBtn">Sicherung herunterladen</button>
        <button id="restoreBtn">Sicherung einspielen</button>
        <button id="pwBtn">Passwort ändern</button>
        <?php if ($ME['isAdmin']): ?><button id="usersBtn">Nutzer verwalten</button><?php endif; ?>
        <form method="post" action="logout.php"><input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>"><button type="submit">Abmelden</button></form>
      </div>
    </div>
  </div>
</div>
<div class="layout">
  <nav class="months" id="monthNav" aria-label="Monate"></nav>
  <main id="main"><p class="hint">Lade Daten …</p></main>
</div>
<footer class="appfoot"><?= h(APP_NAME) ?> · Version <?= h(APP_VERSION) ?> · <a href="<?= h(APP_SOURCE_URL) ?>" target="_blank" rel="noopener">Quellcode (AGPL-3.0)</a></footer>

<div class="modal-bg" id="modalBg"><div class="modal" id="modal" role="dialog" aria-modal="true"></div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="assets/xlsx.full.min.js?v=0.18.5" defer></script>
<script src="assets/app.js?v=<?= $v ?>" defer></script>
</body>
</html>
