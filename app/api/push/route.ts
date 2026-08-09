import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, sql } from "@/lib/db";
import { pushToUsers } from "@/lib/push";

export async function POST(request: NextRequest) {
  await ensureDatabase();
  const userId = await getSessionUserId();
  if (!userId)
    return NextResponse.json(
      { error: "Faça login novamente." },
      { status: 401 },
    );
  const user = await getUserWithRole(userId);
  if (!user || !user.active)
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.action === "unsubscribe") {
    await sql().query(
      `DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`,
      [userId, String(body.endpoint || "")],
    );
    console.info(
      JSON.stringify({ event: "push.subscription.removed", userId }),
    );
    return NextResponse.json({ ok: true });
  }
  if (body.action === "test") {
    const result = await pushToUsers([userId], {
      title: "Mappa de Salas",
      body: "Notificações ativadas neste dispositivo.",
      url: "/",
      tag: `push-test-${userId}`,
    });
    if (!result.configured)
      return NextResponse.json(
        { error: "O serviço Push ainda não está configurado." },
        { status: 503 },
      );
    if (!result.delivered)
      return NextResponse.json(
        {
          error:
            "A assinatura foi encontrada, mas o navegador não confirmou a entrega. Reconecte as notificações neste dispositivo.",
        },
        { status: 502 },
      );
    return NextResponse.json({ ok: true, delivery: result });
  }
  const endpoint = String(body.subscription?.endpoint || "");
  const p256dh = String(body.subscription?.keys?.p256dh || "");
  const auth = String(body.subscription?.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth)
    return NextResponse.json(
      { error: "Assinatura de notificação inválida." },
      { status: 400 },
    );
  await sql().query(
    `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES ($1,$2,$3,$4)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now()`,
    [userId, endpoint, p256dh, auth],
  );
  console.info(
    JSON.stringify({ event: "push.subscription.saved", userId }),
  );
  return NextResponse.json({ ok: true });
}
