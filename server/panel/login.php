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
            session_regenerate_id(true);
            $_SESSION['user'] = ['id' => $u['id'], 'username' => $u['username'], 'role' => $u['role']];
            header('Location: index.php');
            exit;
        }
        $error = 'Incorrect username or password';
    } catch (Throwable $e) {
        error_log('login error: ' . $e->getMessage());
        $error = 'A server error occurred. Please try again.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in · Bulk Messenger</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="style.css" />
</head>
<body class="login-body">
  <div class="login-wrap">

    <div class="login-logo">
      <div class="login-logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div>
        <div class="login-logo-text">Bulk Messenger</div>
        <div class="login-logo-sub">Campaign Dashboard</div>
      </div>
    </div>

    <form class="login-card" method="post">
      <h2>Welcome back</h2>
      <p class="sub">Sign in to access your team dashboard</p>

      <?php if ($error): ?>
        <div class="alert err">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <?= h($error) ?>
        </div>
      <?php endif; ?>

      <div class="form-field">
        <label for="username">Username</label>
        <input id="username" name="username" autofocus required autocomplete="username" placeholder="Enter your username" />
      </div>
      <div class="form-field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" placeholder="••••••••••••" />
      </div>

      <button type="submit" class="btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign in
      </button>
    </form>

    <div class="login-credit">
      &copy; <?= date('Y') ?> Bulk Messenger &mdash; Built by <a href="https://ashirarif.com" target="_blank" rel="noopener">ashirarif.com</a>
    </div>
  </div>
</body>
</html>
