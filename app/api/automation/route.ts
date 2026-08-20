import { NextRequest, NextResponse } from "next/server";
import { ensureDatabase, sql } from "@/lib/db";
import { notifyUsers } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bahiaParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

async function sendRequestReminders(hour: number) {
  if (hour < 8 || hour >= 21)
    return { skipped: true, reason: "quiet_hours", reviewers: 0 };
  const db = sql();
  const pending = await db.query(
    `SELECT count(*)::int count,min(created_at) oldest FROM booking_requests
     WHERE status='pending' AND created_at<=now()-interval '30 minutes'`,
  );
  const count = Number(pending[0]?.count) || 0;
  if (!count) return { skipped: true, reason: "no_pending_requests", reviewers: 0 };

  const reviewers = await db.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.active=true AND u.deleted_at IS NULL AND u.is_god=false
       AND u.request_reminders_enabled=true AND r.permissions ? 'booking.review'
       AND (u.last_request_reminder_at IS NULL OR u.last_request_reminder_at<=now()-interval '29 minutes')`,
  );
  const reviewerIds = reviewers.map((reviewer) => String(reviewer.id));
  if (!reviewerIds.length)
    return { skipped: true, reason: "no_eligible_reviewers", reviewers: 0 };

  await notifyUsers(reviewerIds, {
    title: "Solicitações aguardando análise",
    body: `${count} solicitação(ões) ainda aguardam resposta. Abra o Mappa de Salas para analisar.`,
    url: "/?tab=requests",
    tag: "pending-request-reminder",
  });
  await db.query(
    `UPDATE users SET last_request_reminder_at=now() WHERE id=ANY($1::uuid[])`,
    [reviewerIds],
  );
  return { skipped: false, reviewers: reviewerIds.length, pendingRequests: count };
}

async function runDailyRetention(date: string, hour: number) {
  if (hour !== 2) return { skipped: true, reason: "outside_retention_hour" };
  const db = sql();
  const lock = await db.query(
    `INSERT INTO app_settings(key,value) VALUES ('retention_last_run',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
     WHERE app_settings.value<>EXCLUDED.value RETURNING value`,
    [date],
  );
  if (!lock.length) return { skipped: true, reason: "already_ran_today" };

  await db.query(
    `INSERT INTO retention_rollups(month,actor_key,action,event_count)
     SELECT date_trunc('month',created_at)::date,coalesce(actor_id::text,'system'),action,count(*)::int
     FROM audit_log WHERE created_at<now()-interval '90 days'
     GROUP BY 1,2,3
     ON CONFLICT(month,actor_key,action) DO UPDATE
     SET event_count=retention_rollups.event_count+EXCLUDED.event_count`,
  );
  await db.query(
    `UPDATE booking_requests SET status='cancelled',updated_at=now()
     WHERE status='pending' AND created_at<now()-interval '90 days'`,
  );
  const deleted = await Promise.all([
    db.query(`DELETE FROM notifications WHERE created_at<now()-interval '90 days' RETURNING id`),
    db.query(`DELETE FROM notification_broadcasts WHERE created_at<now()-interval '90 days' RETURNING id`),
    db.query(`DELETE FROM feedback_reports WHERE status='resolved' AND created_at<now()-interval '90 days' RETURNING id`),
    db.query(`DELETE FROM room_issues WHERE status='resolved' AND resolved_at<now()-interval '90 days' RETURNING id`),
    db.query(`DELETE FROM booking_requests WHERE status<>'pending' AND created_at<now()-interval '90 days' RETURNING id`),
    db.query(`DELETE FROM audit_log WHERE created_at<now()-interval '90 days' RETURNING id`),
  ]);
  const reservations = await db.query(
    `DELETE FROM reservations WHERE ends_at<now()-interval '90 days' RETURNING id`,
  );
  return {
    skipped: false,
    deleted: deleted.map((rows) => rows.length).reduce((sum, value) => sum + value, 0) + reservations.length,
  };
}

export async function GET(request: NextRequest) {
  const expected = process.env.REMINDER_CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`)
    return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
  await ensureDatabase();
  const { date, hour } = bahiaParts();
  const [reminders, retention] = await Promise.all([
    sendRequestReminders(hour),
    runDailyRetention(date, hour),
  ]);
  console.info(
    JSON.stringify({ event: "automation.completed", date, hour, reminders, retention }),
  );
  return NextResponse.json({ ok: true, date, hour, reminders, retention });
}
