import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { AuthGate } from "./AuthGate";
import { PublicSite } from "./PublicSite";

const host = window.location.hostname; const path = window.location.pathname;
const appSurface = import.meta.env.VITE_CARTOGRAPH_SURFACE === "app" || host.startsWith("app.") || path.startsWith("/app") || path.startsWith("/auth/callback") || import.meta.env.DEV && path !== "/public";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{appSurface ? <AuthGate/> : <PublicSite/>}</React.StrictMode>);
