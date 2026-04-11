import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import TechShell from "./_components/TechShell";

export default async function TechLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.businessId) redirect("/choose-role");
  if (session.user.role !== "technician") redirect("/dashboard");

  return (
    <TechShell
      email={session.user.email ?? ""}
      technicianId={session.user.technicianId ?? ""}
    >
      {children}
    </TechShell>
  );
}
