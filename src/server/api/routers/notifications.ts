// ============================================================
// src/server/api/routers/notifications.ts
//
// NOTIFICATIONS tRPC ROUTER
//
// Thin wrapper over the notifications engine. Auth + businessId
// are enforced by businessProcedure middleware.
//
// Production: engine functions will delegate to Prisma.
// ============================================================

import { z } from "zod";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";
import {
  getUnreadNotifications,
  markNotificationRead,
} from "~/engine/notifications/index";

export const notificationsRouter = createTRPCRouter({
  // ── 1. List unread notifications ───────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        /** When provided, returns notifications for this user + broadcast (null recipientUserId). */
        userId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Production:
      //   db.notifications.findMany({
      //     where: {
      //       business_id: ctx.businessId,
      //       is_read: false,
      //       OR: [{ recipient_user_id: userId }, { recipient_user_id: null }],
      //     },
      //     orderBy: { created_at: 'desc' },
      //   })
      const userId = input.userId ?? ctx.session.user.id;
      return getUnreadNotifications(ctx.businessId, userId);
    }),

  // ── 2. Mark notification read ──────────────────────────────────────────────
  markRead: businessProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Production:
      //   db.notifications.updateMany({
      //     where: { id: input.notificationId, business_id: ctx.businessId },
      //     data: { is_read: true },
      //   })
      return markNotificationRead(input.notificationId, ctx.session.user.id);
    }),
});
