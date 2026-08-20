import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import {
  ensureDatabase,
  getUserWithRole,
  hasDatabase,
  permissionsOf,
  sql,
} from "@/lib/db";
import { getPushConfiguration } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const empty = {
    currentUser: null,
    rooms: [],
    reservations: [],
    issues: [],
    requests: [],
    roles: [],
    users: [],
    developmentTeam: [],
    feedbackReports: [],
    notifications: [],
    notificationTemplates: [],
    notificationBroadcasts: [],
    shifts: [],
    audit: [],
    pushPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    now: new Date().toISOString(),
  };
  if (!hasDatabase()) return NextResponse.json({ configured: false, ...empty });
  await ensureDatabase();
  const pushConfiguration = await getPushConfiguration().catch((error) => {
    console.error(
      JSON.stringify({
        event: "push.configuration.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  });
  const userId = await getSessionUserId();
  if (!userId)
    return NextResponse.json({
      configured: true,
      ...empty,
      pushPublicKey: pushConfiguration?.publicKey || "",
    });
  const user = await getUserWithRole(userId);
  if (!user || !user.active)
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  const permissions = permissionsOf(user);
  const db = sql();
  await db.query(
    `UPDATE users SET last_seen_at=now() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at<now()-interval '5 minutes')`,
    [user.id],
  );
  const canReviewRequests =
    user.is_god || permissions.includes("booking.review");
  const canRequest = user.is_god || permissions.includes("booking.request");
  const canSendNotifications =
    user.is_god || permissions.includes("notification.send");
  const [
    rooms,
    reservations,
    issues,
    requests,
    shifts,
    roles,
    users,
    audit,
    developmentTeam,
    feedbackReports,
    notifications,
    notificationTemplates,
    notificationBroadcasts,
  ] = await Promise.all([
      db.query(
        `SELECT id,name,location,kind,capacity,resources,network_status,chairs,tables,workstations,active FROM rooms WHERE active=true ORDER BY location,name`,
      ),
      db.query(`SELECT rs.id,rs.room_id,rs.user_id,u.name user_name,u.username user_username,rs.reason,rs.starts_at,rs.ends_at,rs.shareable,
      rs.expected_people,rs.status,rs.created_by,c.name creator_name,rs.series_id FROM reservations rs JOIN users u ON u.id=rs.user_id
      JOIN users c ON c.id=rs.created_by WHERE rs.ends_at > now() - interval '45 days' AND rs.starts_at < now() + interval '120 days' AND rs.status NOT IN ('cancelled') ORDER BY rs.starts_at`),
      db.query(`SELECT ri.id,ri.room_id,ri.reporter_id,u.name reporter_name,ri.description,ri.ticket_opened,ri.ticket_reference,
      ri.status,rv.name resolved_by_name,ri.created_at,ri.resolved_at FROM room_issues ri JOIN users u ON u.id=ri.reporter_id
      LEFT JOIN users rv ON rv.id=ri.resolved_by WHERE ri.status='open' OR ri.resolved_at>now()-interval '30 days' ORDER BY ri.status,ri.created_at DESC`),
      canReviewRequests || canRequest
        ? db.query(
            `SELECT br.id,br.requester_id,u.name requester_name,br.room_id,r.name room_name,br.reason,
      br.requested_date::text,br.start_time,br.end_time,br.shareable,br.expected_people,br.status,br.review_comment,
      br.urgent,br.urgent_acknowledged_at,
      rv.name reviewer_name,br.reviewed_at,br.created_at,br.updated_at
      FROM booking_requests br JOIN users u ON u.id=br.requester_id LEFT JOIN rooms r ON r.id=br.room_id
      LEFT JOIN users rv ON rv.id=br.reviewed_by
      WHERE ($1::boolean OR br.requester_id=$2) AND (br.status='pending' OR br.created_at>now()-interval '120 days')
      ORDER BY CASE WHEN br.status='pending' THEN 0 ELSE 1 END,br.requested_date,br.start_time,br.created_at DESC`,
            [canReviewRequests, user.id],
          )
        : Promise.resolve([]),
      db.query(
        `SELECT id,name,start_time,end_time FROM shifts ORDER BY start_time`,
      ),
      permissions.includes("role.manage") ||
      permissions.includes("user.manage") ||
      permissions.includes("notification.send") ||
      permissions.includes("audit.view")
        ? db.query(
            `SELECT id,name,color,permissions,system FROM roles ORDER BY system DESC,name`,
          )
        : Promise.resolve([]),
      permissions.includes("user.manage") ||
      permissions.includes("user.delete") ||
      permissions.includes("security.reset") ||
      permissions.includes("stats.view") ||
      permissions.includes("audit.view") ||
      permissions.includes("notification.send") ||
      permissions.includes("booking.create_all") ||
      permissions.includes("booking.manage_all") ||
      user.is_god
        ? db.query(`SELECT u.id,u.name,u.username,u.role_id,r.name role_name,u.active,u.is_god,u.is_owner_god,
      jsonb_array_length(u.security_answers) security_answer_count,u.last_login_at,u.last_seen_at,u.login_count,u.request_reminders_enabled
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL ORDER BY u.name`)
        : Promise.resolve([]),
      permissions.includes("audit.view")
        ? db.query(
            `SELECT a.id,coalesce(u.name,'Sistema') actor_name,a.action,a.details,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100`,
          )
        : Promise.resolve([]),
      db.query(
        `SELECT id,name,role,email,phone,profile_url,display_order FROM development_team ORDER BY display_order,name`,
      ),
      user.is_god
        ? db.query(
            `SELECT id,type,category,title,description,reporter_name,reporter_email,status,created_at
             FROM feedback_reports ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,created_at DESC LIMIT 100`,
          )
        : Promise.resolve([]),
      db.query(
        `SELECT id,title,body,url,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [user.id],
      ),
      canSendNotifications
        ? db.query(
            `SELECT id,name,title,body,created_at FROM notification_templates ORDER BY name`,
          )
        : Promise.resolve([]),
      canSendNotifications
        ? db.query(
            `SELECT nb.id,coalesce(u.name,'Sistema') sender_name,nb.title,nb.body,nb.audience_label,nb.recipients,nb.created_at
             FROM notification_broadcasts nb LEFT JOIN users u ON u.id=nb.sender_id ORDER BY nb.created_at DESC LIMIT 100`,
          )
        : Promise.resolve([]),
    ]);
  return NextResponse.json({
    configured: true,
    now: new Date().toISOString(),
    currentUser: {
      id: user.id,
      name: user.name,
      username: user.username,
      roleId: user.role_id,
      roleName: user.role_name,
      roleColor: user.role_color,
      isGod: user.is_god,
      isOwnerGod: user.is_owner_god,
      permissions,
    },
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location,
      kind: r.kind,
      capacity: Number(r.capacity),
      resources: r.resources,
      networkStatus: r.network_status,
      chairs: Number(r.chairs),
      tables: Number(r.tables),
      workstations: Number(r.workstations),
      active: r.active,
    })),
    reservations: reservations.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      userId: r.user_id,
      userName: r.user_name,
      userUsername: r.user_username,
      reason: r.reason,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      shareable: r.shareable,
      expectedPeople: Number(r.expected_people),
      status: r.status,
      createdBy: r.created_by,
      creatorName: r.creator_name,
      seriesId: r.series_id,
    })),
    issues: issues.map((item) => ({
      id: item.id,
      roomId: item.room_id,
      reporterId: item.reporter_id,
      reporterName: item.reporter_name,
      description: item.description,
      ticketOpened: item.ticket_opened,
      ticketReference: item.ticket_reference,
      status: item.status,
      resolvedByName: item.resolved_by_name,
      createdAt: item.created_at,
      resolvedAt: item.resolved_at,
    })),
    requests: requests.map((item) => ({
      id: item.id,
      requesterId: item.requester_id,
      requesterName: item.requester_name,
      roomId: item.room_id,
      roomName: item.room_name,
      reason: item.reason,
      requestedDate: item.requested_date,
      startTime: item.start_time,
      endTime: item.end_time,
      shareable: item.shareable,
      expectedPeople: Number(item.expected_people),
      status: item.status,
      reviewComment: item.review_comment,
      reviewerName: item.reviewer_name,
      reviewedAt: item.reviewed_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      urgent: Boolean(item.urgent),
      urgentAcknowledgedAt: item.urgent_acknowledged_at,
    })),
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      startTime: s.start_time,
      endTime: s.end_time,
    })),
    roles,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      roleId: u.role_id,
      roleName: u.role_name,
      active: u.active,
      isGod: u.is_god,
      isOwnerGod: u.is_owner_god,
      hasSecurityAnswers: Number(u.security_answer_count) >= 2,
      lastLoginAt: u.last_login_at,
      lastSeenAt: u.last_seen_at,
      loginCount: Number(u.login_count) || 0,
      requestRemindersEnabled: Boolean(u.request_reminders_enabled),
    })),
    developmentTeam: developmentTeam.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      email: member.email,
      phone: member.phone,
      profileUrl: member.profile_url,
      displayOrder: Number(member.display_order),
    })),
    feedbackReports: feedbackReports.map((report) => ({
      id: report.id,
      type: report.type,
      category: report.category,
      title: report.title,
      description: report.description,
      reporterName: report.reporter_name,
      reporterEmail: report.reporter_email,
      status: report.status,
      createdAt: report.created_at,
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      url: notification.url,
      readAt: notification.read_at,
      createdAt: notification.created_at,
    })),
    notificationTemplates: notificationTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      title: template.title,
      body: template.body,
      createdAt: template.created_at,
    })),
    notificationBroadcasts: notificationBroadcasts.map((broadcast) => ({
      id: broadcast.id,
      senderName: broadcast.sender_name,
      title: broadcast.title,
      body: broadcast.body,
      audienceLabel: broadcast.audience_label,
      recipients: Array.isArray(broadcast.recipients)
        ? broadcast.recipients.map(String)
        : [],
      createdAt: broadcast.created_at,
    })),
    audit: audit.map((item) => ({
      id: item.id,
      actorName: item.actor_name,
      action: item.action,
      details: item.details,
      createdAt: item.created_at,
    })),
    pushPublicKey: pushConfiguration?.publicKey || "",
  });
}
