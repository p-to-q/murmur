import { SongDetailScreen } from "@/components/screens/SongDetailScreen";

interface Props { params: Promise<{ id: string }> }

export default async function SongDetailPage({ params }: Props) {
  const { id } = await params;
  return <SongDetailScreen songId={id} />;
}
