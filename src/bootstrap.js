// src/bootstrap.js
import { setDefaultResultOrder } from "node:dns";

// Fuerza IPv4 ANTES de cargar cualquier otra cosa
setDefaultResultOrder("ipv4first");

// Arranca tu server real (usa import dinámico para que lo anterior se aplique)
await import("./server.js");
