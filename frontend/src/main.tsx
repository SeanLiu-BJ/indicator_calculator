import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import { initTokenFromUrl } from "./auth";
import { App } from "./ui/App";

initTokenFromUrl();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
