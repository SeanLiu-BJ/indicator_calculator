import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import { VibeKanbanWebCompanion } from "vibe-kanban-web-companion";
import { initTokenFromUrl } from "./auth";
import { App } from "./ui/App";

initTokenFromUrl();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VibeKanbanWebCompanion />
    <App />
  </React.StrictMode>
);
