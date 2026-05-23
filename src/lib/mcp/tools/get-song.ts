import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSongById } from "@/lib/db/queries/songs";

export function registerGetSong(server: McpServer, userId: string) {
  server.registerTool(
    "get_song",
    {
      description: "Get full details of a specific song by ID, including its arrangement state and visual config.",
      inputSchema: {
        id: z.string().describe("The song ID"),
      },
    },
    async ({ id }) => {
      const song = await getSongById(id);
      if (!song || song.userId !== userId) {
        return {
          isError: true,
          content: [{ type: "text", text: `Song ${id} not found.` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(song, null, 2) }],
      };
    }
  );
}
