import type { NeonQueryFunction } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import type { Permission } from "@/lib/types";

type FacilityActionContext = {
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

export async function handleFacilityAction({
  action,
  body,
  db,
  actor,
  requirePermission,
  audit,
}: FacilityActionContext) {
  const actorId = String(actor.id || "");
  const actorIsGod = Boolean(actor.is_god);

  if (action === "development_team.save") {
    if (!actorIsGod)
      return fail("Somente usuários God podem editar esta equipe.", 403);
    const id = body.id ? String(body.id) : null;
    const name = String(body.name || "").trim().slice(0, 120);
    const role = String(body.role || "").trim().slice(0, 180);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 180);
    const phone = String(body.phone || "").trim().slice(0, 40);
    const profileUrl = String(body.profileUrl || "").trim().slice(0, 500);
    const displayOrder = Math.max(
      0,
      Math.min(999, Number(body.displayOrder) || 0),
    );
    if (name.length < 2 || role.length < 2)
      return fail("Informe o nome e a atuação do integrante.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail("Informe um e-mail válido.");
    if (profileUrl && !/^https?:\/\//i.test(profileUrl))
      return fail("O link do perfil deve começar com http:// ou https://.");
    if (id) {
      const updatedMember = await db.query(
        `UPDATE development_team SET name=$1,role=$2,email=$3,phone=$4,profile_url=$5,display_order=$6,updated_at=now()
         WHERE id=$7 RETURNING id`,
        [name, role, email, phone, profileUrl, displayOrder, id],
      );
      if (!updatedMember.length) return fail("Integrante não encontrado.", 404);
    } else {
      await db.query(
        `INSERT INTO development_team(name,role,email,phone,profile_url,display_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [name, role, email, phone, profileUrl, displayOrder],
      );
    }
    await audit(`Perfil de desenvolvimento de ${name} salvo`);
    return NextResponse.json({ ok: true });
  }

  if (action === "development_team.delete") {
    if (!actorIsGod)
      return fail("Somente usuários God podem editar esta equipe.", 403);
    const removed = await db.query(
      `DELETE FROM development_team WHERE id=$1 RETURNING name`,
      [String(body.id || "")],
    );
    if (!removed.length) return fail("Integrante não encontrado.", 404);
    await audit(
      `Integrante ${removed[0].name} removido da equipe de desenvolvimento`,
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "feedback.status") {
    if (!actorIsGod)
      return fail("Somente usuários God podem atualizar relatos.", 403);
    const status = String(body.status || "");
    if (!["open", "in_review", "resolved"].includes(status))
      return fail("Status de relato inválido.");
    const updatedReport = await db.query(
      `UPDATE feedback_reports SET status=$1,updated_at=now() WHERE id=$2 RETURNING title`,
      [status, String(body.id || "")],
    );
    if (!updatedReport.length) return fail("Relato não encontrado.", 404);
    await audit(`Relato ${updatedReport[0].title} atualizado para ${status}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "room.save") {
    if (!requirePermission("room.manage"))
      return fail("Sem permissão para administrar salas.", 403);
    const id = body.id ? String(body.id) : null;
    const name = String(body.name || "").trim();
    if (name.length < 2) return fail("Informe o nome da sala.");
    const infrastructure = [
      String(body.networkStatus || "Não informado"),
      Math.max(0, Number(body.chairs) || 0),
      Math.max(0, Number(body.tables) || 0),
      Math.max(0, Number(body.workstations) || 0),
    ];
    if (id)
      await db.query(
        `UPDATE rooms SET name=$1,location=$2,kind=$3,capacity=$4,resources=$5,network_status=$6,chairs=$7,tables=$8,workstations=$9 WHERE id=$10`,
        [
          name,
          String(body.location || ""),
          String(body.kind || "physical"),
          Math.max(1, Number(body.capacity) || 1),
          String(body.resources || ""),
          ...infrastructure,
          id,
        ],
      );
    else
      await db.query(
        `INSERT INTO rooms(name,location,kind,capacity,resources,network_status,chairs,tables,workstations) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          name,
          String(body.location || ""),
          String(body.kind || "physical"),
          Math.max(1, Number(body.capacity) || 1),
          String(body.resources || ""),
          ...infrastructure,
        ],
      );
    await audit(`Sala ${name} salva`);
    return NextResponse.json({ ok: true });
  }

  if (action === "room.disable") {
    if (!requirePermission("room.manage"))
      return fail("Sem permissão.", 403);
    await db.query(`UPDATE rooms SET active=false WHERE id=$1`, [
      String(body.id || ""),
    ]);
    await audit("Sala desativada");
    return NextResponse.json({ ok: true });
  }

  if (action === "issue.report") {
    const roomId = String(body.roomId || "");
    const description = String(body.description || "").trim();
    const ticketOpened = Boolean(body.ticketOpened);
    const ticketReference = String(body.ticketReference || "")
      .trim()
      .slice(0, 120);
    if (!roomId || description.length < 5)
      return fail("Descreva o problema da sala.");
    const room = await db.query(
      `SELECT name FROM rooms WHERE id=$1 AND active=true`,
      [roomId],
    );
    if (!room.length) return fail("Sala não encontrada.", 404);
    await db.query(
      `INSERT INTO room_issues(room_id,reporter_id,description,ticket_opened,ticket_reference) VALUES ($1,$2,$3,$4,$5)`,
      [roomId, actorId, description, ticketOpened, ticketReference],
    );
    await audit(`Problema reportado em ${room[0].name}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "issue.resolve") {
    const issueId = String(body.id || "");
    const openIssue = await db.query(
      `SELECT reporter_id FROM room_issues WHERE id=$1 AND status='open' LIMIT 1`,
      [issueId],
    );
    if (!openIssue.length)
      return fail("Problema não encontrado ou já resolvido.", 404);
    const isReporter = String(openIssue[0].reporter_id) === actorId;
    if (!isReporter && !requirePermission("issue.resolve"))
      return fail(
        "Somente quem registrou o problema ou um perfil autorizado pode resolvê-lo.",
        403,
      );
    const issue = await db.query(
      `UPDATE room_issues SET status='resolved',resolved_by=$1,resolved_at=now()
       WHERE id=$2 AND status='open' AND (reporter_id=$1 OR $3::boolean) RETURNING room_id`,
      [actorId, issueId, requirePermission("issue.resolve")],
    );
    if (!issue.length)
      return fail("Problema não encontrado ou já resolvido.", 404);
    await audit("Problema de sala marcado como resolvido");
    return NextResponse.json({ ok: true });
  }

  return null;
}
