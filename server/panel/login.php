<?php
require __DIR__ . '/auth.php';

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = (string)($_POST['password'] ?? '');
    try {
        $stmt = db()->prepare("SELECT * FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $u = $stmt->fetch();
        if ($u && password_verify($password, $u['password_hash'])) {
            $_SESSION['user'] = ['id' => $u['id'], 'username' => $u['username'], 'role' => $u['role']];
            header('Location: index.php');
            exit;
        }
        $error = 'Ghalat username ya password';
    } catch (Throwable $e) {
        $error = 'DB error: ' . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login · Bulk Messenger Panel</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body class="login-body">
  <form class="login-card" method="post">
    <h1>📨 Bulk Messenger</h1>
    <p class="sub">Team dashboard login</p>
    <?php if ($error): ?><div class="alert"><?= h($error) ?></div><?php endif; ?>
    <label>Username<input name="username" autofocus required /></label>
    <label>Password<input name="password" type="password" required /></label>
    <button type="submit">Login</button>
  </form>
</body>
</html>
