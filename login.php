<?php
/**
 * Comic-Planer – Anmeldung
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
if (!is_installed()) { header('Location: install.php'); exit; }
security_headers();
db()->exec("SET time_zone = '+00:00'");
migrate();
start_session();

if (is_logged_in()) { header('Location: index.php'); exit; }

$error = '';
$username = '';
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $username = trim((string)($_POST['user'] ?? ''));
    $pw = (string)($_POST['pw'] ?? '');
    $wait = login_blocked($ip);
    if ($wait > 0) {
        $error = 'Zu viele Fehlversuche. Bitte in ' . (int)ceil($wait / 60) . ' Min. erneut versuchen.';
    } elseif (!check_csrf($_POST['csrf'] ?? null)) {
        $error = 'Sitzung abgelaufen – bitte erneut versuchen.';
    } else {
        $s = db()->prepare('SELECT id, password_hash, session_gen FROM ' . t('users') . ' WHERE username = ?');
        $s->execute([$username]);
        $row = $s->fetch();
        // gleiche Rechenzeit, auch wenn es den Namen nicht gibt
        $hash = $row ? (string)$row['password_hash'] : '$2y$10$Mxdgm8VLiKd83akyckocButFhf3cu5564Is3xfwXgvp.bDPc6ALXa';
        if (password_verify($pw, $hash) && $row) {
            login_ok($ip);
            if (password_needs_rehash($hash, PASSWORD_DEFAULT))
                db()->prepare('UPDATE ' . t('users') . ' SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $row['id']]);
            db()->prepare('UPDATE ' . t('users') . ' SET last_login = UTC_TIMESTAMP() WHERE id = ?')->execute([$row['id']]);
            login_user($row);
            header('Location: index.php');
            exit;
        }
        login_failed($ip);
        usleep(400000);
        $error = 'Benutzername oder Passwort falsch.';
    }
}
$hint = setting('admin_hint', '0') === '1';
?><!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#6B3A5B">
<title>Anmelden · <?= h(APP_NAME) ?></title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/app.css?v=<?= rawurlencode(APP_VERSION) ?>">
</head>
<body class="auth">
<main class="auth-card">
  <img src="assets/icon.svg" alt="" width="56" height="56" class="auth-icon">
  <h1><?= h(APP_NAME) ?></h1>
  <?php if ($hint): ?><p class="warnbox">Neu seit Version 2.0: Anmeldung mit Benutzername. Dein bisheriges Passwort gilt weiter, der Benutzername lautet <b>admin</b> – du kannst ihn in der Nutzerverwaltung ändern.</p><?php endif; ?>
  <?php if ($error): ?><p class="err"><?= h($error) ?></p><?php endif; ?>
  <form method="post">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <label>Benutzername<input name="user" value="<?= h($username) ?>" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" <?= $username === '' ? 'autofocus' : '' ?>></label>
    <label>Passwort<input type="password" name="pw" required autocomplete="current-password" <?= $username !== '' ? 'autofocus' : '' ?>></label>
    <button class="btn" type="submit">Anmelden</button>
  </form>
  <footer class="ver">Version <?= h(APP_VERSION) ?> · <a href="<?= h(APP_SOURCE_URL) ?>" target="_blank" rel="noopener">Quellcode</a></footer>
</main>
</body>
</html>
