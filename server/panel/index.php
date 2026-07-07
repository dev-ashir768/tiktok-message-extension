<?php
require __DIR__ . '/auth.php';
require_login();

$me    = current_user();
$admin = is_admin();
$pdo   = db();
$notice = '';

// --- Admin: create a new staff account -------------------------------------
if ($admin && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['do'] ?? '') === 'add_staff') {
    $u    = trim($_POST['new_username'] ?? '');
    $p    = (string)($_POST['new_password'] ?? '');
    $role = ($_POST['new_role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
    if ($u === '' || strlen($p) < 12) {
        $notice = 'Username is required and password must be at least 12 characters.';
    } else {
        try {
            $stmt = $pdo->prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
            $stmt->execute([$u, password_hash($p, PASSWORD_DEFAULT), $role]);
            $notice = "User '$u' ($role) created. Tell them to enter '$u' as their name in the extension settings.";
        } catch (Throwable $e) {
            $notice = 'Could not create user — username may already exist.';
        }
    }
}

// Which employee are we viewing?
$filterEmp = $admin ? trim($_GET['emp'] ?? '') : $me['username'];

// --- Summary counts --------------------------------------------------------
function counts($pdo, $emp) {
    $sql    = "SELECT status, COUNT(*) c FROM creators";
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

// --- Daily activity: date range filter ------------------------------------
function validDate($s) {
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : null;
}
$drFrom = validDate($_GET['dr_from'] ?? '') ?: date('Y-m-d', strtotime('-30 days'));
$drTo   = validDate($_GET['dr_to']   ?? '') ?: date('Y-m-d');
if ($drFrom > $drTo) [$drFrom, $drTo] = [$drTo, $drFrom];

// --- Daily activity: sent per staff per day --------------------------------
$dailyStats = [];
if ($admin) {
    $empWhere = $filterEmp !== '' ? "AND employee = ?" : '';
    $sql = "SELECT employee, DATE(updated_at) AS day, COUNT(*) AS c
            FROM creators
            WHERE status = 'sent'
              AND DATE(updated_at) BETWEEN ? AND ?
              $empWhere
            GROUP BY employee, DATE(updated_at)
            ORDER BY day DESC, employee ASC";
    $p = [$drFrom, $drTo];
    if ($filterEmp !== '') $p[] = $filterEmp;
    $rows = $pdo->prepare($sql);
    $rows->execute($p);
    foreach ($rows->fetchAll() as $r) {
        $dailyStats[$r['day']][$r['employee']] = (int)$r['c'];
    }
} else {
    $rows = $pdo->prepare(
        "SELECT DATE(updated_at) AS day, COUNT(*) AS c
         FROM creators
         WHERE status = 'sent' AND employee = ?
           AND DATE(updated_at) BETWEEN ? AND ?
         GROUP BY DATE(updated_at)
         ORDER BY day DESC"
    );
    $rows->execute([$me['username'], $drFrom, $drTo]);
    foreach ($rows->fetchAll() as $r) {
        $dailyStats[$r['day']][$me['username']] = (int)$r['c'];
    }
}
$dailyStaff = [];
foreach ($dailyStats as $empMap) {
    foreach (array_keys($empMap) as $e) $dailyStaff[$e] = true;
}
ksort($dailyStaff);
$dailyTotal = array_sum(array_map('array_sum', $dailyStats));

// --- Records ---------------------------------------------------------------
$statusFilter = in_array($_GET['status'] ?? '', ['queued', 'sent', 'failed'], true) ? $_GET['status'] : '';
$where  = [];
$params = [];
if ($filterEmp !== '')    { $where[] = "employee = ?"; $params[] = $filterEmp; }
if ($statusFilter !== '') { $where[] = "status = ?";   $params[] = $statusFilter; }
$sql = "SELECT creator_id, handle, nickname, status, employee, detail, updated_at FROM creators";
if ($where) $sql .= " WHERE " . implode(' AND ', $where);
$sql .= " ORDER BY updated_at DESC LIMIT 500";
$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$records   = $stmt->fetchAll();
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
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>

<div class="shell">

  <!-- ── Sidebar ─────────────────────────────────────────────────── -->
  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div>
        <div class="sidebar-brand-text">Bulk Messenger</div>
        <div class="sidebar-brand-sub">Campaign Dashboard</div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="sidebar-section">Overview</div>

      <a class="sidebar-link active" href="index.php">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>Dashboard</span>
      </a>

    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="sidebar-avatar"><?= h(mb_substr($me['username'], 0, 2)) ?></div>
        <div class="sidebar-user-info">
          <div class="sidebar-username"><?= h($me['username']) ?></div>
          <div class="sidebar-role"><?= $admin ? 'Administrator' : 'Staff member' ?></div>
        </div>
        <a href="logout.php" class="sidebar-signout" title="Sign out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </a>
      </div>
    </div>
  </aside>

  <!-- ── Main ─────────────────────────────────────────────────────── -->
  <div class="main">

    <div class="page-header">
      <div>
        <div class="page-title">
          <?php if ($admin && $filterEmp !== ''): ?>
            <?= h($filterEmp) ?>'s Activity
          <?php elseif ($admin): ?>
            Campaign Overview
          <?php else: ?>
            My Activity
          <?php endif; ?>
        </div>
        <div class="page-subtitle">
          <?php if ($admin && $filterEmp !== ''): ?>
            Viewing records for <strong><?= h($filterEmp) ?></strong> &mdash; <a href="index.php">View all</a>
          <?php else: ?>
            Live campaign stats &mdash; updates every 30 seconds
          <?php endif; ?>
        </div>
      </div>
      <span class="role-badge <?= $admin ? 'admin' : 'staff' ?>"><?= $admin ? 'Admin' : 'Staff' ?></span>
    </div>

    <div class="page-body">

      <?php if ($notice): ?>
        <div class="alert ok">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <?= h($notice) ?>
        </div>
      <?php endif; ?>

      <!-- Stat cards -->
      <div class="cards">
        <div class="card queued">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </div>
          <span class="n"><?= $sum['queued'] ?></span>
          <span class="card-label">In Queue</span>
        </div>

        <div class="card sent">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <span class="n"><?= $sum['sent'] ?></span>
          <span class="card-label">Messages Sent</span>
        </div>

        <div class="card failed">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <span class="n"><?= $sum['failed'] ?></span>
          <span class="card-label">Failed</span>
        </div>

        <div class="card total">
          <div class="card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <span class="n"><?= $sum['queued'] + $sum['sent'] + $sum['failed'] ?></span>
          <span class="card-label">Total Creators</span>
        </div>
      </div>

      <!-- Per-staff breakdown (admin only) -->
      <?php if ($admin): ?>
        <p class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Staff Performance
        </p>

        <div class="table-wrap" style="margin-bottom:14px;">
          <table class="grid">
            <thead>
              <tr>
                <th>Staff Member</th>
                <th>In Queue</th>
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
                  <td class="muted"><?= $t ?></td>
                  <td><a href="?emp=<?= urlencode($emp) ?>" class="view-link">View records</a></td>
                </tr>
              <?php endforeach; ?>
              <?php if (!$perStaff): ?>
                <tr><td colspan="6" class="muted" style="padding:24px 18px;text-align:center;">No data yet. Staff need to start sending messages.</td></tr>
              <?php endif; ?>
            </tbody>
          </table>
        </div>

        <details class="addstaff">
          <summary>Add staff or admin account</summary>
          <div class="addstaff-body">
            <form method="post" class="inline-form">
              <input type="hidden" name="do" value="add_staff" />
              <input name="new_username" placeholder="Username" required />
              <input name="new_password" type="password" placeholder="Password (min 12 chars)" required />
              <select name="new_role">
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit">Create account</button>
            </form>
            <p class="hint">After creating, the staff member must enter their exact username in the extension's <strong>Your name</strong> field for tracking to work correctly.</p>
          </div>
        </details>
      <?php endif; ?>

      <!-- Daily activity table -->
      <p class="section-title" style="margin-top:28px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        Daily Activity — Messages Sent
      </p>

      <!-- Date range picker (native inputs) -->
      <form class="dr-toolbar" method="get" action="" id="dr-form">
        <?php if ($filterEmp !== ''): ?>
          <input type="hidden" name="emp" value="<?= h($filterEmp) ?>" />
        <?php endif; ?>

        <div class="dr-presets">
          <span class="dr-presets-label">Quick select</span>
          <button type="button" class="dr-preset" data-days="7">Last 7 days</button>
          <button type="button" class="dr-preset" data-days="30">Last 30 days</button>
          <button type="button" class="dr-preset" data-days="90">Last 90 days</button>
          <button type="button" class="dr-preset" data-month="current">This month</button>
          <button type="button" class="dr-preset" data-month="prev">Last month</button>
        </div>

        <div class="dr-inputs">
          <div class="dr-field">
            <label for="dr_from">From</label>
            <input type="date" name="dr_from" id="dr_from" value="<?= h($drFrom) ?>" max="<?= date('Y-m-d') ?>" />
          </div>
          <span class="dr-sep">—</span>
          <div class="dr-field">
            <label for="dr_to">To</label>
            <input type="date" name="dr_to" id="dr_to" value="<?= h($drTo) ?>" max="<?= date('Y-m-d') ?>" />
          </div>
          <button type="submit" class="dr-apply">Apply</button>
          <div class="dr-summary">
            <span><?= h($drFrom) ?> → <?= h($drTo) ?></span>
            <span class="dr-summary-badge"><?= $dailyTotal ?> sent</span>
          </div>
        </div>
      </form>

      <?php if ($dailyStats): ?>
      <div class="table-wrap" style="margin-bottom:14px;overflow-x:auto;">
        <table class="grid">
          <thead>
            <tr>
              <th>Date</th>
              <?php if ($admin): ?>
                <?php foreach (array_keys($dailyStaff) as $e): ?>
                  <th><?= h($e) ?></th>
                <?php endforeach; ?>
                <th style="color:#60a5fa;">Total</th>
              <?php else: ?>
                <th>Sent</th>
              <?php endif; ?>
            </tr>
          </thead>
          <tbody>
            <?php
            $grandTotal = 0;
            $colTotals  = [];
            foreach ($dailyStats as $day => $empMap):
              $dayTotal = array_sum($empMap);
              $grandTotal += $dayTotal;
              foreach ($empMap as $e => $c) $colTotals[$e] = ($colTotals[$e] ?? 0) + $c;
            ?>
              <tr>
                <td style="font-weight:600;white-space:nowrap;"><?= h($day) ?></td>
                <?php if ($admin): ?>
                  <?php foreach (array_keys($dailyStaff) as $e): ?>
                    <td class="<?= ($empMap[$e] ?? 0) > 0 ? 'g' : 'muted' ?>">
                      <?= $empMap[$e] ?? 0 ?>
                    </td>
                  <?php endforeach; ?>
                  <td style="font-weight:700;color:#60a5fa;"><?= $dayTotal ?></td>
                <?php else: ?>
                  <td class="g"><?= $dayTotal ?></td>
                <?php endif; ?>
              </tr>
            <?php endforeach; ?>
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid #1e293b;">
              <td style="font-weight:700;">Total</td>
              <?php if ($admin): ?>
                <?php foreach (array_keys($dailyStaff) as $e): ?>
                  <td style="font-weight:700;color:#e2e8f0;"><?= $colTotals[$e] ?? 0 ?></td>
                <?php endforeach; ?>
                <td style="font-weight:800;color:#60a5fa;font-size:15px;"><?= $grandTotal ?></td>
              <?php else: ?>
                <td style="font-weight:800;color:#34d399;"><?= $grandTotal ?></td>
              <?php endif; ?>
            </tr>
          </tfoot>
        </table>
      </div>
      <?php else: ?>
        <div class="dt-empty" style="display:block;margin-bottom:14px;">No messages sent in this date range.</div>
      <?php endif; ?>

      <!-- Records table -->
      <p class="section-title" style="margin-top:28px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        Creator Records
      </p>

      <div class="dt-toolbar">
        <div class="dt-search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="dt-search" type="text" placeholder="Search by creator, handle, or detail…" autocomplete="off" />
        </div>
        <div class="dt-filters">
          <?php if ($admin): ?>
            <select id="dt-emp">
              <option value="">All staff</option>
              <?php foreach ($staffList as $s): ?>
                <option value="<?= h($s) ?>" <?= $filterEmp === $s ? 'selected' : '' ?>><?= h($s) ?></option>
              <?php endforeach; ?>
            </select>
          <?php endif; ?>
          <select id="dt-status">
            <option value="">All status</option>
            <option value="queued"  <?= $statusFilter==='queued' ?'selected':'' ?>>In Queue</option>
            <option value="sent"    <?= $statusFilter==='sent'   ?'selected':'' ?>>Sent</option>
            <option value="failed"  <?= $statusFilter==='failed' ?'selected':'' ?>>Failed</option>
          </select>
          <select id="dt-page-size">
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
            <option value="250">250 / page</option>
          </select>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grid" id="dt-table">
          <thead>
            <tr>
              <th data-col="0" class="sortable">Creator <span class="sort-icon">⇅</span></th>
              <th data-col="1" class="sortable">Status <span class="sort-icon">⇅</span></th>
              <?php if ($admin): ?>
                <th data-col="2" class="sortable">Staff <span class="sort-icon">⇅</span></th>
              <?php endif; ?>
              <th>Detail / Note</th>
              <th data-col="<?= $admin ? 4 : 3 ?>" class="sortable">Last Updated <span class="sort-icon">⇅</span></th>
            </tr>
          </thead>
          <tbody id="dt-body">
            <?php foreach ($records as $r): ?>
              <tr
                data-creator="<?= h(strtolower('@'.($r['handle'] ?: $r['creator_id']).' '.($r['nickname'] ?? ''))) ?>"
                data-status="<?= h($r['status']) ?>"
                data-emp="<?= h(strtolower($r['employee'] ?? '')) ?>"
                data-updated="<?= h($r['updated_at']) ?>">
                <td>
                  <strong>@<?= h($r['handle'] ?: $r['creator_id']) ?></strong>
                  <?php if ($r['nickname']): ?><span class="muted"> &middot; <?= h($r['nickname']) ?></span><?php endif; ?>
                </td>
                <td><span class="pill <?= h($r['status']) ?>"><?= h(ucfirst($r['status'])) ?></span></td>
                <?php if ($admin): ?><td><?= h($r['employee']) ?></td><?php endif; ?>
                <td class="muted"><?= h($r['detail']) ?></td>
                <td class="muted"><?= h($r['updated_at']) ?></td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
        <div id="dt-empty" class="dt-empty" style="display:none;">No records match your filters.</div>
      </div>

      <div class="dt-footer">
        <span id="dt-info" class="dt-info"></span>
        <div id="dt-pagination" class="dt-pagination"></div>
      </div>

      <div class="page-footer">
        &copy; <?= date('Y') ?> Bulk Messenger &mdash; Built by <a href="https://ashirarif.com" target="_blank" rel="noopener">ashirarif.com</a>
      </div>

    </div><!-- .page-body -->
  </div><!-- .main -->
</div><!-- .shell -->

<script>
(function() {
  const tbody    = document.getElementById('dt-body');
  const searchEl = document.getElementById('dt-search');
  const statusEl = document.getElementById('dt-status');
  const empEl    = document.getElementById('dt-emp');
  const pageSzEl = document.getElementById('dt-page-size');
  const infoEl   = document.getElementById('dt-info');
  const paginEl  = document.getElementById('dt-pagination');
  const emptyEl  = document.getElementById('dt-empty');
  const ths      = document.querySelectorAll('#dt-table thead th.sortable');

  let rows = Array.from(tbody.querySelectorAll('tr'));
  let sortCol = -1, sortAsc = true, page = 1;

  function cellText(row, colIdx) {
    const cells = row.querySelectorAll('td');
    return cells[colIdx] ? cells[colIdx].textContent.trim().toLowerCase() : '';
  }

  function render() {
    const q        = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const status   = statusEl ? statusEl.value : '';
    const emp      = empEl    ? empEl.value.toLowerCase() : '';
    const pageSize = parseInt(pageSzEl.value);

    let visible = rows.filter(r => {
      if (q && !r.dataset.creator.includes(q) &&
          !r.dataset.status.includes(q) &&
          !(r.dataset.emp || '').includes(q) &&
          !r.querySelectorAll('td')[<?= $admin ? 3 : 2 ?>].textContent.toLowerCase().includes(q)) return false;
      if (status && r.dataset.status !== status) return false;
      if (emp    && (r.dataset.emp || '') !== emp) return false;
      return true;
    });

    if (sortCol >= 0) {
      visible.sort((a, b) => {
        const av = cellText(a, sortCol), bv = cellText(b, sortCol);
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    const total      = visible.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page             = Math.min(page, totalPages);
    const start      = (page - 1) * pageSize;
    const pageRows   = visible.slice(start, start + pageSize);

    rows.forEach(r => r.style.display = 'none');
    pageRows.forEach(r => r.style.display = '');

    emptyEl.style.display = total === 0 ? '' : 'none';
    infoEl.textContent = total === 0 ? '' :
      'Showing ' + (start + 1) + '–' + Math.min(start + pageSize, total) + ' of ' + total + ' records';

    paginEl.innerHTML = '';
    if (totalPages <= 1) return;

    function btn(label, pg, disabled, active) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'dt-page-btn' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      b.disabled = disabled;
      b.onclick = () => { page = pg; render(); };
      paginEl.appendChild(b);
    }

    btn('‹', page - 1, page === 1, false);
    const range = 2;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - range && i <= page + range)) {
        btn(i, i, false, i === page);
      } else if (i === page - range - 1 || i === page + range + 1) {
        const s = document.createElement('span');
        s.className = 'dt-ellipsis'; s.textContent = '…';
        paginEl.appendChild(s);
      }
    }
    btn('›', page + 1, page === totalPages, false);
  }

  ths.forEach(th => {
    th.addEventListener('click', () => {
      const col = parseInt(th.dataset.col);
      if (sortCol === col) sortAsc = !sortAsc;
      else { sortCol = col; sortAsc = true; }
      ths.forEach(t => {
        t.classList.remove('sort-asc', 'sort-desc');
        t.querySelector('.sort-icon').textContent = '⇅';
      });
      th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      th.querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
      page = 1; render();
    });
  });

  [searchEl, statusEl, empEl, pageSzEl].forEach(el => {
    if (el) el.addEventListener('input', () => { page = 1; render(); });
  });

  render();

  // Date range preset buttons
  const fmt = d => d.toISOString().slice(0, 10);
  document.querySelectorAll('.dr-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const today = new Date(); today.setHours(0,0,0,0);
      let from, to = new Date(today);
      if (btn.dataset.days) {
        from = new Date(today);
        from.setDate(today.getDate() - parseInt(btn.dataset.days) + 1);
      } else if (btn.dataset.month === 'current') {
        from = new Date(today.getFullYear(), today.getMonth(), 1);
      } else if (btn.dataset.month === 'prev') {
        const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
        const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
        from = new Date(y, m, 1);
        to   = new Date(y, m + 1, 0);
      }
      document.getElementById('dr_from').value = fmt(from);
      document.getElementById('dr_to').value   = fmt(to);
      document.getElementById('dr-form').submit();
    });
  });

  // Auto-refresh page data every 30 s without full reload flicker
  setTimeout(() => location.reload(), 30000);
})();
</script>

</body>
</html>
