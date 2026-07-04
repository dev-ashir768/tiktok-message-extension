<?php
// Shared API for the bulk messenger extension. All requests are JSON POST:
//   { "action": "...", "employee": "name", ... }
//
// Actions:
//   claim       -> atomically reserve creators for an employee (dedup across all).
//   mark_sent   -> mark a creator as sent (green highlight for everyone).
//   mark_failed -> mark a creator as failed.
//   status      -> list all sent / queued / failed creator ids (for highlighting).
//   reset       -> wipe all rows (used by "Reset highlights").
//   ping        -> connectivity check.

require __DIR__ . '/config.php';

// CORS: the extension calls this from a different origin (chrome-extension://).
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function out($data) {
    echo json_encode($data);
    exit;
}

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) {
    out(['ok' => false, 'error' => 'invalid JSON body']);
}

$action = $req['action'] ?? '';
$employee = substr((string)($req['employee'] ?? 'unknown'), 0, 64);

// Token gate: all actions including ping must carry the shared secret.
$token = (string)($req['token'] ?? '');
if (!hash_equals(API_TOKEN, $token)) {
    http_response_code(401);
    out(['ok' => false, 'error' => 'unauthorized (bad or missing token)']);
}

try {
    $pdo = db();

    if ($action === 'ping') {
        out(['ok' => true, 'pong' => true]);
    }

    if ($action === 'claim') {
        $creators = is_array($req['creators'] ?? null) ? $req['creators'] : [];
        $accepted = [];
        $rejected = [];

        // INSERT IGNORE relies on the UNIQUE(creator_id) key: rowCount()===1
        // means we won this creator; 0 means someone already has it.
        $ins = $pdo->prepare(
            "INSERT IGNORE INTO creators (creator_id, handle, nickname, status, employee)
             VALUES (:id, :handle, :nickname, 'queued', :employee)"
        );
        $look = $pdo->prepare(
            "SELECT status, employee FROM creators WHERE creator_id = :id"
        );

        foreach ($creators as $c) {
            $id = substr((string)($c['id'] ?? ''), 0, 32);
            if ($id === '') continue;
            $ins->execute([
                ':id' => $id,
                ':handle' => substr((string)($c['handle'] ?? ''), 0, 255),
                ':nickname' => substr((string)($c['nickname'] ?? ''), 0, 255),
                ':employee' => $employee,
            ]);
            if ($ins->rowCount() === 1) {
                $accepted[] = $id;
            } else {
                $look->execute([':id' => $id]);
                $row = $look->fetch();
                $rejected[] = [
                    'id' => $id,
                    'status' => $row['status'] ?? 'taken',
                    'employee' => $row['employee'] ?? null,
                ];
            }
        }
        out(['ok' => true, 'accepted' => $accepted, 'rejected' => $rejected]);
    }

    if ($action === 'mark_sent' || $action === 'mark_failed') {
        $c = is_array($req['creator'] ?? null) ? $req['creator'] : [];
        $id = substr((string)($c['id'] ?? ''), 0, 32);
        if ($id === '') out(['ok' => false, 'error' => 'missing creator id']);
        $status = $action === 'mark_sent' ? 'sent' : 'failed';
        $stmt = $pdo->prepare(
            "INSERT INTO creators (creator_id, handle, nickname, status, employee, detail)
             VALUES (:id, :handle, :nickname, :status, :employee, :detail)
             ON DUPLICATE KEY UPDATE
               status = VALUES(status),
               employee = VALUES(employee),
               detail = VALUES(detail),
               updated_at = CURRENT_TIMESTAMP"
        );
        $stmt->execute([
            ':id' => $id,
            ':handle' => substr((string)($c['handle'] ?? ''), 0, 255),
            ':nickname' => substr((string)($c['nickname'] ?? ''), 0, 255),
            ':status' => $status,
            ':employee' => $employee,
            ':detail' => substr((string)($req['detail'] ?? ''), 0, 255),
        ]);
        out(['ok' => true]);
    }

    if ($action === 'status') {
        $rows = $pdo->query("SELECT creator_id, status FROM creators")->fetchAll();
        $sent = [];
        $queued = [];
        $failed = [];
        foreach ($rows as $r) {
            if ($r['status'] === 'sent') $sent[] = $r['creator_id'];
            elseif ($r['status'] === 'queued') $queued[] = $r['creator_id'];
            elseif ($r['status'] === 'failed') $failed[] = $r['creator_id'];
        }
        out(['ok' => true, 'sent' => $sent, 'queued' => $queued, 'failed' => $failed]);
    }

    if ($action === 'reset') {
        $pdo->exec('TRUNCATE TABLE creators');
        out(['ok' => true]);
    }

    if ($action === 'clear_queued') {
        $pdo->exec("DELETE FROM creators WHERE status IN ('queued', 'failed')");
        out(['ok' => true]);
    }

    if ($action === 'retry_failed') {
        // Reset this employee's failed creators back to queued so they can be re-sent.
        $stmt = $pdo->prepare(
            "UPDATE creators SET status = 'queued', detail = '', updated_at = CURRENT_TIMESTAMP
             WHERE status = 'failed' AND employee = ?"
        );
        $stmt->execute([$employee]);
        out(['ok' => true, 'reset' => $stmt->rowCount()]);
    }

    out(['ok' => false, 'error' => 'unknown action: ' . $action]);
} catch (Throwable $e) {
    error_log('ttbm api error: ' . $e->getMessage());
    http_response_code(500);
    out(['ok' => false, 'error' => 'internal server error']);
}
