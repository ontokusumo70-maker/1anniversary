import type { Env } from './index';

/**
 * RealtimeHub is the Durable Object endpoint for the application's
 * WebSocket realtime layer.
 *
 * Stage 5 adds server-side machine expiry scheduling through the
 * Durable Object alarm. Existing WebSocket/realtime behavior remains.
 */
export class RealtimeHub {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/broadcast') {
      let body: {
        type?: unknown;
        payload?: unknown;
      };

      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'INVALID_JSON',
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        );
      }

      const type =
        typeof body.type === 'string'
          ? body.type.trim()
          : '';

      if (!type || type.length > 64) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'INVALID_BROADCAST_TYPE',
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        );
      }

      if (type === 'MACHINE_UPDATED') {
        await this.scheduleMachineExpiry(body.payload);
      }

      const message = JSON.stringify({
        type,
        payload: body.payload ?? null,
        ts: Date.now(),
      });

      const sockets = this.state.getWebSockets();
      let delivered = 0;

      for (const socket of sockets) {
        try {
          socket.send(message);
          delivered += 1;
        } catch {
          // A stale socket is ignored. Hibernation lifecycle hooks handle close/error.
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          delivered,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'WEBSOCKET_REQUIRED',
        }),
        {
          status: 426,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async alarm(): Promise<void> {
    await this.releaseExpiredMachinesAtAlarm();
    await this.scheduleNextMachineExpiry();
  }

  private async scheduleMachineExpiry(payload: unknown): Promise<void> {
    const machine =
      payload && typeof payload === 'object'
        ? (payload as { machine?: unknown }).machine
        : null;

    if (!machine || typeof machine !== 'object') return;

    const expectedEndAt =
      typeof (machine as { expectedEndAt?: unknown }).expectedEndAt === 'string'
        ? (machine as { expectedEndAt: string }).expectedEndAt
        : null;

    if (!expectedEndAt) {
      await this.scheduleNextMachineExpiry();
      return;
    }

    const expectedEndMs = Date.parse(expectedEndAt);
    if (!Number.isFinite(expectedEndMs)) return;

    const currentAlarm = await this.state.storage.getAlarm();

    if (currentAlarm === null || expectedEndMs < currentAlarm) {
      await this.state.storage.setAlarm(Math.max(Date.now(), expectedEndMs));
    }
  }

  private async scheduleNextMachineExpiry(): Promise<void> {
    const next = await this.env.DB
      .prepare(
        `
        SELECT MIN(expected_end_at) AS next_expected_end_at
        FROM machines
        WHERE status = 'IN_USE'
          AND expected_end_at IS NOT NULL
        `,
      )
      .first<{ next_expected_end_at: string | null }>();

    const nextExpectedEndAt = next?.next_expected_end_at || null;
    if (!nextExpectedEndAt) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const nextMs = Date.parse(nextExpectedEndAt);
    if (!Number.isFinite(nextMs)) {
      await this.state.storage.deleteAlarm();
      return;
    }

    await this.state.storage.setAlarm(Math.max(Date.now(), nextMs));
  }

  private async releaseExpiredMachinesAtAlarm(): Promise<void> {
    const nowIso = new Date().toISOString();

    const expired = await this.env.DB
      .prepare(
        `
        SELECT
          machine_id,
          machine_type,
          machine_number,
          started_at,
          expected_end_at,
          activated_by
        FROM machines
        WHERE status = 'IN_USE'
          AND started_at IS NOT NULL
          AND expected_end_at IS NOT NULL
          AND expected_end_at <= ?
        `,
      )
      .bind(nowIso)
      .all<{
        machine_id: string;
        machine_type: 'WASHER' | 'DRYER';
        machine_number: number;
        started_at: string | null;
        expected_end_at: string | null;
        activated_by: string | null;
      }>();

    for (const machine of expired.results ?? []) {
      const startedAt = machine.started_at;
      const endedAt = machine.expected_end_at;
      const activatedBy = machine.activated_by;

      if (!startedAt || !endedAt || !activatedBy) continue;

      const operationId =
        `machine_op_${machine.machine_id}_${Date.parse(endedAt)}`;

      const durationSeconds = Math.max(
        0,
        Math.round(
          (Date.parse(endedAt) - Date.parse(startedAt)) / 1000,
        ),
      );

      await this.env.DB
        .prepare(
          `
          INSERT OR IGNORE INTO machine_operations (
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
          startedAt,
          endedAt,
          durationSeconds,
          activatedBy,
          endedAt,
        )
        .run();

      const update = await this.env.DB
        .prepare(
          `
          UPDATE machines
          SET
            status = 'IDLE',
            started_at = NULL,
            expected_end_at = NULL,
            activated_by = NULL
          WHERE machine_id = ?
            AND status = 'IN_USE'
            AND expected_end_at = ?
          `,
        )
        .bind(machine.machine_id, endedAt)
        .run();

      if (update.meta.changes !== 1) continue;

      await this.broadcastMachineIdle({
        machineId: machine.machine_id,
        type: machine.machine_type,
        machineNumber: machine.machine_number,
        status: 'IDLE',
        statusLabel: 'IDLE',
        durationMinutes: machine.machine_type === 'DRYER' ? 50 : 32,
        startedAt: null,
        expectedEndAt: null,
        remainingSeconds: 0,
        activatedBy: null,
      });
    }
  }

  private async broadcastMachineIdle(machine: unknown): Promise<void> {
    const message = JSON.stringify({
      type: 'MACHINE_UPDATED',
      payload: { machine },
      ts: Date.now(),
    });

    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Ignore stale sockets.
      }
    }
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Server-push only. Client application messages are not accepted.
  }

  webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // Hibernation lifecycle hook.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Hibernation lifecycle hook.
  }
}

export async function broadcastRealtime(
  env: Env,
  type: string,
  payload: unknown = null,
): Promise<void> {
  const id = env.REALTIME_HUB.idFromName('global');
  const stub = env.REALTIME_HUB.get(id);

  const response = await stub.fetch(
    'https://realtime.internal/broadcast',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        type,
        payload,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Realtime broadcast failed: ${response.status}`);
  }
}
