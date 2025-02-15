import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  CreateMessageRequestSchema,
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  McpClientState,
  ServerMetadata,
  ServerCapabilities,
} from "../contexts/McpContext.types";
import { getServerConfig } from "../../config/server.config";

interface ServerInfo {
  name?: unknown;
  version?: unknown;
  protocolVersion?: unknown;
  metadata?: unknown;
}

export function useMcpConnection(
  updateClientState: (
    serverId: string,
    updates: Partial<McpClientState>
  ) => void,
  onPendingRequest: (
    request: CreateMessageRequest["params"],
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
    serverId: string
  ) => void
) {
  const connectServer = async (serverId: string) => {
    try {
      console.log("Debug - Connecting server:", {
        serverId,
        timestamp: new Date().toISOString(),
      });

      const client = new Client(
        {
          name: `mcp-client-${serverId}`,
          version: "0.0.1",
        },
        {
          capabilities: {
            tools: {
              listTools: true,
            },
            prompts: {
              listPrompts: true,
            },
            resources: {
              listResources: true,
            },
            sampling: {},
            logging: {},
          },
        }
      );

      // Debug client lifecycle events
      client.onclose = () => {
        console.log("Debug - Client onclose event:", {
          serverId,
          timestamp: new Date().toISOString(),
          reason: "Client closed connection",
        });
        updateClientState(serverId, {
          connectionStatus: "disconnected",
          client: null,
        });
      };

      client.onerror = (error) => {
        console.log("Debug - Client error event:", {
          serverId,
          timestamp: new Date().toISOString(),
          error: error,
        });
      };

      // First establish the connection
      const proxyUrl = new URL("http://localhost:3000/sse");
      proxyUrl.searchParams.append("transportType", "stdio");
      proxyUrl.searchParams.append("serverId", serverId);
      const transport = new SSEClientTransport(proxyUrl);

      // Debug transport events
      transport.onmessage = (e) => {
        console.log("Debug - Transport message:", {
          serverId,
          timestamp: new Date().toISOString(),
          message: e,
        });
      };

      transport.onerror = (error) => {
        console.log("Debug - Transport error:", {
          serverId,
          timestamp: new Date().toISOString(),
          error: error,
        });
      };

      // Set up request handler before connecting
      client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
        console.log("Debug - Received sampling request from server:", {
          serverId,
          timestamp: new Date().toISOString(),
          request,
        });

        // Return a Promise that will be resolved when the user approves/rejects the sampling
        return new Promise((resolve, reject) => {
          onPendingRequest(request.params, resolve, reject, serverId);
        });
      });

      console.log("Debug - Attempting connection:", {
        serverId,
        timestamp: new Date().toISOString(),
        url: proxyUrl.toString(),
      });

      await client.connect(transport);

      // Set up reconnection handler
      transport.onclose = async () => {
        console.log("Debug - Transport closed, attempting reconnect:", {
          serverId,
          timestamp: new Date().toISOString(),
        });

        try {
          await client.connect(transport);
          console.log("Debug - Reconnected successfully:", {
            serverId,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Debug - Reconnection failed:", {
            serverId,
            timestamp: new Date().toISOString(),
            error,
          });
          updateClientState(serverId, {
            connectionStatus: "error",
            client: null,
          });
        }
      };

      // Check connection by attempting to get server info
      try {
        console.log("Debug - Connection established, verifying server info:", {
          serverId,
          timestamp: new Date().toISOString(),
        });

        // Get server info and capabilities
        const serverInfo = client.getServerVersion() as ServerInfo;
        if (!serverInfo || typeof serverInfo !== "object") {
          throw new Error("Failed to get server info");
        }

        const capabilities =
          client.getServerCapabilities() as ServerCapabilities;
        console.log("Debug - Server capabilities:", {
          serverId,
          timestamp: new Date().toISOString(),
          capabilities,
        });

        // Fetch available tools, prompts, and resources
        let tools: McpClientState["tools"] = [];
        let prompts: McpClientState["prompts"] = [];
        let resources: McpClientState["resources"] = [];

        if (capabilities && typeof capabilities === "object") {
          console.log("Debug - Fetching server resources:", {
            serverId,
            timestamp: new Date().toISOString(),
            hasTools: "tools" in capabilities,
            hasPrompts: "prompts" in capabilities,
            hasResources: "resources" in capabilities,
          });

          if ("tools" in capabilities) {
            const result = await client.listTools();
            tools = result.tools;
          }
          if ("prompts" in capabilities) {
            const result = await client.listPrompts();
            prompts = result.prompts;
          }
          if ("resources" in capabilities) {
            const result = await client.listResources();
            resources = result.resources;
          }
        }

        // Get server config with metadata
        const metadata = serverInfo.metadata as ServerMetadata | undefined;
        const serverConfig = getServerConfig(serverId, metadata, true);

        // Only NOW update the client state as connected with all the data
        updateClientState(serverId, {
          client,
          connectionStatus: "connected",
          serverType: "stdio",
          tools,
          prompts,
          resources,
          serverInfo: {
            name: String(serverInfo.name || ""),
            version: String(serverInfo.version || ""),
            protocolVersion: String(serverInfo.protocolVersion || ""),
            capabilities,
            metadata,
          },
          serverConfig,
        });

        console.log("Debug - Server fully connected with capabilities:", {
          serverId,
          timestamp: new Date().toISOString(),
          toolCount: tools.length,
          promptCount: prompts.length,
          resourceCount: resources.length,
        });
      } catch (error) {
        console.error("Debug - Connection verification failed:", {
          serverId,
          timestamp: new Date().toISOString(),
          error,
        });

        // Clean up the failed connection
        try {
          await client.close();
        } catch (closeError) {
          console.error("Debug - Error closing failed connection:", {
            serverId,
            timestamp: new Date().toISOString(),
            error: closeError,
          });
        }

        updateClientState(serverId, {
          client: null,
          connectionStatus: "error",
        });

        throw new Error(
          `Failed to verify connection: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } catch (e) {
      console.error("Connection error:", e);
      updateClientState(serverId, {
        client: null,
        connectionStatus: "error",
      });
      throw e;
    }
  };

  const disconnectServer = async (serverId: string, client: Client | null) => {
    if (!client) return;

    try {
      await client.close();
      updateClientState(serverId, {
        client: null,
        connectionStatus: "disconnected",
      });
    } catch (e) {
      console.error("Disconnection error:", e);
      throw e;
    }
  };

  return {
    connectServer,
    disconnectServer,
  };
}
