import type { Env } from './index';

/**
 * RealtimeHub is the Durable Object endpoint for the application's
 * WebSocket realtime layer.
 *
 * Stage 3A adds server-side broadcast support only.
 * No application event is emitted yet; existing routes are unchanged.
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
