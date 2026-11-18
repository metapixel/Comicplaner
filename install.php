<?php
/**
 * Comic-Planer – Installation
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
security_headers();
start_session();

$errors = [];
$done = false;

if (is_installed()) {
    $locked = true;
} else {
    $locked = false;
    $f = ['db_host' => 'localhost', 'db_port' => '3306', 'db_name' => '', 'db_user' => '', 'db_prefix' => 'cp_', 'admin_user' => ''];
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        if (!check_csrf($_POST['csrf'] ?? null)) $errors[] = 'Sitzung abgelaufen – bitte erneut versuchen.';
        foreach ($f as $k => $_) $f[$k] = trim((string)($_POST[$k] ?? ''));
        $pass  = (string)($_POST['db_pass'] ?? '');
        $pw1   = (string)($_POST['pw1'] ?? '');
        $pw2   = (string)($_POST['pw2'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_]{0,20}$/', $f['db_prefix'])) $errors[] = 'Tabellen-Präfix: nur Buchstaben, Ziffern und _ (max. 20).';
        if ($f['db_name'] === '' || $f['db_user'] === '') $errors[] = 'Bitte Datenbankname und Benutzer angeben.';
        if (!preg_match(USERNAME_RE, $f['admin_user'])) $errors[] = 'Benutzername: 2–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich.';
        if (mb_strlen($pw1) < 10) $errors[] = 'Das Passwort braucht mindestens 10 Zeichen.';
        if ($pw1 !== $pw2) $errors[] = 'Die Passwörter stimmen nicht überein.';
        if (!is_writable(__DIR__ . '/inc')) $errors[] = 'Der Ordner „inc“ ist nicht beschreibbar – config.php kann nicht angelegt werden.';

        if (!$errors) {
            try {
                $pdo = new PDO('mysql:host=' . $f['db_host'] . ';port=' . (int)$f['db_port'] . ';dbname=' . $f['db_name'] . ';charset=utf8mb4',
                    $f['db_user'], $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                foreach (schema_sql($f['db_prefix']) as $sql) $pdo->exec($sql);
                $hasUsers = (int)$pdo->query("SELECT COUNT(*) FROM {$f['db_prefix']}users")->fetchColumn();
                if ($hasUsers) throw new RuntimeException('In dieser Datenbank gibt es bereits Comic-Planer-Nutzer. Für eine Neuinstallation ein anderes Tabellen-Präfix wählen.');
                $pdo->exec("INSERT INTO {$f['db_prefix']}settings (k, v) VALUES ('schema_version', '" . SCHEMA_VERSION . "') ON DUPLICATE KEY UPDATE v = VALUES(v)");
                $pdo->prepare("INSERT INTO {$f['db_prefix']}users (username, display_name, password_hash, is_admin, created_at) VALUES (?, '', ?, 1, UTC_TIMESTAMP())")
                    ->execute([$f['admin_user'], password_hash($pw1, PASSWORD_DEFAULT)]);
                $cfg = "<?php\n// Comic-Planer – erzeugt am " . gmdate('Y-m-d H:i') . " UTC\nreturn " . var_export([
                    'db_host' => $f['db_host'], 'db_port' => (int)$f['db_port'], 'db_name' => $f['db_name'],
                    'db_user' => $f['db_user'], 'db_pass' => $pass, 'db_prefix' => $f['db_prefix'],
                ], true) . ";\n";
                if (file_put_contents(config_path(), $cfg, LOCK_EX) === false) throw new RuntimeException('config.php konnte nicht geschrieben werden.');
                @chmod(config_path(), 0600);
                $done = true;
            } catch (PDOException $e) {
                $errors[] = 'Datenbankverbindung fehlgeschlagen: ' . $e->getMessage();
            } catch (Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }
    }
}
?><!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installation · <?= h(APP_NAME) ?></title>
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/app.css">
</head>
<body class="auth">
<main class="auth-card wide">
  <h1><?= h(APP_NAME) ?></h1>
  <?php if ($locked): ?>
    <p>Der Comic-Planer ist bereits installiert.</p>
    <p class="muted">Für eine Neuinstallation <code>inc/config.php</code> löschen.</p>
    <a class="btn" href="index.php">Zum Comic-Planer</a>
  <?php elseif ($done): ?>
    <h2>Fertig!</h2>
    <p>Die Datenbank ist eingerichtet und dein Passwort gespeichert.</p>
    <p class="warnbox"><b>Wichtig:</b> Lösche jetzt die Datei <code>install.php</code> vom Webspace.</p>
    <a class="btn" href="login.php">Zur Anmeldung</a>
  <?php else: ?>
    <p class="muted">Lege vorher bei deinem Hoster eine MySQL- oder MariaDB-Datenbank an.</p>
    <?php foreach ($errors as $e): ?><p class="err"><?= h($e) ?></p><?php endforeach; ?>
    <form method="post" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
      <fieldset><legend>Datenbank</legend>
        <div class="grid2">
          <label>Server<input name="db_host" value="<?= h($f['db_host']) ?>" required></label>
          <label>Port<input name="db_port" value="<?= h($f['db_port']) ?>" inputmode="numeric"></label>
          <label>Datenbankname<input name="db_name" value="<?= h($f['db_name']) ?>" required></label>
          <label>Benutzer<input name="db_user" value="<?= h($f['db_user']) ?>" required></label>
          <label>Passwort<input type="password" name="db_pass"></label>
          <label>Tabellen-Präfix<input name="db_prefix" value="<?= h($f['db_prefix']) ?>"></label>
        </div>
      </fieldset>
      <fieldset><legend>Dein Zugang (Admin)</legend>
        <label>Benutzername<input name="admin_user" value="<?= h($f['admin_user']) ?>" required autocomplete="username" autocapitalize="none" placeholder="z. B. kai"></label>
        <div class="grid2">
          <label>Passwort (min. 10 Zeichen)<input type="password" name="pw1" required minlength="10" autocomplete="new-password"></label>
          <label>Passwort wiederholen<input type="password" name="pw2" required minlength="10" autocomplete="new-password"></label>
        </div>
      </fieldset>
      <button class="btn" type="submit">Installieren</button>
    </form>
  <?php endif; ?>
  <footer class="ver">Version <?= h(APP_VERSION) ?> · <a href="<?= h(APP_SOURCE_URL) ?>" target="_blank" rel="noopener">Quellcode</a></footer>
</main>
</body>
</html>
