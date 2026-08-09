import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import webpush from "web-push";
import { sql } from "./db";

function key() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return createHash("sha256").update(process.env.AUTH_SECRET).digest();
}

export function sealSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function unsealSecret(value: string) {
  const [iv, tag, encrypted] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export async function getSettings(keys: string[]) {
  const rows = await sql().query(
    `SELECT key,value FROM app_settings WHERE key=ANY($1::text[])`,
    [keys],
  );
  return Object.fromEntries(
    rows.map((row) => [String(row.key), String(row.value)]),
  );
}

export async function saveSettings(values: Record<string, string>) {
  for (const [settingKey, value] of Object.entries(values)) {
    await sql().query(
      `INSERT INTO app_settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
      [settingKey, value],
    );
  }
}

export async function getPushConfiguration() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@mappa.local",
    };
  if (Boolean(process.env.VAPID_PUBLIC_KEY) !== Boolean(process.env.VAPID_PRIVATE_KEY))
    console.warn(
      JSON.stringify({
        event: "push.vapid.partial_env",
        message:
          "A configuração VAPID do ambiente está incompleta. O Postgres será usado como fonte consistente.",
      }),
    );
  let values = await getSettings([
    "vapid_public_key",
    "vapid_private_key",
    "vapid_subject",
  ]);
  if (values.vapid_public_key && values.vapid_private_key) {
    try {
      return {
        publicKey: values.vapid_public_key,
        privateKey: unsealSecret(values.vapid_private_key),
        subject:
          values.vapid_subject ||
          process.env.VAPID_SUBJECT ||
          "mailto:admin@mappa.local",
      };
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "push.vapid.decrypt_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@mappa.local";
  await sql().query(
    `INSERT INTO app_settings(key,value) VALUES
      ('vapid_public_key',$1),('vapid_private_key',$2),('vapid_subject',$3)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
    [generated.publicKey, sealSecret(generated.privateKey), subject],
  );
  values = await getSettings([
    "vapid_public_key",
    "vapid_private_key",
    "vapid_subject",
  ]);
  console.info(
    JSON.stringify({
      event: "push.vapid.generated",
      message: "Um par VAPID consistente foi gerado e persistido no Postgres.",
    }),
  );
  return {
    publicKey: values.vapid_public_key,
    privateKey: unsealSecret(values.vapid_private_key),
    subject: values.vapid_subject || subject,
  };
}
