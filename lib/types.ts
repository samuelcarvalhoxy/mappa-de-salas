export const PERMISSIONS = [
  "booking.create_own",
  "booking.create_all",
  "booking.manage_all",
  "booking.request",
  "booking.review",
  "booking.checkout_own",
  "booking.checkout_all",
  "room.manage",
  "issue.resolve",
  "notification.send",
  "access.report",
  "user.manage",
  "user.delete",
  "security.reset",
  "role.manage",
  "audit.view",
  "stats.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type CurrentUser = {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  roleColor: string;
  isGod: boolean;
  isOwnerGod: boolean;
  permissions: Permission[];
};

export type Room = {
  id: string;
  name: string;
  location: string;
  kind: "physical" | "virtual" | "other";
  capacity: number;
  resources: string;
  networkStatus: string;
  chairs: number;
  tables: number;
  workstations: number;
  active: boolean;
};

export type Reservation = {
  id: string;
  roomId: string;
  roomName?: string;
  userId: string;
  userName: string;
  userUsername?: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  shareable: boolean;
  expectedPeople: number;
  status: "reserved" | "cancelled";
  createdBy: string;
  creatorName: string;
  seriesId: string | null;
};

export type DevelopmentMember = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  profileUrl: string;
  displayOrder: number;
};

export type FeedbackReport = {
  id: string;
  type: "bug" | "suggestion";
  category: string;
  title: string;
  description: string;
  reporterName: string;
  reporterEmail: string;
  status: "open" | "in_review" | "resolved";
  createdAt: string;
};

export type SystemNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationTemplate = {
  id: string;
  name: string;
  title: string;
  body: string;
  createdAt: string;
};

export type NotificationBroadcast = {
  id: string;
  senderName: string;
  title: string;
  body: string;
  audienceLabel: string;
  recipients: string[];
  createdAt: string;
};

export type RoomIssue = {
  id: string;
  roomId: string;
  reporterId: string;
  reporterName: string;
  description: string;
  ticketOpened: boolean;
  ticketReference: string;
  status: "open" | "resolved";
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type BookingRequest = {
  id: string;
  requesterId: string;
  requesterName: string;
  roomId: string | null;
  roomName: string | null;
  reason: string;
  requestedDate: string;
  startTime: string;
  endTime: string;
  shareable: boolean;
  expectedPeople: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewComment: string;
  reviewerName: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  urgent: boolean;
  urgentAcknowledgedAt: string | null;
};

export type Role = {
  id: string;
  name: string;
  color: string;
  permissions: Permission[];
  system: boolean;
};
export type ManagedUser = {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  active: boolean;
  isGod: boolean;
  isOwnerGod: boolean;
  hasSecurityAnswers: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  loginCount: number;
  requestRemindersEnabled: boolean;
};

export type AppState = {
  configured: boolean;
  now: string;
  currentUser: CurrentUser | null;
  rooms: Room[];
  reservations: Reservation[];
  issues: RoomIssue[];
  requests: BookingRequest[];
  roles: Role[];
  users: ManagedUser[];
  developmentTeam: DevelopmentMember[];
  feedbackReports: FeedbackReport[];
  notifications: SystemNotification[];
  notificationTemplates: NotificationTemplate[];
  notificationBroadcasts: NotificationBroadcast[];
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  audit: {
    id: string;
    actorName: string;
    action: string;
    details: string;
    createdAt: string;
  }[];
  pushPublicKey: string;
};
