import { Card, EmptyHint, PageHeader } from "../ui";

export default function TrainingPlan({ refreshed }: { refreshed?: string }) {
  return (
    <div>
      <PageHeader title="Training Plan" icon="🎯" accent="#34d399" refreshed={refreshed} />
      <Card className="p-6">
        <EmptyHint>No plan yet.</EmptyHint>
      </Card>
    </div>
  );
}
