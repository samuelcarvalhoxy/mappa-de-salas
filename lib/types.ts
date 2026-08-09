export const PERMISSIONS = [
  "booking.create_own",
  "booking.create_all",
  "booking.manage_all",
  "booking.request",
  "booking.review",
  "room.manage",
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
