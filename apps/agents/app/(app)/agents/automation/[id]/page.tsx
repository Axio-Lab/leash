import { AutomationDashboard } from '@/components/automation/automation-dashboard';

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AutomationDashboard mode="form" automationId={id} />;
}
