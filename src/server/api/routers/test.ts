import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  businessProcedure,
  ownerProcedure,
} from "~/server/api/trpc";

export const testRouter = createTRPCRouter({
  // 1. Public — anyone can call
  hello: publicProcedure.query(() => {
    return { message: "Hello from tRPC" };
  }),

  // 2. Protected — must be logged in
  whoAmI: protectedProcedure.query(({ ctx }) => {
    return {
      userId: ctx.session.user.id,
      email: ctx.session.user.email,
      businessId: ctx.session.user.businessId,
      role: ctx.session.user.role,
    };
  }),

  // 3. Business — must be logged in AND have a businessId
  myBusiness: businessProcedure.query(({ ctx }) => {
    return {
      businessId: ctx.businessId, // typed as string, not string | null
    };
  }),

  // 4. Owner — must be logged in + have businessId + be owner role
  ownerOnly: ownerProcedure.query(({ ctx }) => {
    return {
      businessId: ctx.businessId,
      role: ctx.session.user.role,
      message: "You are an owner",
    };
  }),
});
