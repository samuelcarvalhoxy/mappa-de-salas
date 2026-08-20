import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { ensureDatabase, getUserWithRole, permissionsOf, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type RankingRow = { user_id: string; user_name: string; count: number };

export async function GET() {
  await ensureDatabase();
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId)
    return NextResponse.json({ error: "Faça login novamente." }, { status: 401 });
  const actor = await getUserWithRole(sessionUserId);
  if (!actor || !actor.active)
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const permissions = permissionsOf(actor);
  if (!actor.is_god && !permissions.includes("stats.view"))
    return NextResponse.json(
      { error: "Seu perfil não pode consultar rankings." },
      { status: 403 },
    );

  const db = sql();
  const [issuesReported, ticketsOpened, issuesResolved, requests, cancellations, bugs, suggestions] =
    await Promise.all([
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM room_issues ri
         JOIN users u ON u.id=ri.reporter_id WHERE ri.created_at>=now()-interval '90 days'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM room_issues ri
         JOIN users u ON u.id=ri.reporter_id WHERE ri.created_at>=now()-interval '90 days' AND ri.ticket_opened=true
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM room_issues ri
         JOIN users u ON u.id=ri.resolved_by WHERE ri.resolved_at>=now()-interval '90 days'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM booking_requests br
         JOIN users u ON u.id=br.requester_id WHERE br.created_at>=now()-interval '90 days'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM audit_log a
         JOIN users u ON u.id=a.actor_id WHERE a.created_at>=now()-interval '90 days' AND a.action='request.cancel'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM feedback_reports f
         JOIN users u ON u.id=f.reporter_id WHERE f.created_at>=now()-interval '90 days' AND f.type='bug'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
      db.query(
        `SELECT u.id user_id,u.name user_name,count(*)::int count FROM feedback_reports f
         JOIN users u ON u.id=f.reporter_id WHERE f.created_at>=now()-interval '90 days' AND f.type='suggestion'
         GROUP BY u.id,u.name ORDER BY count DESC,u.name LIMIT 10`,
      ),
    ]);

  const map = (rows: RankingRow[]) =>
    rows.map((row) => ({
      userId: row.user_id,
      userName: row.user_name,
      count: Number(row.count),
    }));
  return NextResponse.json({
    periodDays: 90,
    rankings: [
      { id: "issues_reported", label: "Problemas de sala reportados", rows: map(issuesReported as RankingRow[]) },
      { id: "tickets_opened", label: "Chamados informados como abertos", rows: map(ticketsOpened as RankingRow[]) },
      { id: "issues_resolved", label: "Problemas de sala resolvidos", rows: map(issuesResolved as RankingRow[]) },
      { id: "requests_created", label: "Solicitações de sala criadas", rows: map(requests as RankingRow[]) },
      { id: "requests_cancelled", label: "Solicitações canceladas", rows: map(cancellations as RankingRow[]) },
      { id: "bugs_reported", label: "Bugs reportados", rows: map(bugs as RankingRow[]) },
      { id: "suggestions_sent", label: "Sugestões enviadas", rows: map(suggestions as RankingRow[]) },
    ],
  });
}
