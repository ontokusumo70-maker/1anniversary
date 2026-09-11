import { handleMachineRequest } from "./routes/machines";
import {
  handleOwnerExportRequest,
} from "./routes/owner-export";

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
}

const JSON_HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",
};

function json(
  data: unknown,
  status = 200,
  origin = "*",
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        "Access-Control-Allow-Origin":
          origin,
        "Access-Control-Allow-Methods":
          "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Customer-ID, X-Staff-ID, X-Owner-ID",
        "Cache-Control":
          "no-store",
      },
    },
  );
}

function getAllowedOrigin(
  request: Request,
  env: Env,
): string {
  const configured =
    env.ALLOWED_ORIGIN?.trim();

  if (!configured) {
    return "*";
  }

  const requestOrigin =
    request.headers.get("Origin");

  if (
    requestOrigin ===
    configured
  ) {
    return configured;
  }

  return configured;
}

function withCors(
  response: Response,
  origin: string,
): Response {
  const headers =
    new Headers(
      response.headers,
    );

  headers.set(
    "Access-Control-Allow-Origin",
    origin,
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS",
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Customer-ID, X-Staff-ID, X-Owner-ID",
  );

  headers.set(
    "Cache-Control",
    "no-store",
  );

  return new Response(
    response.body,
    {
      status:
        response.status,
      statusText:
        response.statusText,
      headers,
    },
  );
}

async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  const origin =
    getAllowedOrigin(
      request,
      env,
    );

  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":
            origin,
          "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Customer-ID, X-Staff-ID, X-Owner-ID",
          "Access-Control-Max-Age":
            "86400",
        },
      },
    );
  }

  if (
    request.method === "GET" &&
    url.pathname === "/"
  ) {
    return json(
      {
        ok: true,
        service:
          "teras-laundry-1st-anniversary-worker",
        environment:
          env.ENVIRONMENT ??
          "production",
      },
      200,
      origin,
    );
  }

  if (
    request.method === "GET" &&
    url.pathname === "/config"
  ) {
    return json(
      {
        ok: true,
        campaign:
          "10 HARI MENUJU 1 TAHUN",
        campaignStart:
          "2026-11-01",
        campaignEnd:
          "2026-11-10",
        game: {
          type:
            "Coin Catch",
          durationSeconds:
            15,
        },
        machineStatus: {
          washers: 5,
          dryers: 5,
          washerDurationMinutes:
            32,
          dryerDurationMinutes:
            50,
          selfService: {
            start: "07:00",
            end: "21:00",
            timezone:
              "Asia/Jakarta",
          },
          dropOff: {
            start: "07:00",
            end: "23:00",
            timezone:
              "Asia/Jakarta",
          },
        },
      },
      200,
      origin,
    );
  }

  const machineResponse =
    await handleMachineRequest(
      request,
      env,
    );

  if (
    machineResponse.status !==
    404
  ) {
    return machineResponse;
  }

  const ownerExportResponse =
    await handleOwnerExportRequest(
      request,
      env,
    );

  if (
    ownerExportResponse.status !==
    404
  ) {
    return ownerExportResponse;
  }

  return json(
    {
      ok: false,
      error: "NOT_FOUND",
      message:
        "Endpoint not found.",
    },
    404,
    origin,
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    try {
      const response =
        await handleRequest(
          request,
          env,
        );

      return withCors(
        response,
        getAllowedOrigin(
          request,
          env,
        ),
      );
    } catch (error) {
      console.error(
        "Worker request error:",
        error,
      );

      return json(
        {
          ok: false,
          error:
            "INTERNAL_ERROR",
        },
        500,
        getAllowedOrigin(
          request,
          env,
        ),
      );
    }
  },
};
