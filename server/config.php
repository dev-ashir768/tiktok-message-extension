<?php
// Database connection config.
// Parsed from: mysql://tiksly:Programmer@2026@localhost:3306/tiktok_automation_db
// (password contains "@", so credentials are set explicitly rather than URL-parsed.)

define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_NAME', 'u104065659_tiktok');
define('DB_USER', 'u104065659_admin_tiktok');
define('DB_PASS', 'gu13Hv1^');


// Shared secret the browser extension must send with every write request.
// CHANGE THIS to a long random string before deploying to cPanel, and put the
// SAME value in each employee's extension popup ("Server token" field).
define('API_TOKEN', 'CNRvgy3TsYwuSlKu8IKsI1pnEjiAklw7');

// On cPanel your DB details look like: DB_HOST=localhost,
// DB_NAME=cpanelUser_tiktok, DB_USER=cpanelUser_tiksly, DB_PASS=<what you set>.
// Edit the five DB_* constants above to match, then run setup.php once.

function db() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}
