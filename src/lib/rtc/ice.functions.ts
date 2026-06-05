import { createServerFn } from "@tanstack/react-start";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export const getIceServers = createServerFn({ method: "GET" }).handler(async (): Promise<IceServer[]> => {
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  const servers: IceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  if (username && credential) {
    servers.push(
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: "turn:standard.relay.metered.ca:80", username, credential },
      { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username, credential },
      { urls: "turn:standard.relay.metered.ca:443", username, credential },
      { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username, credential },
    );
  }
  return servers;
});
