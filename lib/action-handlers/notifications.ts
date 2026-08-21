import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { notifyUsers } from "@/lib/push";
import type { Permission } from "@/lib/types";

type NotificationActionContext = {
  action: string;
  body: Record<string, unknown>;
  db: NeonQueryFunction<false, false>;
  actor: Record<string, unknown>;
  requirePermission: (permission: Permission) => boolean;
  audit: (details: string) => Promise<unknown>;
};

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export async function handleNotificationAction({
  action,
  body,
  db,
  actor,
  requirePermission,
  audit,
}: NotificationActionContext) {
  const actorId = String(actor.id || "");
  const actorIsGod = Boolean(actor.is_god);

  if (action === "notification.template_save") {
    if (!requirePermission("notification.send"))
      return fail("Sem permissão para administrar modelos de notificação.", 403);
    const id = body.id ? String(body.id) : null;
    const name = clean(body.name, 80);
    const title = clean(body.title, 120);
    const message = clean(body.body, 1200);
    if (name.length < 2 || title.length < 2 || message.length < 3)
      return fail("Preencha nome, título e mensagem do modelo.");
    if (id) {
      const updated = await db.query(
        `UPDATE notification_templates SET name=$1,title=$2,body=$3,updated_at=now() WHERE id=$4 RETURNING id`,
        [name, title, message, id],
      );
      if (!updated.length) return fail("Modelo não encontrado.", 404);
    } else {
      await db.query(
        `INSERT INTO notification_templates(name,title,body,created_by) VALUES ($1,$2,$3,$4)`,
        [name, title, message, actorId],
      );
    }
    await audit(`Modelo de notificação ${name} salvo`);
    return NextResponse.json({ ok: true });
  }

  if (action === "notification.template_delete") {
    if (!requirePermission("notification.send"))
      return fail("Sem permissão para excluir modelos de notificação.", 403);
    const removed = await db.query(
      `DELETE FROM notification_templates WHERE id=$1 RETURNING name`,
      [String(body.id || "")],
    );
    if (!removed.length) return fail("Modelo não encontrado.", 404);
    await audit(`Modelo de notificação ${removed[0].name} excluído`);
    return NextResponse.json({ ok: true });
  }

  if (action === "notification.send") {
    if (!requirePermission("notification.send"))
      return fail("Sem permissão para enviar notificações.", 403);
    const title = clean(body.title, 120);
    const message = clean(body.body, 1200);
    const audienceType = String(body.audienceType || "");
    const audienceId = body.audienceId ? String(body.audienceId) : "";
    if (title.length < 2 || message.length < 3)
      return fail("Informe o título e a mensagem.");

    let recipients: Record<string, unknown>[] = [];
    let audienceLabel = "";
    if (audienceType === "all") {
      recipients = await db.query(
        `SELECT id,name FROM users WHERE active=true AND deleted_at IS NULL ORDER BY name`,
      );
      audienceLabel = "Todos os usuários";
    } else if (audienceType === "role" && audienceId) {
      const role = await db.query(`SELECT name FROM roles WHERE id=$1 LIMIT 1`, [
        audienceId,
      ]);
      if (!role.length) return fail("Perfil não encontrado.", 404);
      recipients = await db.query(
        `SELECT id,name FROM users WHERE role_id=$1 AND active=true AND deleted_at IS NULL ORDER BY name`,
        [audienceId],
      );
      audienceLabel = `Perfil ${role[0].name}`;
    } else if (audienceType === "user" && audienceId) {
      recipients = await db.query(
        `SELECT id,name FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL`,
        [audienceId],
      );
      if (!recipients.length) return fail("Usuário não encontrado.", 404);
      audienceLabel = String(recipients[0].name);
    } else {
      return fail("Selecione um destinatário válido.");
    }

    const userIds = recipients.map((recipient) => String(recipient.id));
    if (!userIds.length) return fail("Nenhum usuário ativo nesse público.", 409);
    const delivery = await notifyUsers(userIds, {
      title,
      body: message,
      url: "/",
      tag: `broadcast-${Date.now()}`,
    });
    await db.query(
      `INSERT INTO notification_broadcasts(sender_id,title,body,audience_label,recipients)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        actorId,
        title,
        message,
        audienceLabel,
        JSON.stringify(recipients.map((recipient) => String(recipient.name))),
      ],
    );
    await audit(`Notificação enviada para ${audienceLabel}, ${userIds.length} destinatário(s)`);
    return NextResponse.json({ ok: true, recipientCount: userIds.length, delivery });
  }

  if (action === "notification.reminder_preference") {
    if (!actorIsGod)
      return fail("Somente um usuário God pode alterar lembretes recorrentes.", 403);
    const targetId = String(body.userId || "");
    const target = await db.query(
      `SELECT u.id,u.is_god,r.permissions FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND u.active=true AND u.deleted_at IS NULL LIMIT 1`,
      [targetId],
    );
    if (!target.length) return fail("Usuário não encontrado.", 404);
    if (target[0].is_god)
      return fail("Usuários God são isentos de lembretes recorrentes.", 403);
    const targetPermissions = Array.isArray(target[0].permissions)
      ? target[0].permissions.map(String)
      : [];
    if (!targetPermissions.includes("booking.review"))
      return fail("Este usuário não analisa solicitações.");
    await db.query(
      `UPDATE users SET request_reminders_enabled=$1,last_request_reminder_at=NULL WHERE id=$2`,
      [body.enabled === true, targetId],
    );
    await audit(
      `Lembretes de solicitações ${body.enabled === true ? "ativados" : "desativados"} para um analista`,
    );
    return NextResponse.json({ ok: true });
  }

  return null;
}
