import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import DashboardShell from "./_components/DashboardShell";
import { InstallPrompt } from "../_components/install-prompt";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.businessId) redirect("/choose-role");
  if (session.user.role === "technician") redirect("/tech");

  return (
    <>
      <InstallPrompt />
      <DashboardShell email={session.user.email ?? ""}>
        {children}
      </DashboardShell>
    </>
  );
}
