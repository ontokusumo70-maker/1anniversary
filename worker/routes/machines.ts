import type { Env } from "../index";
import { writeAuditSafe } from "../audit/logger";
import { requireSession } from "../auth/session-guard";

type MachineType =
  | "WASHER"
  | "DRYER";

type MachineStatus =
  | "IDLE"
  | "IN_USE";

type MachineRow = {
  machine_id: string;
  machine_type: MachineType;
  machine_number: number;
  status: MachineStatus;
  started_at: string | null;
  expected_end_at: string | null;
  activated_by: string | null;
  created_at: string;
};

const WASHER_DURATION_MINUTES = 32;
const DRYER_DURATION_MINUTES = 50;

function json(
  data: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store",
      },
    },
  );
}

function errorResponse(
  error: string,
  message: string,
  status: number,
): Response {
  return json(
    {
      ok: false,
      error,
      message,
    },
    status,
  );
}



function durationMinutes(
  type: MachineType,
): number {
  return type === "WASHER"
    ? WASHER_DURATION_MINUTES
    : DRYER_DURATION_MINUTES;
}

function calculateRemainingSeconds(
  expectedEndAt: string | null,
  nowMs: number,
): number {
  if (!expectedEndAt) {
    return 0;
  }

  const endMs =
    Date.parse(expectedEndAt);

  if (!Number.isFinite(endMs)) {
    return 0;
  }

  return Math.max(
    0,
    Math.ceil(
      (endMs - nowMs) / 1000,
    ),
  );
}

function machineResponse(
  machine: MachineRow,
  nowMs: number,
) {
  const remainingSeconds =
    machine.status === "IN_USE"
      ? calculateRemainingSeconds(
          machine.expected_end_at,
          nowMs,
        )
      : 0;

  return {
    machineId:
      machine.machine_id,
    type:
      machine.machine_type,
    machineNumber:
      machine.machine_number,
    status:
      machine.status,
    statusLabel:
      machine.status === "IN_USE"
        ? "TERPAKAI"
        : "IDLE",
    durationMinutes:
      durationMinutes(
        machine.machine_type,
      ),
    startedAt:
      machine.started_at,
    expectedEndAt:
      machine.expected_end_at,
    remainingSeconds,
    activatedBy:
      machine.activated_by,
  };
}

async function getMachines(
  env: Env,
): Promise<MachineRow[]> {
  const nowIso = new Date().toISOString();

  // Automatically release completed machines before reading status.
  await env.DB
    .prepare(
      `
      UPDATE machines
      SET status = 'IDLE',
          started_at = NULL,
          expected_end_at = NULL,
          activated_by = NULL
      WHERE status = 'IN_USE'
        AND expected_end_at IS NOT NULL
        AND expected_end_at <= ?
      `,
    )
    .bind(nowIso)
    .run();

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          machine_id,
          machine_type,
          machine_number,
          status,
          started_at,
          expected_end_at,
          activated_by,
          created_at
        FROM machines
        ORDER BY
          CASE
            WHEN machine_type = 'WASHER'
            THEN 1
            ELSE 2
          END,
          machine_number ASC
        `,
      )
      .all<MachineRow>();

  return result.results;
}

/*
 * ============================================================
 * CUSTOMER / GENERAL MACHINE STATUS
 * GET /machines
 *
 * Customer hanya membaca status.
 * Tidak ada perubahan database.
 * ============================================================
 */

export async function handleMachineStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const customerSession =
    await requireSession(request, env, ["CUSTOMER", "STAFF"]);

  if (!customerSession) {
    return errorResponse(
      "UNAUTHORIZED",
      "Customer or Staff authentication is required.",
      401,
    );
  }

  const machines =
    await getMachines(env);

  const now =
    Date.now();

  const activityRows =
    await env.DB
      .prepare(
        `
        SELECT
          machine_type,
          COUNT(*) AS total_activities
        FROM machine_operations
        GROUP BY machine_type
        `,
      )
      .all<{
        machine_type: MachineType;
        total_activities: number;
      }>();

  let washerActivities = 0;
  let dryerActivities = 0;

  for (const row of activityRows.results) {
    if (row.machine_type === "WASHER") {
      washerActivities = Number(row.total_activities) || 0;
    }
    if (row.machine_type === "DRYER") {
      dryerActivities = Number(row.total_activities) || 0;
    }
  }

  const statusSummary = {
    washer: {
      total: machines.filter((machine) => machine.machine_type === "WASHER").length,
      idle: machines.filter((machine) => machine.machine_type === "WASHER" && machine.status === "IDLE").length,
      inUse: machines.filter((machine) => machine.machine_type === "WASHER" && machine.status === "IN_USE").length,
    },
    dryer: {
      total: machines.filter((machine) => machine.machine_type === "DRYER").length,
      idle: machines.filter((machine) => machine.machine_type === "DRYER" && machine.status === "IDLE").length,
      inUse: machines.filter((machine) => machine.machine_type === "DRYER" && machine.status === "IN_USE").length,
    },
  };

  return json({
    ok: true,
    machines:
      machines.map(
        (machine) =>
          machineResponse(
            machine,
            now,
          ),
      ),
    statusSummary,
    activityTotals: {
      washer: washerActivities,
      dryer: dryerActivities,
    },
    serverTime:
      new Date(now).toISOString(),
  });
}

/*
 * ============================================================
 * STAFF ACTIVATE MACHINE
 * POST /staff/machines/:machineId/activate
 *
 * Staff mengaktifkan mesin yang sedang IDLE.
 *
 * Tidak ada input durasi dari client.
 * Durasi ditentukan server berdasarkan machine_type.
 * ============================================================
 */

export async function handleStaffActivateMachine(
  request: Request,
  env: Env,
  machineId: string,
): Promise<Response> {
  const staffSession =
    await requireSession(request, env, ["STAFF"]);

  if (!staffSession) {
    return errorResponse(
      "UNAUTHORIZED",
      "Staff authentication is required.",
      401,
    );
  }

  const normalizedMachineId =
    machineId.trim().toUpperCase();

  if (
    !/^([WD])[1-5]$/.test(
      normalizedMachineId,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid machine ID.",
      400,
    );
  }

  const machine =
    await env.DB
      .prepare(
        `
        SELECT
          machine_id,
          machine_type,
          machine_number,
          status,
          started_at,
          expected_end_at,
          activated_by,
          created_at
        FROM machines
        WHERE machine_id = ?
        LIMIT 1
        `,
      )
      .bind(
        normalizedMachineId,
      )
      .first<MachineRow>();

  if (!machine) {
    return errorResponse(
      "MACHINE_NOT_FOUND",
      "Machine was not found.",
      404,
    );
  }

  if (
    machine.status === "IN_USE"
  ) {
    return errorResponse(
      "MACHINE_IN_USE",
      "Machine is already in use.",
      409,
    );
  }

  const startedAt =
    new Date();

  const expectedEnd =
    new Date(
      startedAt.getTime() +
        durationMinutes(
          machine.machine_type,
        ) *
          60 *
          1000,
    );

  const startedAtIso =
    startedAt.toISOString();

  const expectedEndIso =
    expectedEnd.toISOString();

  /*
   * Atomic IDLE → IN_USE.
   * Jika staff lain mengaktifkan lebih dahulu,
   * changes = 0 sehingga tidak terjadi double activation.
   */

  const update =
    await env.DB
      .prepare(
        `
        UPDATE machines
        SET
          status = 'IN_USE',
          started_at = ?,
          expected_end_at = ?,
          activated_by = ?
        WHERE machine_id = ?
          AND status = 'IDLE'
        `,
      )
      .bind(
        startedAtIso,
        expectedEndIso,
        staffSession.userId,
        normalizedMachineId,
      )
      .run();

  if (
    update.meta.changes !== 1
  ) {
    return errorResponse(
      "MACHINE_IN_USE",
      "Machine was activated by another request.",
      409,
    );
  }

  /*
   * Historical operation.
   *
   * ended_at memakai expected_end_at karena baseline
   * mendefinisikan machine_operations sebagai historical
   * operating records.
   */

  const operationId =
    `machine_op_${crypto.randomUUID()}`;

  await env.DB
    .prepare(
      `
      INSERT INTO machine_operations (
        operation_id,
        machine_id,
        machine_type,
        machine_number,
        started_at,
        ended_at,
        duration_seconds,
        activated_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      operationId,
      machine.machine_id,
      machine.machine_type,
      machine.machine_number,
      startedAtIso,
      expectedEndIso,
      durationMinutes(
        machine.machine_type,
      ) *
        60,
      staffSession.userId,
      startedAtIso,
    )
    .run();

  await writeAuditSafe(
    env,
    {
      entityType: "MACHINE",
      entityId:
        machine.machine_id,
      action: "UPDATE",
      actor: staffSession.userId,
      result: "SUCCESS",
    },
  );

  return json({
    ok: true,
    machine: {
      machineId:
        machine.machine_id,
      type:
        machine.machine_type,
      machineNumber:
        machine.machine_number,
      status:
        "IN_USE",
      statusLabel:
        "TERPAKAI",
      durationMinutes:
        durationMinutes(
          machine.machine_type,
        ),
      startedAt:
        startedAtIso,
      expectedEndAt:
        expectedEndIso,
      remainingSeconds:
        durationMinutes(
          machine.machine_type,
        ) *
        60,
      activatedBy:
        staffSession.userId,
    },
  });
}

/*
 * ============================================================
 * OWNER MACHINE OVERVIEW
 * GET /owner/machines
 *
 * Menampilkan:
 * - status seluruh mesin
 * - total operating seconds
 * - daily
 * - weekly
 * - monthly
 * - yearly
 *
 * Statistik berasal dari machine_operations.
 * ============================================================
 */

export async function handleOwnerMachineOverview(
  request: Request,
  env: Env,
): Promise<Response> {
  const ownerSession =
    await requireSession(request, env, ["OWNER"]);

  if (!ownerSession) {
    return errorResponse(
      "UNAUTHORIZED",
      "Owner authentication is required.",
      401,
    );
  }

  const machines =
    await getMachines(env);

  const now =
    Date.now();

  const activeMachines =
    machines.filter(
      (machine) =>
        machine.status ===
        "IN_USE",
    );

  // Campaign operations use WIB (UTC+07:00) boundaries.
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const localNow = new Date(now + WIB_OFFSET_MS);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const date = localNow.getUTCDate();
  const dayOfWeek = localNow.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;

  const dayStart = new Date(Date.UTC(year, month, date) - WIB_OFFSET_MS);
  const weekStart = new Date(dayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(year, month, 1) - WIB_OFFSET_MS);
  const yearStart = new Date(Date.UTC(year, 0, 1) - WIB_OFFSET_MS);

  const [
    daily,
    weekly,
    monthly,
    yearly,
  ] = await Promise.all([
    getOperatingSeconds(
      env,
      dayStart.toISOString(),
    ),
    getOperatingSeconds(
      env,
      weekStart.toISOString(),
    ),
    getOperatingSeconds(
      env,
      monthStart.toISOString(),
    ),
    getOperatingSeconds(
      env,
      yearStart.toISOString(),
    ),
  ]);

  await writeAuditSafe(
    env,
    {
      entityType: "MACHINE",
      entityId: "MACHINE_OVERVIEW",
      action: "CREATE",
      actor: ownerSession.userId,
      result: "SUCCESS",
    },
  );

  return json({
    ok: true,
    serverTime:
      new Date(now).toISOString(),

    activeMachines:
      activeMachines.map(
        (machine) =>
          machineResponse(
            machine,
            now,
          ),
      ),

    machines:
      machines.map(
        (machine) =>
          machineResponse(
            machine,
            now,
          ),
      ),

    operatingTime: {
      daily,
      weekly,
      monthly,
      yearly,
    },
  });
}

async function getOperatingSeconds(
  env: Env,
  startAt: string,
) {
  const rows =
    await env.DB
      .prepare(
        `
        SELECT
          machine_type,
          COALESCE(
            SUM(duration_seconds),
            0
          ) AS total_seconds
        FROM machine_operations
        WHERE started_at >= ?
        GROUP BY machine_type
        `,
      )
      .bind(startAt)
      .all<{
        machine_type: MachineType;
        total_seconds: number;
      }>();

  let washerSeconds = 0;
  let dryerSeconds = 0;

  for (
    const row of rows.results
  ) {
    if (
      row.machine_type ===
      "WASHER"
    ) {
      washerSeconds =
        Number(
          row.total_seconds,
        );
    }

    if (
      row.machine_type ===
      "DRYER"
    ) {
      dryerSeconds =
        Number(
          row.total_seconds,
        );
    }
  }

  return {
    washer: {
      seconds:
        washerSeconds,
      minutes:
        Math.floor(
          washerSeconds / 60,
        ),
    },
    dryer: {
      seconds:
        dryerSeconds,
      minutes:
        Math.floor(
          dryerSeconds / 60,
        ),
    },
  };
}

/*
 * ============================================================
 * ROUTER
 * ============================================================
 */

export async function handleMachineRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  /*
   * Customer machine status
   */
  if (
    request.method === "GET" &&
    url.pathname ===
      "/machines"
  ) {
    return handleMachineStatus(
      request,
      env,
    );
  }

  /*
   * Staff activation
   */
  if (
    request.method === "POST" &&
    url.pathname.startsWith(
      "/staff/machines/",
    ) &&
    url.pathname.endsWith(
      "/activate",
    )
  ) {
    const prefix =
      "/staff/machines/";

    const suffix =
      "/activate";

    const machineId =
      url.pathname.slice(
        prefix.length,
        url.pathname.length -
          suffix.length,
      );

    return handleStaffActivateMachine(
      request,
      env,
      decodeURIComponent(
        machineId,
      ),
    );
  }

  /*
   * Owner overview
   */
  if (
    request.method === "GET" &&
    url.pathname ===
      "/owner/machines"
  ) {
    return handleOwnerMachineOverview(
      request,
      env,
    );
  }

  return errorResponse(
    "NOT_FOUND",
    "Machine endpoint not found.",
    404,
  );
}
