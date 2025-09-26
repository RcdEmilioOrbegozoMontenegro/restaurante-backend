// src/bootstrap.js
import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");
console.log("[bootstrap] dns result order = ipv4first");
await import("./server.js");
