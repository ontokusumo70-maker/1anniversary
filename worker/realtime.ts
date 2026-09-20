import type { Env } from './index';

/**
 * RealtimeHub is the Durable Object endpoint for the application's
 * future event-driven WebSocket layer.
 *
 * Stage 1 intentionally does not broadcast application data yet.
 * It only establishes a Hibernation-compatible WebSocket endpoint so
 * the Durable Object can be deployed safely before frontend integration.
 */
export class RealtimeHub {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
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
    // Stage 1: no application messages are accepted or generated.
    // Application broadcast logic is introduced only after the endpoint
    // is deployed and verified independently.
  }

  webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // Hibernation-compatible close hook. No application state is changed.
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Intentionally empty in Stage 1.
  }
}

