import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSongById, deleteSong } from "@/lib/db/queries/songs";

export function registerDeleteSong(server: McpServer, userId: string) {
  server.registerTool(
    "delete_song",
    {
      description: "Permanently delete a song from the gallery by ID.",
      inputSchema: {
        id: z.string().describe("The song ID to delete"),
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
      await deleteSong(id);
      return {
        content: [{ type: "text", text: `Song "${song.title}" deleted.` }],
      };
    }
  );
}
