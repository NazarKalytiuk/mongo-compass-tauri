import { useState } from "react";
import ConnectView from "./components/ConnectView";
import HomeView from "./components/HomeView";
import { ConnectionInfo } from "./types";
import "./App.css";

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [uri, setUri] = useState("");

  const handleConnected = (info: ConnectionInfo, connectionUri: string) => {
    setConnectionInfo(info);
    setUri(connectionUri);
    setIsConnected(true);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setConnectionInfo(null);
    setUri("");
  };

  if (isConnected && connectionInfo) {
    return (
      <HomeView
        connectionInfo={connectionInfo}
        uri={uri}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <ConnectView onConnected={handleConnected} />;
}
