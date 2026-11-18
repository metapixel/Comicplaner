<?php
/**
 * Comic-Planer – gemeinsame Funktionen
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
declare(strict_types=1);

const APP_NAME    = 'Comic-Planer';
const APP_VERSION = '2.0.1';
const APP_SOURCE_URL = 'https://github.com/metapixel/Comicplaner';   // AGPL §13: Quellcode für Nutzer erreichbar halten
const STATUSES    = ['interessant', 'kaufen', 'bestellt', 'da', 'verworfen'];

if (!defined('APP_ROOT')) define('APP_ROOT', dirname(__DIR__));

function config_path(): string { return APP_ROOT . '/inc/config.php'; }
function is_installed(): bool { return is_file(config_path()); }

function cfg(): array {
    static $c = null;
    if ($c === null) {
        if (!is_installed()) { header('Location: install.php'); exit; }
        $c = require config_path();
    }
    return $c;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = cfg();
        $pdo = new PDO(
            'mysql:host=' . $c['db_host'] . ';port=' . (int)($c['db_port'] ?? 3306) . ';dbname=' . $c['db_name'] . ';charset=utf8mb4',
            $c['db_user'], $c['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
        );
    }
    return $pdo;
}
function t(string $name): string { return (cfg()['db_prefix'] ?? 'cp_') . $name; }

function setting(string $k, ?string $default = null): ?string {
    $s = db()->prepare('SELECT v FROM ' . t('settings') . ' WHERE k = ?');
    $s->execute([$k]);
    $v = $s->fetchColumn();
    return $v === false ? $default : (string)$v;
}
function set_setting(string $k, string $v): void {
    db()->prepare('INSERT INTO ' . t('settings') . ' (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, $v]);
}

/* ---------- Sitzung & Schutz ---------- */
function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('comicplaner');
    session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_start();
}
function security_headers(): void {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}
function csrf_token(): string {
    start_session();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function check_csrf(?string $token): bool {
    start_session();
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}
/** Angemeldeter Nutzer (aus der Datenbank geprüft) oder null.
 *  Sitzungen werden ungültig, wenn der Nutzer gelöscht wurde oder sein Passwort geändert/zurückgesetzt wurde. */
function current_user(): ?array {
    static $u = false;
    if ($u !== false) return $u;
    start_session();
    $u = null;
    if (empty($_SESSION['uid'])) return null;
    $s = db()->prepare('SELECT id, username, display_name, is_admin, must_change_pw, session_gen FROM ' . t('users') . ' WHERE id = ?');
    $s->execute([(int)$_SESSION['uid']]);
    $r = $s->fetch();
    if (!$r || (int)$r['session_gen'] !== (int)($_SESSION['gen'] ?? -1)) {
        $_SESSION = [];
        return null;
    }
    $u = ['id' => (int)$r['id'], 'username' => $r['username'], 'displayName' => $r['display_name'] !== '' ? $r['display_name'] : $r['username'],
          'isAdmin' => (bool)$r['is_admin'], 'mustChangePw' => (bool)$r['must_change_pw']];
    return $u;
}
function is_logged_in(): bool { return current_user() !== null; }
function require_login(): array {
    $u = current_user();
    if (!$u) { header('Location: login.php'); exit; }
    return $u;
}
function login_user(array $row): void {
    start_session();
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$row['id'], 'gen' => (int)$row['session_gen'], 'csrf' => bin2hex(random_bytes(32))];
}
const USERNAME_RE = '/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/';
function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

/* ---------- Login-Bremse (pro IP) ---------- */
function login_blocked(string $ip): int {
    $s = db()->prepare('SELECT fails, UNIX_TIMESTAMP(last_fail) AS lf FROM ' . t('login_attempts') . ' WHERE ip = ?');
    $s->execute([$ip]);
    $r = $s->fetch();
    if (!$r || (int)$r['fails'] < 5) return 0;
    $wait = min(3600, 30 * (2 ** ((int)$r['fails'] - 5)));
    $left = (int)$r['lf'] + $wait - time();
    return max(0, $left);
}
function login_failed(string $ip): void {
    db()->prepare('INSERT INTO ' . t('login_attempts') . ' (ip, fails, last_fail) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE fails = fails + 1, last_fail = NOW()')->execute([$ip]);
}
function login_ok(string $ip): void {
    db()->prepare('DELETE FROM ' . t('login_attempts') . ' WHERE ip = ?')->execute([$ip]);
}

/* ---------- Datenbankschema ---------- */
function schema_sql(string $p): array {
    return [
        "CREATE TABLE IF NOT EXISTS {$p}settings (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}login_attempts (ip VARCHAR(45) PRIMARY KEY, fails INT NOT NULL DEFAULT 0, last_fail DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS {$p}users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(40) NOT NULL,
            display_name VARCHAR(100) NOT NULL DEFAULT '',
            password_hash VARCHAR(255) NOT NULL,
            is_admin TINYINT(1) NOT NULL DEFAULT 0,
            must_change_pw TINYINT(1) NOT NULL DEFAULT 0,
            session_gen INT NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            last_login DATETIME NULL,
            UNIQUE KEY uq_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}imports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL DEFAULT 0,
            at DATETIME NOT NULL,
            file VARCHAR(255) NOT NULL DEFAULT '',
            total INT NOT NULL DEFAULT 0, neu INT NOT NULL DEFAULT 0, geaendert INT NOT NULL DEFAULT 0, fehlend INT NOT NULL DEFAULT 0,
            KEY idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}comics (
            user_id INT NOT NULL DEFAULT 0,
            isbn CHAR(13) NOT NULL,
            title VARCHAR(500) NOT NULL DEFAULT '',
            subtitle VARCHAR(500) NOT NULL DEFAULT '',
            authors VARCHAR(1000) NOT NULL DEFAULT '',
            publisher VARCHAR(255) NOT NULL DEFAULT '',
            date_raw VARCHAR(32) NOT NULL DEFAULT '',
            pub_date DATE NULL,
            pub_month CHAR(7) NOT NULL DEFAULT '',
            price DECIMAL(9,2) NULL,
            price_sub DECIMAL(9,2) NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'interessant',
            status_at DATETIME NULL,
            note TEXT NULL,
            title_key VARCHAR(600) NOT NULL DEFAULT '',
            first_seen DATETIME NOT NULL,
            first_import_id INT NULL,
            changed_import_id INT NULL,
            changed_at DATETIME NULL,
            source VARCHAR(8) NOT NULL DEFAULT 'vlb',
            series VARCHAR(300) NOT NULL DEFAULT '',
            volume VARCHAR(40) NOT NULL DEFAULT '',
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            tags VARCHAR(500) NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, isbn),
            KEY idx_series (series(191)),
            KEY idx_month (pub_month), KEY idx_status (status), KEY idx_tkey (title_key(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL DEFAULT 0,
            isbn CHAR(13) NOT NULL,
            at DATETIME NOT NULL,
            field VARCHAR(32) NOT NULL,
            old_val VARCHAR(1000) NOT NULL DEFAULT '',
            new_val VARCHAR(1000) NOT NULL DEFAULT '',
            import_id INT NULL,
            KEY idx_isbn (isbn), KEY idx_user_isbn (user_id, isbn)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}series_meta (
            user_id INT NOT NULL DEFAULT 0, name VARCHAR(300) NOT NULL, complete TINYINT(1) NOT NULL DEFAULT 0, PRIMARY KEY (user_id, name(191))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS {$p}import_items (
            import_id INT NOT NULL, isbn CHAR(13) NOT NULL, PRIMARY KEY (import_id, isbn)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
}

/* ---------- Schema-Aktualisierung bestehender Installationen ---------- */
const SCHEMA_VERSION = 4;
function migrate(): void {
    $v = (int)setting('schema_version', '1');
    if ($v >= SCHEMA_VERSION) return;
    $pdo = db();
    if ($v < 2) {
        $has = $pdo->query("SHOW COLUMNS FROM " . t('comics') . " LIKE 'source'")->fetch();
        if (!$has) $pdo->exec("ALTER TABLE " . t('comics') . " ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'vlb'");
    }
    if ($v < 3) {
        $cols = array_column($pdo->query("SHOW COLUMNS FROM " . t('comics'))->fetchAll(), 'Field');
        $add = ['series' => "VARCHAR(300) NOT NULL DEFAULT ''", 'volume' => "VARCHAR(40) NOT NULL DEFAULT ''",
                'is_read' => "TINYINT(1) NOT NULL DEFAULT 0", 'tags' => "VARCHAR(500) NOT NULL DEFAULT ''"];
        foreach ($add as $c => $def) if (!in_array($c, $cols, true)) $pdo->exec("ALTER TABLE " . t('comics') . " ADD COLUMN $c $def");
        if (!in_array('series', $cols, true)) $pdo->exec("ALTER TABLE " . t('comics') . " ADD KEY idx_series (series(191))");
        foreach (schema_sql(cfg()['db_prefix'] ?? 'cp_') as $sql) if (str_contains($sql, 'series_meta')) $pdo->exec($sql);
    }
    if ($v < 4) {   // Mehrbenutzer: bisherige Daten gehören dem ersten Admin
        foreach (schema_sql(cfg()['db_prefix'] ?? 'cp_') as $sql) if (str_contains($sql, '{$p}users') || preg_match('/TABLE IF NOT EXISTS \S+users \(/', $sql)) $pdo->exec($sql);
        $uid = (int)$pdo->query('SELECT MIN(id) FROM ' . t('users') . ' WHERE is_admin = 1')->fetchColumn();
        if (!$uid) {
            $pdo->prepare('INSERT INTO ' . t('users') . " (username, display_name, password_hash, is_admin, created_at) VALUES ('admin', '', ?, 1, UTC_TIMESTAMP())")
                ->execute([(string)setting('password_hash', '')]);
            $uid = (int)$pdo->lastInsertId();
            set_setting('admin_hint', '1');
        }
        $cols = fn(string $tb) => array_column($pdo->query('SHOW COLUMNS FROM ' . t($tb))->fetchAll(), 'Field');
        foreach (['comics', 'history', 'imports', 'series_meta'] as $tb) {
            if (!in_array('user_id', $cols($tb), true)) {
                $pdo->exec('ALTER TABLE ' . t($tb) . ' ADD COLUMN user_id INT NOT NULL DEFAULT 0 FIRST');
            }
            $pdo->prepare('UPDATE ' . t($tb) . ' SET user_id = ? WHERE user_id = 0')->execute([$uid]);
        }
        $pk = fn(string $tb) => array_column(array_filter($pdo->query('SHOW INDEX FROM ' . t($tb))->fetchAll(), fn($r) => $r['Key_name'] === 'PRIMARY'), 'Column_name');
        if ($pk('comics') !== ['user_id', 'isbn']) $pdo->exec('ALTER TABLE ' . t('comics') . ' DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, isbn)');
        if ($pk('series_meta') !== ['user_id', 'name']) $pdo->exec('ALTER TABLE ' . t('series_meta') . ' DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, name(191))');
        $idx = array_column($pdo->query('SHOW INDEX FROM ' . t('history'))->fetchAll(), 'Key_name');
        if (!in_array('idx_user_isbn', $idx, true)) $pdo->exec('ALTER TABLE ' . t('history') . ' ADD KEY idx_user_isbn (user_id, isbn)');
        $idx = array_column($pdo->query('SHOW INDEX FROM ' . t('imports'))->fetchAll(), 'Key_name');
        if (!in_array('idx_user', $idx, true)) $pdo->exec('ALTER TABLE ' . t('imports') . ' ADD KEY idx_user (user_id)');
        $pdo->exec('DELETE FROM ' . t('settings') . " WHERE k = 'password_hash'");
    }
    set_setting('schema_version', (string)SCHEMA_VERSION);
}
