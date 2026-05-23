import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSongsByUser } from "@/lib/db/queries/songs";

export function registerGetStats(server: McpServer, userId: string) {
  server.registerTool(
    "get_stats",
    {
      description: "Get statistics about the user's MURMUR activity: total songs, total duration, unique vibes.",
    },
    async () => {
      const songs = await getSongsByUser(userId);
      const totalDuration = songs.reduce((sum, s) => sum + (s.duration ?? 0), 0);
      const vibeCount = new Set(songs.map((s) => s.vibe)).size;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalSongs: songs.length,
                totalDurationSeconds: totalDuration,
                uniqueVibes: vibeCount,
                mostRecentSong: songs[0]?.title ?? null,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
