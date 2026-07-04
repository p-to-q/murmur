import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListSongs } from "./tools/list-songs";
import { registerGetSong } from "./tools/get-song";
import { registerDeleteSong } from "./tools/delete-song";
import { registerGetStats } from "./tools/get-stats";

import { getAppVersionParts } from "@/lib/app-version";

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "murmur",
    version: getAppVersionParts().semver,
  });

  registerListSongs(server, userId);
  registerGetSong(server, userId);
  registerDeleteSong(server, userId);
  registerGetStats(server, userId);

  return server;
}
