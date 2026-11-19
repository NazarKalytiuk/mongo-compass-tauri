import { useState } from "react";
import ConnectView from "./components/ConnectView";
import HomeView from "./components/HomeView";
import { ConnectionInfo } from "./types";
import "./App.css";

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const handleConnected = (info: ConnectionInfo) => {
    setConnectionInfo(info);
    setIsConnected(true);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setConnectionInfo(null);
  };

  if (isConnected && connectionInfo) {
    return (
      <HomeView
        connectionInfo={connectionInfo}
        uri={connectionInfo.display_uri}
        onDisconnect={handleDisconnect}
      />
    );
  }

  return <ConnectView onConnected={handleConnected} />;
}
