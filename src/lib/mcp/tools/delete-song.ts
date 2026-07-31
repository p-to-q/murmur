import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { deleteSongForUser, getSongByIdForUser } from "@/lib/db/queries/songs";
import { deleteTrackedSongAudioObjectByKey } from "@/lib/storage/song-audio-cleanup";

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
      const song = await getSongByIdForUser(id, userId);
      if (!song) {
        return {
          isError: true,
          content: [{ type: "text", text: `Song ${id} not found.` }],
        };
      }
      const deleted = await deleteSongForUser(id, userId);
      if (!deleted) {
        return {
          isError: true,
          content: [{ type: "text", text: `Song ${id} not found.` }],
        };
      }
      if (deleted.mp3StorageKey) {
        await deleteTrackedSongAudioObjectByKey(deleted.mp3StorageKey).catch(() => undefined);
      }
      return {
        content: [{ type: "text", text: `Song "${song.title}" deleted.` }],
      };
    }
  );
}
