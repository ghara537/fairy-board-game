import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { ClientToServerEvents, ServerToClientEvents } from "@fairy/shared";
import { RoomManager } from "./rooms/RoomManager";
import { registerSocketHandlers } from "./socket/handlers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4000);
// Render (and some other hosts) auto-populate an env var with the service's
// own public URL — falling back to it means a single-service deploy there
// works with zero manual config, since the client is served same-origin by
// this exact server anyway. CLIENT_ORIGIN still wins if set explicitly.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:5173";
const CLIENT_DIST_PATH = process.env.CLIENT_DIST_PATH ?? path.join(__dirname, "../../client/dist");

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: process.uptime() });
});

// Serve the built client in production (single full-stack deploy target).
app.use(express.static(CLIENT_DIST_PATH));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(CLIENT_DIST_PATH, "index.html"), (err) => {
    if (err) next();
  });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

const rooms = new RoomManager();
registerSocketHandlers(io, rooms);

// Periodically free rooms nobody is connected to (spec section 31).
setInterval(() => {
  const removed = rooms.sweepInactiveRooms();
  if (removed > 0) console.log(`[rooms] swept ${removed} inactive room(s)`);
}, 1000 * 60 * 30).unref();

httpServer.listen(PORT, () => {
  console.log(`Fairy Domains server listening on :${PORT}`);
});
