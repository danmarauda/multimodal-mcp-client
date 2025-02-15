import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export default function mcpProxy({
  transportToClient,
  transportToServer,
  onerror,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
  onerror: (error: Error) => void;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  transportToClient.onmessage = (message) => {
    console.log("transportToClient.onmessage", message);
    transportToServer.send(message).catch(onerror);
  };

  transportToServer.onmessage = (message) => {
    console.log("transportToServer.onmessage", message);
    transportToClient.send(message).catch(onerror);
  };

  transportToClient.onclose = () => {
    console.log("transportToClient.onclose");
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onerror);
  };

  transportToServer.onclose = () => {
    console.log("transportToServer.onclose");
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;

    transportToClient.close().catch(onerror);
  };

  transportToClient.onerror = onerror;
  transportToServer.onerror = onerror;
}
