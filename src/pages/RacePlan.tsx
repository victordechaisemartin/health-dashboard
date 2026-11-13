import { Card, EmptyHint, PageHeader } from "../ui";

export default function RacePlan({ refreshed }: { refreshed?: string }) {
  return (
    <div>
      <PageHeader title="Race Plan" icon="🏁" accent="#fbbf24" refreshed={refreshed} />
      <Card className="p-6">
        <EmptyHint>No plan yet — your coach will add it.</EmptyHint>
      </Card>
    </div>
  );
}
