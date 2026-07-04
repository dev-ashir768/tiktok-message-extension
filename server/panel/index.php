<?php
require __DIR__ . '/auth.php';
require_login();

$me = current_user();
$admin = is_admin();
$pdo = db();
$notice = '';

// --- Admin: create a new staff account -------------------------------------
if ($admin && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['do'] ?? '') === 'add_staff') {
    $u = trim($_POST['new_username'] ?? '');
    $p = (string)($_POST['new_password'] ?? '');
    $role = ($_POST['new_role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
    if ($u === '' || strlen($p) < 4) {
        $notice = 'Username chahiye aur password kam se kam 4 characters.';
    } else {
        try {
            $stmt = $pdo->prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
            $stmt->execute([$u, password_hash($p, PASSWORD_DEFAULT), $role]);
            $notice = "User '$u' ($role) ban gaya. Extension mein 'Your name' = $u lagwayein.";
        } catch (Throwable $e) {
            $notice = 'Nahi bana (shayad username pehle se hai).';
        }
    }
}

// Which employee are we viewing? Staff are locked to themselves.
$filterEmp = $admin ? trim($_GET['emp'] ?? '') : $me['username'];

// --- Summary counts --------------------------------------------------------
function counts($pdo, $emp) {
    $sql = "SELECT status, COUNT(*) c FROM creators";
    $params = [];
    if ($emp !== '') { $sql .= " WHERE employee = ?"; $params[] = $emp; }
    $sql .= " GROUP BY status";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $out = ['queued' => 0, 'sent' => 0, 'failed' => 0];
    foreach ($stmt as $r) $out[$r['status']] = (int)$r['c'];
    return $out;
}
$sum = counts($pdo, $filterEmp);

// --- Admin: per-staff breakdown -------------------------------------------
$perStaff = [];
if ($admin) {
    $rows = $pdo->query(
        "SELECT employee, status, COUNT(*) c FROM creators GROUP BY employee, status"
    )->fetchAll();
    foreach ($rows as $r) {
        $e = $r['employee'] ?: '(unknown)';
        if (!isset($perStaff[$e])) $perStaff[$e] = ['queued' => 0, 'sent' => 0, 'failed' => 0];
        $perStaff[$e][$r['status']] = (int)$r['c'];
    }
    ksort($perStaff);
}

// --- Records table ---------------------------------------------------------
$statusFilter = in_array($_GET['status'] ?? '', ['queued', 'sent', 'failed'], true) ? $_GET['status'] : '';
$where = [];
$params = [];
if ($filterEmp !== '') { $where[] = "employee = ?"; $params[] = $filterEmp; }
if ($statusFilter !== '') { $where[] = "status = ?"; $params[] = $statusFilter; }
$sql = "SELECT creator_id, handle, nickname, status, employee, detail, updated_at FROM creators";
if ($where) $sql .= " WHERE " . implode(' AND ', $where);
$sql .= " ORDER BY updated_at DESC LIMIT 500";
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$records = $stmt->fetchAll();

// Staff list for the admin filter dropdown.
$staffList = $admin
    ? $pdo->query("SELECT username FROM users ORDER BY username")->fetchAll(PDO::FETCH_COLUMN)
    : [];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard · Bulk Messenger</title>
  <link rel="stylesheet" href="style.css" />
  <meta http-equiv="refresh" content="30" />
</head>
<body>
  <header class="topbar">
    <div class="brand">📨 Bulk Messenger <span class="role"><?= $admin ? 'Admin' : 'Staff' ?></span></div>
    <div class="who">
      <?= h($me['username']) ?> ·
      <a href="logout.php">Logout</a>
    </div>
  </header>

  <main>
    <?php if ($notice): ?><div class="alert ok"><?= h($notice) ?></div><?php endif; ?>

    <h2><?= $admin ? ($filterEmp === '' ? 'Sab ka summary' : 'Summary: ' . h($filterEmp)) : 'Mera summary' ?></h2>
    <div class="cards">
      <div class="card queued"><span class="n"><?= $sum['queued'] ?></span>Queued</div>
      <div class="card sent"><span class="n"><?= $sum['sent'] ?></span>Sent</div>
      <div class="card failed"><span class="n"><?= $sum['failed'] ?></span>Failed</div>
      <div class="card total"><span class="n"><?= $sum['queued'] + $sum['sent'] + $sum['failed'] ?></span>Total</div>
    </div>

    <?php if ($admin): ?>
      <h2>Per-staff breakdown</h2>
      <table class="grid">
        <thead><tr><th>Staff</th><th>Queued</th><th>Sent</th><th>Failed</th><th>Total</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($perStaff as $emp => $c): $t = $c['queued'] + $c['sent'] + $c['failed']; ?>
          <tr>
            <td><b><?= h($emp) ?></b></td>
            <td><?= $c['queued'] ?></td>
            <td class="g"><?= $c['sent'] ?></td>
            <td class="r"><?= $c['failed'] ?></td>
            <td><?= $t ?></td>
            <td><a href="?emp=<?= urlencode($emp) ?>">view</a></td>
          </tr>
        <?php endforeach; ?>
        <?php if (!$perStaff): ?><tr><td colspan="6" class="muted">Abhi koi data nahi.</td></tr><?php endif; ?>
        </tbody>
      </table>

      <details class="addstaff">
        <summary>➕ Naya staff/admin add karein</summary>
        <form method="post" class="inline-form">
          <input type="hidden" name="do" value="add_staff" />
          <input name="new_username" placeholder="username (e.g. ali)" required />
          <input name="new_password" type="text" placeholder="password (min 4)" required />
          <select name="new_role"><option value="staff">staff</option><option value="admin">admin</option></select>
          <button type="submit">Add</button>
        </form>
        <p class="hint">Note: staff apna panel username hi extension ke "Your name" field mein daale — tabhi kaam match hoga.</p>
      </details>
    <?php endif; ?>

    <h2>Records</h2>
    <form method="get" class="filters">
      <?php if ($admin): ?>
        <select name="emp" onchange="this.form.submit()">
          <option value="">— all staff —</option>
          <?php foreach ($staffList as $s): ?>
            <option value="<?= h($s) ?>" <?= $filterEmp === $s ? 'selected' : '' ?>><?= h($s) ?></option>
          <?php endforeach; ?>
        </select>
      <?php endif; ?>
      <select name="status" onchange="this.form.submit()">
        <option value="">— all status —</option>
        <?php foreach (['queued', 'sent', 'failed'] as $st): ?>
          <option value="<?= $st ?>" <?= $statusFilter === $st ? 'selected' : '' ?>><?= $st ?></option>
        <?php endforeach; ?>
      </select>
      <span class="muted">latest 500</span>
    </form>

    <table class="grid">
      <thead><tr><th>Creator</th><th>Status</th><?php if ($admin): ?><th>Staff</th><?php endif; ?><th>Detail</th><th>Updated</th></tr></thead>
      <tbody>
      <?php foreach ($records as $r): ?>
        <tr>
          <td><b>@<?= h($r['handle'] ?: $r['creator_id']) ?></b><?= $r['nickname'] ? ' · ' . h($r['nickname']) : '' ?></td>
          <td><span class="pill <?= h($r['status']) ?>"><?= h($r['status']) ?></span></td>
          <?php if ($admin): ?><td><?= h($r['employee']) ?></td><?php endif; ?>
          <td class="muted"><?= h($r['detail']) ?></td>
          <td class="muted"><?= h($r['updated_at']) ?></td>
        </tr>
      <?php endforeach; ?>
      <?php if (!$records): ?><tr><td colspan="5" class="muted">Koi record nahi.</td></tr><?php endif; ?>
      </tbody>
    </table>
  </main>
</body>
</html>
