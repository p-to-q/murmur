import dynamic from "next/dynamic";

const SongDetailScreen = dynamic(() =>
  import("@/components/screens/SongDetailScreen").then(
    (m) => m.SongDetailScreen,
  ),
);

interface Props { params: Promise<{ id: string }> }

export default async function SongDetailPage({ params }: Props) {
  const { id } = await params;
  return <SongDetailScreen songId={id} />;
}
