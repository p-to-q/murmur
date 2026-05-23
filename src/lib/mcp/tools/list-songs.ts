import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSongsByUser } from "@/lib/db/queries/songs";

export function registerListSongs(server: McpServer, userId: string) {
  server.registerTool(
    "list_songs",
    {
      description:
        "List all songs in the user's MURMUR gallery. Returns title, vibe, duration, and creation date for each song.",
    },
    async () => {
      const songs = await getSongsByUser(userId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              songs.map((s) => ({
                id: s.id,
                title: s.title,
                vibe: s.vibe,
                bpm: s.bpm,
                key: s.keySignature,
                duration: s.duration,
                createdAt: s.createdAt,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
