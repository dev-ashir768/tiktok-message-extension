<?php
// One-time setup: DROPS ALL existing tables in the database (as requested),
// then creates a fresh schema. Run once from the browser or CLI:
//   php setup.php     (CLI)
//   http://<host>/server/setup.php   (browser)

require __DIR__ . '/config.php';

header('Content-Type: text/plain; charset=utf-8');

try {
    // Try to create the database if it doesn't exist. On shared hosting
    // (Hostinger/cPanel) the DB is already made via the panel and the user
    // lacks CREATE DATABASE rights, so we just skip this step there.
    try {
        $rootDsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';charset=utf8mb4';
        $root = new PDO($rootDsn, DB_USER, DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $root->exec('CREATE DATABASE IF NOT EXISTS `' . DB_NAME . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        echo "Database ready: " . DB_NAME . "\n";
    } catch (Throwable $e) {
        echo "Note: skipping DB create (using existing panel-made database).\n";
    }

    $pdo = db();

    // Drop every existing table in this database.
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $tables = $pdo->query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = " .
        $pdo->quote(DB_NAME)
    )->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tables as $t) {
        $pdo->exec('DROP TABLE IF EXISTS `' . str_replace('`', '', $t) . '`');
        echo "Dropped table: $t\n";
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');

    // One row per creator. creator_id is unique -> natural dedup across employees.
    $pdo->exec("
        CREATE TABLE creators (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            creator_id VARCHAR(32) NOT NULL,
            handle VARCHAR(255) DEFAULT NULL,
            nickname VARCHAR(255) DEFAULT NULL,
            status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
            employee VARCHAR(64) DEFAULT NULL,
            detail VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_creator (creator_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    echo "Created table: creators\n";

    // Panel login accounts.
    $pdo->exec("
        CREATE TABLE users (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(64) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    echo "Created table: users\n";

    // Seed a default admin. CHANGE THIS PASSWORD after first login.
    $adminUser = 'admin';
    $adminPass = 'admin123';
    $stmt = $pdo->prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')");
    $stmt->execute([$adminUser, password_hash($adminPass, PASSWORD_DEFAULT)]);
    echo "Seeded admin login -> username: $adminUser  password: $adminPass  (change it!)\n";

    echo "\nSetup complete ✅\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "ERROR: " . $e->getMessage() . "\n";
}
