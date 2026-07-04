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
        $notice = 'Username is required and password must be at least 4 characters.';
    } else {
        try {
            $stmt = $pdo->prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
            $stmt->execute([$u, password_hash($p, PASSWORD_DEFAULT), $role]);
            $notice = "User '$u' ($role) created successfully. Set 'Your name' to '$u' in the extension settings.";
        } catch (Throwable $e) {
            $notice = 'Failed to create user (username might already exist).';
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
    <div class="brand">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      Bulk Messenger
      <span class="role-badge <?= $admin ? 'admin' : 'staff' ?>"><?= $admin ? 'Admin' : 'Staff' ?></span>
    </div>
    <div class="topbar-right">
      <div class="topbar-user">
        <div class="avatar"><?= h(mb_substr($me['username'], 0, 2)) ?></div>
        <span><?= h($me['username']) ?></span>
      </div>
      <a href="logout.php" class="logout-link">Sign out</a>
    </div>
  </header>

  <main>
    <?php if ($notice): ?><div class="alert ok"><?= h($notice) ?></div><?php endif; ?>

    <p class="section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <?= $admin ? ($filterEmp === '' ? 'Overall summary' : 'Summary — ' . h($filterEmp)) : 'My summary' ?>
    </p>

    <div class="cards">
      <div class="card queued">
        <span class="n"><?= $sum['queued'] ?></span>
        <span class="card-label">Queued</span>
      </div>
      <div class="card sent">
        <span class="n"><?= $sum['sent'] ?></span>
        <span class="card-label">Sent</span>
      </div>
      <div class="card failed">
        <span class="n"><?= $sum['failed'] ?></span>
        <span class="card-label">Failed</span>
      </div>
      <div class="card total">
        <span class="n"><?= $sum['queued'] + $sum['sent'] + $sum['failed'] ?></span>
        <span class="card-label">Total</span>
      </div>
    </div>

    <?php if ($admin): ?>
      <p class="section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Per-staff breakdown
      </p>

      <div class="table-wrap" style="margin-bottom:12px;">
        <table class="grid">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Queued</th>
              <th>Sent</th>
              <th>Failed</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
          <?php foreach ($perStaff as $emp => $c): $t = $c['queued'] + $c['sent'] + $c['failed']; ?>
            <tr>
              <td><strong><?= h($emp) ?></strong></td>
              <td style="color:#fbbf24;font-weight:600;"><?= $c['queued'] ?></td>
              <td class="g"><?= $c['sent'] ?></td>
              <td class="r"><?= $c['failed'] ?></td>
              <td><?= $t ?></td>
              <td><a href="?emp=<?= urlencode($emp) ?>" class="view-link">View</a></td>
            </tr>
          <?php endforeach; ?>
          <?php if (!$perStaff): ?>
            <tr><td colspan="6" class="muted" style="padding:20px 16px;">No data yet. Staff need to start sending messages.</td></tr>
          <?php endif; ?>
          </tbody>
        </table>
      </div>

      <details class="addstaff">
        <summary>Add new staff or admin</summary>
        <div class="addstaff-body">
          <form method="post" class="inline-form">
            <input type="hidden" name="do" value="add_staff" />
            <input name="new_username" placeholder="username" required />
            <input name="new_password" type="text" placeholder="password (min 4)" required />
            <select name="new_role">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit">Add user</button>
          </form>
          <p class="hint">Staff must enter their exact username in the extension's "Your name" field for tracking to match.</p>
        </div>
      </details>
    <?php endif; ?>

    <p class="section-title" style="margin-top:28px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Records
    </p>

    <form method="get" class="filters">
      <?php if ($admin): ?>
        <select name="emp" onchange="this.form.submit()">
          <option value="">All staff</option>
          <?php foreach ($staffList as $s): ?>
            <option value="<?= h($s) ?>" <?= $filterEmp === $s ? 'selected' : '' ?>><?= h($s) ?></option>
          <?php endforeach; ?>
        </select>
      <?php endif; ?>
      <select name="status" onchange="this.form.submit()">
        <option value="">All status</option>
        <?php foreach (['queued', 'sent', 'failed'] as $st): ?>
          <option value="<?= $st ?>" <?= $statusFilter === $st ? 'selected' : '' ?>><?= ucfirst($st) ?></option>
        <?php endforeach; ?>
      </select>
      <span class="muted">Showing latest 500</span>
    </form>

    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Creator</th>
            <th>Status</th>
            <?php if ($admin): ?><th>Staff</th><?php endif; ?>
            <th>Detail</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
        <?php foreach ($records as $r): ?>
          <tr>
            <td>
              <strong>@<?= h($r['handle'] ?: $r['creator_id']) ?></strong>
              <?php if ($r['nickname']): ?><span class="muted"> · <?= h($r['nickname']) ?></span><?php endif; ?>
            </td>
            <td><span class="pill <?= h($r['status']) ?>"><?= h($r['status']) ?></span></td>
            <?php if ($admin): ?><td><?= h($r['employee']) ?></td><?php endif; ?>
            <td class="muted"><?= h($r['detail']) ?></td>
            <td class="muted"><?= h($r['updated_at']) ?></td>
          </tr>
        <?php endforeach; ?>
        <?php if (!$records): ?>
          <tr><td colspan="5" class="muted" style="padding:20px 16px;">No records found.</td></tr>
        <?php endif; ?>
        </tbody>
      </table>
    </div>

    <div class="page-footer">
      Built by <a href="https://ashirarif.com" target="_blank" rel="noopener">ashirarif.com</a> · Bulk Messenger Panel
    </div>
  </main>

</body>
</html>
