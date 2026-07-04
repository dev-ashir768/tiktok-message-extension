<?php
// Session + auth helpers for the admin panel.
require __DIR__ . '/../config.php';

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function current_user() {
    return $_SESSION['user'] ?? null;
}

function require_login() {
    if (!current_user()) {
        header('Location: login.php');
        exit;
    }
}

function is_admin() {
    $u = current_user();
    return $u && $u['role'] === 'admin';
}

function h($s) {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}
