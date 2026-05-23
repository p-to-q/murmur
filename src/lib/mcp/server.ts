import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListSongs } from "./tools/list-songs";
import { registerGetSong } from "./tools/get-song";
import { registerDeleteSong } from "./tools/delete-song";
import { registerGetStats } from "./tools/get-stats";

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "murmur",
    version: "0.1.0",
  });

  registerListSongs(server, userId);
  registerGetSong(server, userId);
  registerDeleteSong(server, userId);
  registerGetStats(server, userId);

  return server;
}
