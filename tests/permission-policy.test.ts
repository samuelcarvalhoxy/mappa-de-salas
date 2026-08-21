import assert from "node:assert/strict";
import test from "node:test";
import {
  canDirectlyManagePermission,
  canManagePermissionChanges,
  changedPermissions,
} from "../lib/permission-policy.ts";
import type { Permission } from "../lib/types.ts";

const actorPermissions: Permission[] = [
  "user.manage",
  "role.manage",
  "booking.request",
];

test("identifica somente as permissões realmente adicionadas ou removidas", () => {
  assert.deepEqual(
    changedPermissions(
      ["booking.request", "stats.view"],
      ["booking.request", "audit.view"],
    ),
    ["stats.view", "audit.view"],
  );
});

test("permite ao gestor alterar somente permissões que ele possui", () => {
  assert.equal(
    canManagePermissionChanges({
      actorPermissions,
      actorIsGod: false,
      currentPermissions: [],
      nextPermissions: ["booking.request"],
    }),
    true,
  );
  assert.equal(
    canManagePermissionChanges({
      actorPermissions,
      actorIsGod: false,
      currentPermissions: [],
      nextPermissions: ["stats.view"],
    }),
    false,
  );
  assert.equal(
    canManagePermissionChanges({
      actorPermissions,
      actorIsGod: false,
      currentPermissions: ["stats.view"],
      nextPermissions: [],
    }),
    false,
  );
});

test("reserva notificações e relatório de acessos à delegação por God", () => {
  for (const permission of [
    "notification.send",
    "access.report",
  ] as Permission[]) {
    assert.equal(
      canDirectlyManagePermission(permission, [permission], false),
      false,
    );
    assert.equal(
      canManagePermissionChanges({
        actorPermissions: [permission],
        actorIsGod: false,
        currentPermissions: [],
        nextPermissions: [permission],
      }),
      false,
    );
  }
});

test("permite ao God gerenciar qualquer conjunto de permissões", () => {
  assert.equal(
    canManagePermissionChanges({
      actorPermissions: [],
      actorIsGod: true,
      currentPermissions: ["access.report"],
      nextPermissions: ["notification.send", "stats.view"],
    }),
    true,
  );
});
