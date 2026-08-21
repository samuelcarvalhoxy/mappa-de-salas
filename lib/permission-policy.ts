import type { Permission } from "./types";

export const GOD_MANAGED_PERMISSIONS = [
  "notification.send",
  "access.report",
] as const satisfies readonly Permission[];

const godManagedPermissions = new Set<Permission>(GOD_MANAGED_PERMISSIONS);

export function changedPermissions(
  current: readonly Permission[],
  next: readonly Permission[],
) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return [...new Set([...current, ...next])].filter(
    (permission) => currentSet.has(permission) !== nextSet.has(permission),
  );
}

export function canManagePermissionChanges({
  actorPermissions,
  actorIsGod,
  currentPermissions,
  nextPermissions,
}: {
  actorPermissions: readonly Permission[];
  actorIsGod: boolean;
  currentPermissions: readonly Permission[];
  nextPermissions: readonly Permission[];
}) {
  if (actorIsGod) return true;
  const actorPermissionSet = new Set(actorPermissions);
  return changedPermissions(currentPermissions, nextPermissions).every(
    (permission) =>
      actorPermissionSet.has(permission) &&
      !godManagedPermissions.has(permission),
  );
}

export function canDirectlyManagePermission(
  permission: Permission,
  actorPermissions: readonly Permission[],
  actorIsGod: boolean,
) {
  return (
    actorIsGod ||
    (actorPermissions.includes(permission) &&
      !godManagedPermissions.has(permission))
  );
}
