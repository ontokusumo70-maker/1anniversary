import { handleGameRequest } from './routes/game';
import { handleMachineRequest } from './routes/machines';
import {
  handleOwnerExportRequest,
} from './routes/owner-export';
import { handleClaimRequest } from './routes/claim';
import { handleRewardRequest } from './routes/reward';
import { handleStaffRedeemRequest } from './routes/staff-redeem';
import { handleAuthRequest } from './routes/auth';
import { handleOwnerRequest } from './routes/owner';
import { handleAssetRequest } from './routes/assets';

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  STAFF_PHONE?: string;
  OWNER_PHONE_1?: string;
  OWNER_PHONE_2?: string;
  OTP_DELIVERY_URL?: string;
  OTP_DELIVERY_SECRET?: string;
  R2?: R2Bucket;
}

const JSON_HEADERS = {
  'Content-Type':
    'application/json; charset=utf-8',
};

function getAllowedOrigin(
  request: Request,
  env: Env,
): string | null {
  const configured =
    env.ALLOWED_ORIGIN?.trim();

  if (!configured) {
    return null;
  }

  const requestOrigin =
    request.headers.get('Origin');

  if (!requestOrigin) {
    return configured;
  }

  if (requestOrigin !== configured) {
    return null;
  }

  return configured;
}

function corsHeaders(
  origin: string,
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':
      origin,
    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization',
    'Vary':
      'Origin',
    'Cache-Control':
      'no-store',
  };
}

function json(
  data: unknown,
  status = 200,
  origin?: string,
): Response {
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
  };

  if (origin) {
    Object.assign(
      headers,
      corsHeaders(origin),
    );
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );
}

function withCors(
  response: Response,
  origin?: string,
): Response {
  const headers =
    new Headers(
      response.headers,
    );

  if (origin) {
    const securityHeaders =
      corsHeaders(origin);

    for (
      const [key, value]
      of Object.entries(
        securityHeaders,
      )
    ) {
      headers.set(key, value);
    }
  }

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

  if (!origin) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          'ORIGIN_NOT_ALLOWED',
      }),
      {
        status: 403,
        headers: {
          ...JSON_HEADERS,
          'Cache-Control':
            'no-store',
        },
      },
    );
  }

  if (
    request.method ===
    'OPTIONS'
  ) {
    return new Response(
      null,
      {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          'Access-Control-Max-Age':
            '86400',
        },
      },
    );
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/'
  ) {
    return json(
      {
        ok: true,
        service:
          'teras-laundry-1st-anniversary-worker',
        environment:
          env.ENVIRONMENT ??
          'production',
      },
      200,
      origin,
    );
  }

  const authResponse = await handleAuthRequest(request, env);
  if (authResponse.status !== 404) return withCors(authResponse, origin);

  const ownerResponse = await handleOwnerRequest(request, env);
  if (ownerResponse.status !== 404) return ownerResponse;

  const assetResponse = await handleAssetRequest(request, env);
  if (assetResponse.status !== 404) return assetResponse;

  if (
    request.method === 'GET' &&
    url.pathname === '/config'
  ) {
    return json(
      {
        ok: true,
        campaign:
          '10 HARI MENUJU 1 TAHUN',
        campaignStart:
          '2026-11-01',
        campaignEnd:
          '2026-11-10',
        game: {
          type:
            'Coin Catch',
          durationSeconds:
            15,
        },
        assets: {
          basePath: env.R2 ? '/r2-assets/' : '/assets/',
        },
        machineStatus: {
          washers: 5,
          dryers: 5,
          washerDurationMinutes:
            32,
          dryerDurationMinutes:
            50,
          selfService: {
            start: '07:00',
            end: '21:00',
            timezone:
              'Asia/Jakarta',
          },
          dropOff: {
            start: '07:00',
            end: '23:00',
            timezone:
              'Asia/Jakarta',
          },
        },
      },
      200,
      origin,
    );
  }

  const gameResponse =
    await handleGameRequest(
      request,
      env,
    );

  if (
    gameResponse.status !==
    404
  ) {
    return gameResponse;
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

  const claimResponse = await handleClaimRequest(request, env);
  if (claimResponse.status !== 404) {
    return claimResponse;
  }

  const rewardResponse = await handleRewardRequest(request, env);
  if (rewardResponse.status !== 404) {
    return rewardResponse;
  }

  const staffResponse = await handleStaffRedeemRequest(request, env);
  if (staffResponse.status !== 404) {
    return staffResponse;
  }

  return json(
    {
      ok: false,
      error:
        'NOT_FOUND',
      message:
        'Endpoint not found.',
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

      const origin =
        getAllowedOrigin(
          request,
          env,
        );

      return withCors(
        response,
        origin ??
          undefined,
      );
    } catch (error) {
      console.error(
        'Worker request error:',
        error,
      );

      const origin =
        getAllowedOrigin(
          request,
          env,
        );

      return json(
        {
          ok: false,
          error:
            'INTERNAL_ERROR',
        },
        500,
        origin ??
          undefined,
      );
    }
  },
};
