import webpush from "web-push";
import { sql } from "./db";
import { getPushConfiguration } from "./settings";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};
export type PushDeliveryResult = {
  configured: boolean;
  subscriptions: number;
  delivered: number;
  removed: number;
  failed: number;
};

const emptyDelivery = (configured = false): PushDeliveryResult => ({
  configured,
  subscriptions: 0,
  delivered: 0,
  removed: 0,
  failed: 0,
});

async function configured() {
  const configuration = await getPushConfiguration();
  if (!configuration) return false;
  webpush.setVapidDetails(
    configuration.subject,
    configuration.publicKey,
    configuration.privateKey,
  );
  return true;
}

export async function pushToUsers(userIds: string[], payload: PushPayload) {
  try {
    if (!userIds.length) return emptyDelivery(true);
    if (!(await configured())) {
      console.warn(
        JSON.stringify({
          event: "push.delivery.skipped",
          reason: "vapid_not_configured",
          users: userIds.length,
        }),
      );
      return emptyDelivery(false);
    }
    const subscriptions = await sql().query(
      `SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=ANY($1::uuid[])`,
      [userIds],
    );
    if (!subscriptions.length) {
      console.warn(
        JSON.stringify({
          event: "push.delivery.skipped",
          reason: "no_subscriptions",
          users: userIds.length,
        }),
      );
      return emptyDelivery(true);
    }
    const outcomes = await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(payload),
            { TTL: 86400 },
          );
          return "delivered" as const;
        } catch (error) {
          const status =
            typeof error === "object" && error && "statusCode" in error
              ? Number((error as { statusCode?: number }).statusCode)
              : 0;
          if (status === 404 || status === 410) {
            await sql().query(`DELETE FROM push_subscriptions WHERE id=$1`, [
              subscription.id,
            ]);
            return "removed" as const;
          }
          console.error(
            JSON.stringify({
              event: "push.delivery.failed",
              status,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return "failed" as const;
        }
      }),
    );
    const result: PushDeliveryResult = {
      configured: true,
      subscriptions: subscriptions.length,
      delivered: outcomes.filter((outcome) => outcome === "delivered").length,
      removed: outcomes.filter((outcome) => outcome === "removed").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
    };
    console.info(
      JSON.stringify({
        event: "push.delivery.completed",
        users: userIds.length,
        ...result,
      }),
    );
    return result;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "push.delivery.prepare_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ...emptyDelivery(false), failed: 1 };
  }
}

export async function notifyUsers(userIds: string[], payload: PushPayload) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueUserIds.length) return emptyDelivery(true);
  await sql().query(
    `INSERT INTO notifications(user_id,title,body,url)
     SELECT u.id,$2,$3,$4 FROM users u
     WHERE u.id=ANY($1::uuid[]) AND u.active=true AND u.deleted_at IS NULL`,
    [uniqueUserIds, payload.title, payload.body, payload.url || "/"],
  );
  return pushToUsers(uniqueUserIds, payload);
}

export async function notifyPermission(
  permission: string,
  payload: PushPayload,
) {
  const users = await sql().query(
    `SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? $1)`,
    [permission],
  );
  return notifyUsers(
    users.map((user) => String(user.id)),
    payload,
  );
}

export async function notifyAnyRoomRequesters(
  requestedDate: string,
  payload: PushPayload,
) {
  const users = await sql().query(
    `SELECT DISTINCT requester_id id FROM booking_requests
     WHERE status='pending' AND room_id IS NULL AND requested_date=$1::date`,
    [requestedDate],
  );
  return notifyUsers(
    users.map((user) => String(user.id)),
    payload,
  );
}

export async function pushToPermission(
  permission: string,
  payload: PushPayload,
) {
  try {
    const users = await sql().query(
      `SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.active=true AND u.deleted_at IS NULL AND (u.is_god=true OR r.permissions ? $1)`,
      [permission],
    );
    await pushToUsers(
      users.map((user) => String(user.id)),
      payload,
    );
  } catch (error) {
    console.error("Falha ao localizar destinatários de notificação", error);
  }
}

export async function pushToAnyRoomRequesters(
  requestedDate: string,
  payload: PushPayload,
) {
  try {
    const users = await sql().query(
      `SELECT DISTINCT requester_id id FROM booking_requests
      WHERE status='pending' AND room_id IS NULL AND requested_date=$1::date`,
      [requestedDate],
    );
    await pushToUsers(
      users.map((user) => String(user.id)),
      payload,
    );
  } catch (error) {
    console.error("Falha ao localizar solicitações por qualquer sala", error);
  }
}
