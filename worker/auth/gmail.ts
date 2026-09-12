export interface GmailEnv {
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  GMAIL_SENDER_EMAIL: string;
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createMimeMessage(
  sender: string,
  recipient: string,
  otp: string,
): string {
  const subject = "Kode OTP Teras Laundry";

  const body = [
    "Kode OTP Teras Laundry",
    "",
    `Kode OTP Anda: ${otp}`,
    "",
    "Kode OTP berlaku sesuai batas waktu yang ditentukan sistem.",
    "Jangan berikan kode ini kepada orang lain.",
  ].join("\r\n");

  return [
    `From: Teras Laundry <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

async function getAccessToken(env: GmailEnv): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail OAuth token request failed: ${errorText}`);
  }

  const data = await response.json() as {
    access_token?: string;
  };

  if (!data.access_token) {
    throw new Error("Gmail OAuth response did not contain access_token");
  }

  return data.access_token;
}

export async function sendOtpEmail(
  env: GmailEnv,
  recipient: string,
  otp: string,
): Promise<void> {
  const accessToken = await getAccessToken(env);

  const mimeMessage = createMimeMessage(
    env.GMAIL_SENDER_EMAIL,
    recipient,
    otp,
  );

  const raw = base64UrlEncode(mimeMessage);

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail send failed: ${errorText}`);
  }

  const data = await response.json() as {
    id?: string;
  };

  if (!data.id) {
    throw new Error("Gmail send response did not contain message id");
  }
}
